import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"
import { bufferRsvp, recordDirectSignup } from "@/lib/airtable/rsvp"
import { rateLimited } from "@/lib/rate-limit"
import { redactForLog } from "@/lib/redact"

/**
 * Signup capture.
 *
 * Three sinks, chosen by environment so the same route works locally and in production without a code change:
 *
 * AIRTABLE_API_KEY +   Write straight to the "Half Life" base AIRTABLE_BASE_ID     (appVGSvooOShD3qtC), table AIRTABLE_TABLE_NAME, else AIRTABLE_RSVP_TABLE_ID – the Signups table, which has `email`, `ip`, `referred_by`, `utm_source`, `utm_medium`, `utm_campaign` and `Loops - halfLifeReferralNumber` (text). The token needs data.records:read/write scope on that base. SIGNUP_WEBHOOK_URL   POST the full entry (email, ip, source, at, referralCode, ref, utmSource, utmMedium, utmCampaign) to your list provider, form endpoint, Sheets relay, or queue. Set SIGNUP_WEBHOOK_TOKEN to send a bearer header. (unset)              append JSON Lines to ./data/signups.jsonl – fine for local development and any host with a writable disk, NOT durable on serverless.
 *
 * referralCode is a running count ("1", "2", "3", ...) of signups in whichever sink is active, assigned once per email and handed back unchanged on repeat signups.
 */

const STORE_DIR = path.join(process.cwd(), "data")
const STORE_FILE = path.join(STORE_DIR, "signups.jsonl")

