import "server-only"
import { type AirtableConfig, type AirtableRecord, airtableFetch, withRateLimitRetry } from "@/lib/airtable/client"
import { columnExists } from "@/lib/airtable/field-probe"
import { fieldKey, YSWS_SUBMISSION } from "@/lib/airtable/schema"

/**
 * Every row's current review status, note and first-pass reviewer, by record id.
 *
 * Airtable lists at most a page of rows per request, so the whole table is walked once. The callers compare this against what Postgres holds and write only the rows that disagree, which is why they need the table in one map rather than a request per record.
 *
 * The reviewer column is probed first: a base that predates it would refuse the whole listing over one unknown `fields[]` entry, leaving every row unreadable rather than just that column blank.
 */
export async function currentReviewColumns(
	config: AirtableConfig,
): Promise<Map<string, { note: string; pass1Reviewer: string; status: string }>> {
	const statusKey = fieldKey(YSWS_SUBMISSION.fields.reviewStatus)
	const notesKey = fieldKey(YSWS_SUBMISSION.fields.reviewerNotes)
	const pass1Field = YSWS_SUBMISSION.fields.pass1Reviewer
	const pass1Key = fieldKey(pass1Field)
	const hasPass1 = await columnExists(config, YSWS_SUBMISSION.tableId, pass1Field.name)
	const fieldsQs = [statusKey, notesKey, ...(hasPass1 ? [pass1Key] : [])]
		.map(key => `fields%5B%5D=${encodeURIComponent(key)}`)
		.join("&")
	const byId = new Map<string, { note: string; pass1Reviewer: string; status: string }>()
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listYswsReviewColumns", () =>
			airtableFetch<{ records: AirtableRecord[]; offset?: string }>(
				config,
				`${encodeURIComponent(YSWS_SUBMISSION.tableId)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const record of page.records)
			byId.set(record.id, {
				note: typeof record.fields[notesKey] === "string" ? record.fields[notesKey] : "",
				pass1Reviewer: hasPass1 && typeof record.fields[pass1Key] === "string" ? record.fields[pass1Key] : "",
				status: typeof record.fields[statusKey] === "string" ? record.fields[statusKey] : "",
			})
		offset = page.offset
	} while (offset)
	return byId
}
