import "server-only"
import { airtableFetch, getAirtableConfig, withRateLimitRetry } from "@/lib/airtable/client"
import { fieldKey, RSVP, RSVP_TABLE_ID } from "@/lib/airtable/schema"

/**
 * How many people are on the landing page's sign-up list, for the counter.
 *
 * This is the Airtable `Signups` table – the list the landing page's own field writes into, and the one the RSVP drain and the Loops sync share. It is NOT the `User` table: an account means someone signed in through Hack Club Auth,
 * while the list counts everyone who left an address, which is the number the
 * page is actually claiming ("people have signed up", past tense, in the sense the field above it means it).
 *
 * Two things it has to get right, and neither is free:
 *
 * - **Distinct people, not rows.** The list can hold the same address twice – `loops.ts` dedupes on lowercased email for exactly that reason ("First row wins if the list has the same address twice"). Counting rows would report more people than there are, which is the one direction social proof must never be wrong in. So this counts distinct addresses.
 * - **Not per request.** The list is paginated at 100, so a count is a walk of several pages, and every page costs a slot in the process-wide Airtable throttle (5 req/s, `client.ts`). The endpoint is public and polled by every visitor, so the walk is cached and shared – see CACHE_TTL_MS.
 *
 * `getAirtableConfig()` returning null (no key configured, e.g. a local checkout) is not an error: the caller gets `null` and the page shows no number, which is the same state it is in before the first fetch lands.
 */

/** How long a count is reused. */
const CACHE_TTL_MS = 60_000

/**
 * How long "could not count" is reused. Short, for the same reason `repo-checks.ts` keeps its failures brief: a blip should not pin a wrong answer for a full minute. `null` never enters the cache at all – a missing key is a configuration state, not a transient one.
 */
const FAILED_TTL_MS = 15_000

/** Airtable's page size. Also the walk's memory bound: one page of addresses. */
const PAGE_SIZE = 100

interface Cached {
	at: number
	ttl: number
	value: Promise<number | null>
}

/**
 * One entry, per process. Keyed by nothing: there is one list, and a second spelling of it would be a different deployment rather than a different key. The value is the promise, not the result, so concurrent visitors arriving together wait on one walk instead of each starting their own.
 */
let cached: Cached | null = null

/**
 * The number of distinct addresses on the list, or null if Airtable is not configured. Never rejects: the promise is what the cache holds, so a rejected one would be handed to every visitor for the next minute instead of the short-lived failure it should be.
 */
export function countSignups(): Promise<number | null> {
	const now = Date.now()
	if (cached && now - cached.at < cached.ttl) return cached.value

	const config = getAirtableConfig()
	if (!config) return Promise.resolve(null)

	const value = walkSignups(config)
	const entry: Cached = { at: now, ttl: CACHE_TTL_MS, value }
	cached = entry
	value.then(count => {
		// A failure is kept briefly: checked against the entry itself, so a newer walk that has since replaced it is left alone.
		if (count === null && cached === entry) entry.ttl = FAILED_TTL_MS
	})
	return value
}

/**
 * Walk every page and count distinct addresses, lowercased.
 *
 * `fields[]` is narrowed to the email column so a page carries addresses rather than the whole row. The name is taken through `fieldKey`, not typed out: the live column is lowercase, and naming it `Email` is a 422 that fails the whole list request (see `schema.ts`), which would take this counter down with it.
 */
async function walkSignups(config: NonNullable<ReturnType<typeof getAirtableConfig>>): Promise<number | null> {
	const emailField = fieldKey(RSVP.fields.email)
	const seen = new Set<string>()
	let offset: string | undefined
	try {
		do {
			const query = `pageSize=${PAGE_SIZE}&fields%5B%5D=${encodeURIComponent(emailField)}${
				offset ? `&offset=${encodeURIComponent(offset)}` : ""
			}`
			const page = await withRateLimitRetry("countSignups", () =>
				airtableFetch<{ records: { fields: { [_: string]: unknown } }[]; offset?: string }>(
					config,
					`${encodeURIComponent(RSVP_TABLE_ID)}?${query}`,
				),
			)
			for (const record of page.records) {
				const email = record.fields[emailField]
				if (typeof email === "string" && email.trim()) seen.add(email.trim().toLowerCase())
			}
			offset = page.offset
		} while (offset)
	} catch (err) {
		console.warn("[signup-count] could not count the sign-up list:", err)
		return null
	}
	return seen.size
}
