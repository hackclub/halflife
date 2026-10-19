import "server-only"
import {
	type AirtableConfig,
	AirtableError,
	type AirtableRecord,
	airtableFetch,
	escapeAirtableValue,
	getAirtableConfig,
	withRateLimitRetry,
} from "@/lib/airtable/client"
import { fieldKey, formulaRef, YSWS_SUBMISSION } from "@/lib/airtable/schema"

/**
 * Writes to the `YSWS Project Submission` table.
 *
 * Rows are addressed by their Airtable record id, which Half Life keeps from the moment it creates one (see lib/airtable/sync). The table has no column of ours to match on, and none of its own is unique per submission – Code URL is shared by every project in a monorepo – so a match-on-fields upsert would sooner or later update someone else's row.
 *
 * `typecast: false` is deliberate: with typecast on, a single-select value we did not create is silently added as a new option, so a typo in a status or a tier quietly invents one in the base.
 *
 * When no record id is known – a create whose response was lost – the write first looks for exactly one row matching the submission's identity and adopts it (see `findExistingRow`), so a retry cannot post a second copy. Anything less than exactly one match is left for a human.
 */

/** How many columns a write may shed before giving up. */
const MAX_DROPPED_FIELDS = 6

/**
 * The fields Airtable says it cannot take, from its error message: a column that does not exist, a value a column rejects, or a select option that is not defined. Airtable names the column in the first two and only the value in the third, so both are looked for.
 */
function rejectedFields(err: AirtableError, fields: { [_: string]: unknown }): string[] {
	let message = err.body
	try {
		message = (JSON.parse(err.body) as { error?: { message?: string } }).error?.message ?? err.body
	} catch {
		// Not JSON; search the raw text.
	}
	const byName = Object.keys(fields).filter(k => message.includes(`"${k}"`))
	if (byName.length > 0) return byName
	return Object.keys(fields).filter(k => {
		const v = fields[k]
		return (
			(typeof v === "string" && v.length > 0 && message.includes(v))
			|| (typeof v === "number" && message.includes(`"${v}"`))
		)
	})
}

/**
 * Look for a row this submission may already have, by the only identity the table can match on: the maker's email, the project name and the stage.
 *
 * Used when the record id is unknown – a create whose response was lost can have landed without Half Life recording an id, and posting again would put a second "Pending Review" copy in front of reviewers. Returns "ambiguous" when several rows match, because adopting one and leaving the others is as wrong as adding another; a human has to look.
 */
async function findExistingRow(
	config: AirtableConfig,
	fields: { [_: string]: unknown },
): Promise<{ id: string } | "ambiguous" | null> {
	const email = fields[fieldKey(YSWS_SUBMISSION.fields.email)]
	const projectName = fields[fieldKey(YSWS_SUBMISSION.fields.projectName)]
	const stage = fields[fieldKey(YSWS_SUBMISSION.fields.stage)]
	if (
		typeof email !== "string"
		|| email.length === 0
		|| typeof projectName !== "string"
		|| projectName.length === 0
		|| typeof stage !== "string"
		|| stage.length === 0
	) {
		return null
	}

	const formula = `AND(${formulaRef(YSWS_SUBMISSION.fields.email)}='${escapeAirtableValue(email)}',${formulaRef(
		YSWS_SUBMISSION.fields.projectName,
	)}='${escapeAirtableValue(projectName)}',${formulaRef(YSWS_SUBMISSION.fields.stage)}='${escapeAirtableValue(stage)}')`

	const result = await withRateLimitRetry("findYswsSubmission", () =>
		airtableFetch<{ records?: AirtableRecord[] }>(
			config,
			`${YSWS_SUBMISSION.tableId}?maxRecords=3&filterByFormula=${encodeURIComponent(formula)}`,
		),
	)
	const records = result.records ?? []
	if (records.length === 0) return null
	if (records.length === 1) return { id: records[0]?.id ?? "" }
	return "ambiguous"
}

/**
 * Create the row, or update it when its record id is known.
 *
 * If Airtable refuses a column, the row is written without it and the column is logged: a submission reaching the table with one blank field is recoverable, and one that never arrives is not. Resolves to the record id, and the columns that had to be left out.
 */
export async function writeYswsRecord(
	fields: { [_: string]: unknown },
	recordId: string | null,
): Promise<{ recordId: string; dropped: string[] } | { skipped: "not_configured" }> {
	const config = getAirtableConfig()
	if (!config) {
		console.warn("[airtable] not configured; skipping YSWS submission write")
		return { skipped: "not_configured" }
	}

	const send = (f: { [_: string]: unknown }, id: string | null) =>
		withRateLimitRetry(
			id ? "updateYswsSubmission" : "createYswsSubmission",
			() =>
				airtableFetch<{ records: AirtableRecord[] }>(config, YSWS_SUBMISSION.tableId, {
					body: JSON.stringify({ records: [id ? { fields: f, id } : { fields: f }], typecast: false }),
					method: id ? "PATCH" : "POST",
				}),
			// A create is not idempotent: retrying a 5xx whose row was actually written duplicates it. The hourly retry job re-runs the whole sync instead, and finds the row (or adopts it) before posting again.
			{ retryServerErrors: id !== null },
		)

	const current = { ...fields }
	let id = recordId
	if (!id) {
		const existing = await findExistingRow(config, fields)
		if (existing === "ambiguous")
			throw new Error("More than one Airtable row matches this submission; resolve the duplicate before syncing")
		if (existing) {
			console.warn(`[airtable] adopting existing YSWS row ${existing.id}; the previous write left no record id`)
			id = existing.id
		}
	}
	const dropped: string[] = []
	for (;;) {
		try {
			const result = await send(current, id)
			const record = result.records[0]
			if (!record) throw new Error("Airtable write returned no record")
			return { dropped, recordId: record.id }
		} catch (err) {
			if (!(err instanceof AirtableError)) throw err
			// The row was deleted in the base since we wrote it: start a new one.
			if (id && (err.status === 404 || err.body.includes("ROW_DOES_NOT_EXIST"))) {
				console.warn(`[airtable] YSWS row ${id} is gone; creating a new one`)
				id = null
				continue
			}
			const bad = err.status === 422 ? rejectedFields(err, current) : []
			if (bad.length === 0 || dropped.length + bad.length > MAX_DROPPED_FIELDS) throw err
			console.warn(
				`[airtable] YSWS refused ${bad.map(b => `"${b}"`).join(", ")}; writing without: ${err.body.slice(0, 200)}`,
			)
			for (const b of bad) delete current[b]
			dropped.push(...bad)
		}
	}
}