const EMAIL = /^[^\s@,;:<>()[\]\\"]+@[^\s@.,;:<>()[\]\\"]+(\.[^\s@.,;:<>()[\]\\"]+)+$/

type SignupResult =
	| { ok: true; duplicate: boolean; referralCode: string }
	| { ok: false; error: string; status: number }

interface SignupMeta {
	ref?: string | null
	source?: string
	/** When the caller knows whose address this is (the signed-in referral path), link the buffer row so the drain stamps it. */
	userId?: string | null
	utmCampaign?: string | null
	utmMedium?: string | null
	utmSource?: string | null
}

function normalizeEmail(raw: unknown): string | null {
	if (typeof raw !== "string") return null
	const email = raw.trim().toLowerCase()
	if (email.length < 6 || email.length > 254) return null
	if (!EMAIL.test(email)) return null
	return email
}

/**
 * Fetches every record's `referral_code` isn't an option at scale, but counting record ids is cheap – request just the `email` field (Airtable rejects an empty field name outright) so each page carries almost nothing else. The count is a snapshot, not a lock, so two signups landing in the same instant can in principle claim the same ordinal; acceptable here given the existing rate limit and the low stakes of a referral number colliding.
 */
async function countAirtableRecords(url: string, headers: { [_: string]: string }): Promise<number> {
	let count = 0
	let offset: string | undefined
	do {
		const params = new URLSearchParams({ "fields[]": "email", pageSize: "100" })
		if (offset) params.set("offset", offset)
		const res = await fetch(`${url}?${params.toString()}`, { headers })
		if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
		const data = (await res.json()) as { records?: unknown[]; offset?: string }
		count += data.records?.length ?? 0
		;({ offset } = data)
	} while (offset)
	return count
}

/**
 * In-memory only – resets on cold start and isn't shared across instances, so it's a rough ordinal rather than a guaranteed-unique one. Unlike Airtable or the JSONL file, a webhook sink has nothing local to count signups from.
 */
let webhookSequence = 0

export async function recordSignup(email: string, ip = "unknown", meta: SignupMeta = {}): Promise<SignupResult> {
	const { source = "landing", ref = null, utmSource = null, utmMedium = null, utmCampaign = null, userId = null } = meta

	const airtableToken = process.env.AIRTABLE_API_KEY
	const airtableBase = process.env.AIRTABLE_BASE_ID

	if (airtableToken && airtableBase) {
		// The Signups table. It used to default to "Table 1", which is not in the base, so any deployment without AIRTABLE_TABLE_NAME failed every signup; the platform already names this table in AIRTABLE_RSVP_TABLE_ID.
		const table = encodeURIComponent(process.env.AIRTABLE_TABLE_NAME ?? process.env.AIRTABLE_RSVP_TABLE_ID ?? "Signups")
		const url = `https://api.airtable.com/v0/${airtableBase}/${table}`
		const headers = {
			authorization: `Bearer ${airtableToken}`,
			"content-type": "application/json",
		}

		/**
		 * Airtable being unreachable must not lose the signup. Buffer it for the drain job instead of returning 502, so the person is on the list even though they do not get a referral number yet (the drain does not assign one – the signed-in owner gets a code from /api/me/referral once the row exists).
		 */
		const bufferInstead = async (reason: string): Promise<SignupResult> => {
			console.error(`[signup] Airtable ${reason}; buffering the signup for the drain job`)
			try {
				await bufferRsvp({
					email,
					ip,
					...(ref ? { referredBy: ref } : {}),
					...(utmSource ? { utmSource } : {}),
					...(utmMedium ? { utmMedium } : {}),
					...(utmCampaign ? { utmCampaign } : {}),
				})
			} catch (err) {
				console.error("[signup] buffering the signup also failed:", err)
				return {
					error: "We couldn't reach the signup list. Try again in a moment.",
					ok: false,
					status: 502,
				}
			}
			return { duplicate: false, ok: true, referralCode: "" }
		}

		// Airtable has no unique-field constraint to lean on, so duplicates are caught with a lookup before the write – same contract the other two sinks give the caller.
		const filter = encodeURIComponent(`LOWER({email})="${email}"`)
		const lookup = await fetch(`${url}?filterByFormula=${filter}&maxRecords=1`, {
			headers,
		})

		if (!lookup.ok) {
			console.error(`Airtable lookup failed: ${lookup.status} ${redactForLog(await lookup.text())}`)
			return bufferInstead("lookup failed")
		}

		const found = (await lookup.json()) as {
			records?: { id?: string; fields?: { [_: string]: unknown } }[]
		}
		if ((found.records?.length ?? 0) > 0) {
			// The row already exists upstream, so remember its id: the direct path bypasses the drain, and without this the buffer – and the Loops sync's record-id join – never learns this row exists.
			const duplicateId = found.records?.[0]?.id
			if (duplicateId)
				await recordDirectSignup({
					email,
					ip,
					recordId: duplicateId,
					...(ref ? { referredBy: ref } : {}),
					...(utmSource ? { utmSource } : {}),
					...(userId ? { userId } : {}),
				})

			// The column the number is written to below; there is no `referral_code`, so reading that handed returning people a blank.
			const existing = found.records?.[0]?.fields?.["Loops - halfLifeReferralNumber"]
			return {
				duplicate: true,
				ok: true,
				referralCode: typeof existing === "string" || typeof existing === "number" ? String(existing) : "",
			}
		}

		let referralCode: string
		try {
			referralCode = String((await countAirtableRecords(url, headers)) + 1)
		} catch (err) {
			console.error(`Airtable count failed: ${redactForLog(err instanceof Error ? err.message : String(err))}`)
			return bufferInstead("count failed")
		}

		const response = await fetch(url, {
			body: JSON.stringify({
				fields: {
					email,
					ip,
					"Loops - halfLifeReferralNumber": referralCode,
					referred_by: ref ?? undefined,
					utm_campaign: utmCampaign ?? undefined,
					utm_medium: utmMedium ?? undefined,
					utm_source: utmSource ?? undefined,
				},
			}),
			headers,
			method: "POST",
		})

		if (!response.ok) {
			console.error(`Airtable create failed: ${response.status} ${redactForLog(await response.text())}`)
			return bufferInstead("create failed")
		}
		// Remember the row the direct path just made, for the same reason as above: no buffer entry means no record-id join for the Loops sync.
		try {
			const created = (await response.json()) as { id?: string }
			if (created.id)
				await recordDirectSignup({
					email,
					ip,
					recordId: created.id,
					...(ref ? { referredBy: ref } : {}),
					...(utmSource ? { utmSource } : {}),
					...(userId ? { userId } : {}),
				})
		} catch (err) {
			console.error("[signup] remembering the direct-write row failed:", err)
		}
		return { duplicate: false, ok: true, referralCode }
	}

	const webhook = process.env.SIGNUP_WEBHOOK_URL

	if (webhook) {
		const referralCode = String(++webhookSequence)
		const entry = {
			email,
			ip,
			ref,
			referralCode,
			source,
			utmCampaign,
			utmMedium,
			utmSource,
		}
		const token = process.env.SIGNUP_WEBHOOK_TOKEN
		const response = await fetch(webhook, {
			body: JSON.stringify(entry),
			headers: {
				"content-type": "application/json",
				...(token ? { authorization: `Bearer ${token}` } : {}),
			},
			method: "POST",
		})

		if (!response.ok)
			return {
				error: "We couldn't reach the signup list. Try again in a moment.",
				ok: false,
				status: 502,
			}

		return { duplicate: false, ok: true, referralCode }
	}

	await mkdir(STORE_DIR, { recursive: true })

	let duplicate = false
	let referralCode = ""
	let lineCount = 0
	try {
		const lines = (await readFile(STORE_FILE, "utf8")).split("\n").filter(Boolean)
		lineCount = lines.length
		const match = lines.find(line => line.includes(`"email":"${email}"`))
		if (match) {
			duplicate = true
			try {
				referralCode = (JSON.parse(match) as { referralCode?: string }).referralCode ?? ""
			} catch {
				referralCode = ""
			}
		}
	} catch {
		// First signup – no file yet.
	}

	if (!duplicate) {
		referralCode = String(lineCount + 1)
		const entry = {
			email,
			ip,
			ref,
			referralCode,
			source,
			utmCampaign,
			utmMedium,
			utmSource,
		}
		await appendFile(STORE_FILE, `${JSON.stringify(entry)}\n`, "utf8")
	}

	return { duplicate, ok: true, referralCode }
}

/**
 * The landing page's budget: eight attempts a minute, and a refused attempt still counts, so a caller hammering the endpoint does not get a fresh window by continuing.
 */
export function signupRateLimited(key: string): boolean {
	return rateLimited(key, { countThrottled: true, max: 8 })
}

export type { SignupMeta, SignupResult }
export { normalizeEmail }
