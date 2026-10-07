import "server-only"
import { type AirtableConfig, AirtableError, airtableFetch } from "@/lib/airtable/client"

/**
 * Whether a column exists on a table, probed once per process.
 *
 * Airtable refuses the WHOLE request when a `fields[]` entry or a `fields` key
 * names a column the table does not have — a 422 UNKNOWN_FIELD_NAME, not a
 * partial success. So one column that was never created does not leave that
 * column blank, it stops every request that mentions it: the RSVP drain's
 * per-record upsert, the Loops sync's whole listing.
 *
 * That is the failure this module exists to absorb. Both callers need to ask
 * "may I write this column?" and answer yes/no, because the alternative is a
 * payload that is rejected wholesale and a job that reports success having
 * written nothing.
 *
 * Only a 422 naming the field counts as "absent". A rate limit, a timeout or a
 * 5xx is a fault, not a fact about the schema, and must never be remembered as
 * one — caching that would switch a column off for the life of the process after
 * a single bad minute.
 *
 * Cached per (table, column) because a base either has a column or it does not.
 * Re-probing on every write would spend an Airtable request to learn something
 * that cannot have changed.
 */
const probed = new Map<string, boolean>()

/** How long a "no" is remembered. A column added in the Airtable UI is noticed
 *    within this window without a redeploy. */
const ABSENT_TTL_MS = 10 * 60_000
const absentSince = new Map<string, number>()

export async function columnExists(config: AirtableConfig, tableId: string, column: string): Promise<boolean> {
	const key = `${config.baseId}:${tableId}:${column}`
	const cached = probed.get(key)
	if (cached !== undefined) {
		// A remembered "no" expires, so adding the column in Airtable is picked up.
		if (cached) return true
		const since = absentSince.get(key)
		if (since !== undefined && Date.now() - since < ABSENT_TTL_MS) return false
		probed.delete(key)
		absentSince.delete(key)
	}

	try {
		await airtableFetch(
			config,
			`${encodeURIComponent(tableId)}?maxRecords=1&fields%5B%5D=${encodeURIComponent(column)}`,
		)
		probed.set(key, true)
		absentSince.delete(key)
		return true
	} catch (err) {
		const missing = err instanceof AirtableError && err.status === 422 && err.body.includes("UNKNOWN_FIELD_NAME")
		if (!missing) throw err
		probed.set(key, false)
		absentSince.set(key, Date.now())
		console.warn(
			`[airtable] ${tableId} has no \`${column}\` column; writing it anyway would fail the whole request, so it is skipped`,
		)
		return false
	}
}

/** Test seam: forget what has been probed. */
export function resetColumnProbes(): void {
	probed.clear()
	absentSince.clear()
}

/**
 * The subset of `columns` the table actually has, probed once and cached.
 *
 * Airtable will not say which of several `fields[]` entries it disliked — the
 * whole request is refused — so this asks about them one at a time. The cost is
 * one request per column the first time a process sees them and none after,
 * which is what the cache above is for: a drain running every ten minutes pays
 * it once per deploy, not once per run.
 *
 * The point is that a payload is built out of what exists rather than out of what
 * the schema hopes for. A base set up with three of the columns a payload names
 * otherwise has every write refused wholesale — not the missing column left
 * blank, every other column in the same record lost too — and the only symptom
 * is a `failed` count nobody reads. Measured on the live Signups base: three of
 * the ten columns the drain sends exist, so every drain of every row was
 * rejected.
 */
export async function existingColumns(
	config: AirtableConfig,
	tableId: string,
	columns: readonly string[],
): Promise<Set<string>> {
	const known = new Set<string>()
	for (const column of columns) {
		if (await columnExists(config, tableId, column)) known.add(column)
	}
	return known
}