/**
 * Move one existing row on, by record id.
 *
 * The difference from `writeYswsRecord` is what a missing row means. That one adopts a match or creates, because it is the write that has to land; this one is only ever called for a row Half Life already recorded an id for, so a 404 is the row having been taken back – reported, never turned into a new row that nobody reviewed.
 *
 * Deliberately a straight PATCH rather than a copy of the drop-and-retry above: shedding a field there keeps a submission arriving, but a field Airtable refuses is one it did not write, and retrying without it would report an update that never happened. The error body names the column and value Airtable refused, which is the whole diagnosis for a status that is not an option on the column, say.
 */
export async function updateYswsRecord(
	recordId: string,
	fields: { [_: string]: unknown },
): Promise<{ ok: true } | { ok: false; reason: string }> {
	const config = getAirtableConfig()
	if (!config) return { ok: false, reason: "not_configured" }
	try {
		await withRateLimitRetry("updateYswsSubmission", () =>
			airtableFetch<{ records: AirtableRecord[] }>(config, YSWS_SUBMISSION.tableId, {
				body: JSON.stringify({ records: [{ fields, id: recordId }], typecast: false }),
				method: "PATCH",
			}),
		)
		return { ok: true }
	} catch (err) {
		if (err instanceof AirtableError && (err.status === 404 || err.body.includes("ROW_DOES_NOT_EXIST")))
			return { ok: false, reason: "row_gone" }
		return {
			ok: false,
			reason: err instanceof AirtableError ? `${err.status}: ${err.body.slice(0, 200)}` : "unknown",
		}
	}
}

/**
 * Delete one row by record id, reporting its unified-base twin (if the pipeline has made one) so that can be removed by exact id too.
 */
export async function deleteYswsRecord(
	recordId: string,
): Promise<{ deleted: boolean; unifiedRecordId: string | null; skipped?: string }> {
	const config = getAirtableConfig()
	if (!config) return { deleted: false, skipped: "not_configured", unifiedRecordId: null }
	try {
		const row = await withRateLimitRetry("readYswsSubmission", () =>
			airtableFetch<AirtableRecord>(config, `${YSWS_SUBMISSION.tableId}/${encodeURIComponent(recordId)}`),
		)
		const twin = row.fields[YSWS_SUBMISSION.fields.unifiedRecordId.name]
		await withRateLimitRetry("deleteYswsSubmission", () =>
			airtableFetch<{ deleted: boolean }>(config, `${YSWS_SUBMISSION.tableId}/${encodeURIComponent(recordId)}`, {
				method: "DELETE",
			}),
		)
		return { deleted: true, unifiedRecordId: typeof twin === "string" && twin ? twin : null }
	} catch (err) {
		if (err instanceof AirtableError && (err.status === 404 || err.body.includes("ROW_DOES_NOT_EXIST"))) {
			return { deleted: false, skipped: "already_gone", unifiedRecordId: null }
		}
		// A missing write grant is an ops problem, not a reason to fail the participant's unsubmit.
		if (err instanceof AirtableError && err.isPermission) {
			return { deleted: false, skipped: "no_write_access", unifiedRecordId: null }
		}
		throw err
	}
}

/** Remove rows in the shared unified base by exact record id. */
export async function deleteUnifiedRecords(
	recordIds: string[],
): Promise<{ deleted: string[]; skipped?: string; error?: string }> {
	if (recordIds.length === 0) return { deleted: [] }
	const apiKey = process.env.AIRTABLE_API_KEY
	const baseId = process.env.AIRTABLE_UNIFIED_BASE_ID
	const table = process.env.AIRTABLE_UNIFIED_APPROVED_TABLE
	if (!apiKey || !baseId || !table) return { deleted: [], skipped: "not_configured" }

	const query = recordIds.map(id => `records[]=${encodeURIComponent(id)}`).join("&")
	try {
		const result = await withRateLimitRetry("deleteUnifiedRecords", () =>
			airtableFetch<{ records: { id: string }[] }>({ apiKey, baseId }, `${table}?${query}`, { method: "DELETE" }),
		)
		return { deleted: result.records.map(r => r.id) }
	} catch (err) {
		if (err instanceof AirtableError && err.isPermission) {
			return { deleted: [], error: err.message, skipped: "no_write_access" }
		}
		throw err
	}
}
