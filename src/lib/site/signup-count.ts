import "server-only"
import { cachedAirtableWalk } from "@/lib/airtable/cache"
import { type AirtableConfig, airtableFetch, withRateLimitRetry } from "@/lib/airtable/client"
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
 * - **Not per request.** The list is paginated at 100, so a count is a walk of several pages, and every page costs a slot in the process-wide Airtable throttle (5 req/s, `client.ts`). The endpoint is public and polled by every visitor, so the walk is cached and shared – see `lib/airtable/cache.ts`.
 *
 * `getAirtableConfig()` returning null (no key configured, e.g. a local checkout) is not an error: the caller gets `null` and the page shows no number, which is the same state it is in before the first fetch lands.
 */

/** Airtable's page size. Also the walk's memory bound: one page of addresses. */
const PAGE_SIZE = 100

/**
 * The number of distinct addresses on the list, or null if Airtable is not configured or does not answer.
 */
export const countSignups = cachedAirtableWalk(walkSignups)

/**
 * Walk every page and count distinct addresses, lowercased.
 *
 * `fields[]` is narrowed to the email column so a page carries addresses rather than the whole row. The name is taken through `fieldKey`, not typed out: the live column is lowercase, and naming it `Email` is a 422 that fails the whole list request (see `schema.ts`), which would take this counter down with it.
 */
async function walkSignups(config: AirtableConfig): Promise<number | null> {
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
