import "server-only"
import { type AirtableConfig, type AirtableRecord, airtableFetch, withRateLimitRetry } from "@/lib/airtable/client"
import { fieldKey, YSWS_SUBMISSION } from "@/lib/airtable/schema"

/**
 * Every row's current review status and note, by record id.
 *
 * Airtable lists at most a page of rows per request, so the whole table is walked once. The callers compare this against what Postgres holds and write only the rows that disagree, which is why they need the table in one map rather than a request per record.
 */
export async function currentReviewColumns(
	config: AirtableConfig,
): Promise<Map<string, { note: string; status: string }>> {
	const statusKey = fieldKey(YSWS_SUBMISSION.fields.reviewStatus)
	const notesKey = fieldKey(YSWS_SUBMISSION.fields.reviewerNotes)
	const fieldsQs = [statusKey, notesKey].map(key => `fields%5B%5D=${encodeURIComponent(key)}`).join("&")
	const byId = new Map<string, { note: string; status: string }>()
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
				status: typeof record.fields[statusKey] === "string" ? record.fields[statusKey] : "",
			})
		offset = page.offset
	} while (offset)
	return byId
}
