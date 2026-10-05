import "server-only"
import { airtableFetch, getAirtableConfig, withRateLimitRetry } from "@/lib/airtable/client"
import { fieldKey, RSVP, RSVP_TABLE_ID } from "@/lib/airtable/schema"

/**
 * Who the referral links are bringing in.
 *
 * A referral link is `/?ref=<code>` (see /api/me/referral), and the code lands
 * on a sign-up's `referred_by` cell. So the ranking is a walk of the same
 * Airtable `Signups` list the counter and the Loops sync use — the landing form
 * writes straight there (lib/site/signups), and Postgres only holds a fallback
 * buffer, so Airtable is the only place the attribution actually lives.
 *
 * The code a link carries is the referrer's own `Loops - halfLifeReferralNumber`,
 * which sits on their sign-up row in the same list. One walk therefore yields
 * both halves: each row's own code names its `referred_by` value back to an
 * email, and `referred_by` says who the link brought in. A code with no owner
 * row (legacy, or a row since removed) still counts, with the referrer blank
 * rather than the sign-up dropped.
 */

/**
 * The base's real column names.
 *
 * `RSVP.fields` has drifted from this base: it names `First Name` and
 * `Referred By`, and neither exists here. Airtable 422s the entire list request
 * on one unknown `fields[]`, so the names are spelled the way the base and the
 * landing's write path (lib/site/signups) actually spell them. `email` is
 * correct in the map, so it is taken through `fieldKey` like the counter does.
 */
const EMAIL_FIELD = fieldKey(RSVP.fields.email)
const REFERRED_BY_FIELD = "referred_by"
const REFERRAL_NUMBER_FIELD = "Loops - halfLifeReferralNumber"

/** Airtable's page size, and the walk's memory bound. */
const PAGE_SIZE = 100

/** How long a leaderboard is reused. Mirrors signup-count.ts. */
const CACHE_TTL_MS = 60_000
/** A failure is held briefly so a blip does not pin an empty table for a minute. */
const FAILED_TTL_MS = 15_000

export interface ReferralLeaderRow {
	code: string
	/** The code owner's address, when their own sign-up row is still present. */
	email: string | null
	signups: number
}

export interface ReferralLeaderboard {
	/** Highest-signup links first. */
	rows: ReferralLeaderRow[]
	/** Distinct people attributed to any referral link. */
	referred: number
	/** Codes that brought at least one person in. */
	activeCodes: number
}

interface Cached {
	at: number
	ttl: number
	value: Promise<ReferralLeaderboard | null>
}

/** One entry per process, the promise so concurrent renders share one walk. */
let cached: Cached | null = null

/**
 * The referral leaderboard, or null when Airtable is not configured or does
 * not answer. Never rejects: the cache holds the promise, so a rejection would
 * be handed to every render for the next minute instead of the short failure
 * it should be.
 */
export function getReferralLeaderboard(): Promise<ReferralLeaderboard | null> {
	const now = Date.now()
	if (cached && now - cached.at < cached.ttl) return cached.value

	const config = getAirtableConfig()
	if (!config) return Promise.resolve(null)

	const value = walkReferrals(config)
	const entry: Cached = { at: now, ttl: CACHE_TTL_MS, value }
	cached = entry
	void value.then((result) => {
		if (result === null && cached === entry) entry.ttl = FAILED_TTL_MS
	})
	return value
}

/** Airtable cells come back as strings here, but the number column can be typed. */
function asText(value: unknown): string | null {
	if (typeof value === "string") return value.trim() || null
	if (typeof value === "number") return String(value)
	return null
}

async function walkReferrals(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
): Promise<ReferralLeaderboard | null> {
	const want = [EMAIL_FIELD, REFERRED_BY_FIELD, REFERRAL_NUMBER_FIELD]
		.map((field) => `fields%5B%5D=${encodeURIComponent(field)}`)
		.join("&")

	/** code → the email that owns it, for naming the link's author. */
	const owners = new Map<string, string>()
	/** Lowercased signup email → the referral code it came through. */
	const attributed = new Map<string, string>()

	let offset: string | undefined
	try {
		do {
			const page = await withRateLimitRetry("referralLeaderboard", () =>
				airtableFetch<{ records: { fields: Record<string, unknown> }[]; offset?: string }>(
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

				// Attribute each person once, and to a real link: a first row with
				// no referrer must not shadow a later one that has it, and the list
				// can hold the same address more than once.
				const referredBy = asText(fields[REFERRED_BY_FIELD])
				if (email && referredBy && !attributed.has(email)) attributed.set(email, referredBy)
			}
			offset = page.offset
		} while (offset)
	} catch (err) {
		console.warn("[referrals] could not read the sign-up list:", err)
		return null
	}

	const counts = new Map<string, number>()
	for (const code of attributed.values()) counts.set(code, (counts.get(code) ?? 0) + 1)

	const rows: ReferralLeaderRow[] = [...counts.entries()]
		.map(([code, signups]) => ({ code, email: owners.get(code) ?? null, signups }))
		.sort((a, b) => b.signups - a.signups || a.code.localeCompare(b.code, undefined, { numeric: true }))

	return { rows, referred: attributed.size, activeCodes: rows.length }
}
