import "server-only"
import { cachedAirtableWalk } from "@/lib/airtable/cache"
import { type AirtableConfig, airtableFetch, withRateLimitRetry } from "@/lib/airtable/client"
import { fieldKey, RSVP, RSVP_TABLE_ID } from "@/lib/airtable/schema"

/**
 * Who the referral links are bringing in.
 *
 * A referral link is `/?ref=<code>` (see /api/me/referral), and the code lands on a sign-up's `referred_by` cell. So the ranking is a walk of the same Airtable `Signups` list the counter and the Loops sync use – the landing form writes straight there (lib/site/signups), and Postgres only holds a fallback buffer, so Airtable is the only place the attribution actually lives.
 *
 * The code a link carries is the referrer's own `Loops - halfLifeReferralNumber`, which sits on their sign-up row in the same list. One walk therefore yields both halves: each row's own code names its `referred_by` value back to an email, and `referred_by` says who the link brought in. A code with no owner row (legacy, or a row since removed) still counts, with the referrer blank rather than the sign-up dropped.
 */

/**
 * The base's real column names.
 *
 * `referred_by` used to be spelled out by hand here, because `RSVP.fields` named it `Referred By` and Airtable 422s the entire list request on one unknown `fields[]`. The map is right now – the landing writes `referred_by` itself (lib/site/signups), and the map says so – so the name comes through `fieldKey` like `email` always has, and there is one spelling of it in the codebase rather than two.
 */
const EMAIL_FIELD = fieldKey(RSVP.fields.email)
const REFERRED_BY_FIELD = fieldKey(RSVP.fields.referredBy)
const REFERRAL_NUMBER_FIELD = "Loops - halfLifeReferralNumber"

/** Airtable's page size, and the walk's memory bound. */
const PAGE_SIZE = 100

export interface ReferralLeaderRow {
	code: string
	/** The code owner's address, when their own sign-up row is still present. */
	email: string | null
	signups: number
}

export interface ReferralLeaderboard {
	/** Codes that brought at least one person in. */
	activeCodes: number
	/** Distinct people attributed to any referral link. */
	referred: number
	/** Highest-signup links first. */
	rows: ReferralLeaderRow[]
}

/**
 * The referral leaderboard, or null when Airtable is not configured or does not answer.
 */
export const getReferralLeaderboard = cachedAirtableWalk(walkReferrals)

/** Airtable cells come back as strings here, but the number column can be typed. */
function asText(value: unknown): string | null {
	if (typeof value === "string") return value.trim() || null
	if (typeof value === "number") return String(value)
	return null
}

async function walkReferrals(config: AirtableConfig): Promise<ReferralLeaderboard | null> {
	const want = [EMAIL_FIELD, REFERRED_BY_FIELD, REFERRAL_NUMBER_FIELD]
		.map(field => `fields%5B%5D=${encodeURIComponent(field)}`)
		.join("&")

	/** code → the email that owns it, for naming the link's author. */
	const owners = new Map<string, string>()
	/** Lowercased signup email → the referral code it came through. */
	const attributed = new Map<string, string>()

	let offset: string | undefined
	try {
		do {
			const page = await withRateLimitRetry("referralLeaderboard", () =>
				airtableFetch<{ records: { fields: { [_: string]: unknown } }[]; offset?: string }>(
					config,
					`${encodeURIComponent(RSVP_TABLE_ID)}?pageSize=${PAGE_SIZE}&${want}${
						offset ? `&offset=${encodeURIComponent(offset)}` : ""
					}`,
				),
			)

			for (const { fields } of page.records) {
				const email = asText(fields[EMAIL_FIELD])?.toLowerCase() ?? null

				// The row's own code, so a link can be shown against an address.
				const code = asText(fields[REFERRAL_NUMBER_FIELD])
				if (code && email && !owners.has(code)) owners.set(code, email)

				// Attribute each person once, and to a real link: a first row with no referrer must not shadow a later one that has it, and the list can hold the same address more than once.
				const referredBy = asText(fields[REFERRED_BY_FIELD])
				if (email && referredBy && !attributed.has(email)) attributed.set(email, referredBy)
			}
			;({ offset } = page)
		} while (offset)
	} catch (err) {
		console.warn("[referrals] could not read the sign-up list:", err)
		return null
	}

	const counts = new Map<string, number>()
	for (const code of attributed.values()) counts.set(code, (counts.get(code) ?? 0) + 1)

	const rows: ReferralLeaderRow[] = [...counts.entries()]
		.map(([code, signups]) => ({ code, email: owners.get(code) ?? null, signups }))
		.toSorted((a, b) => b.signups - a.signups || a.code.localeCompare(b.code, undefined, { numeric: true }))

	return { activeCodes: rows.length, referred: attributed.size, rows }
}
