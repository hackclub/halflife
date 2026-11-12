import "server-only"
import {
	AirtableListSchema,
	airtableFetch,
	chunk,
	escapeAirtableValue,
	getAirtableConfig,
	withRateLimitRetry,
} from "@/lib/airtable/client"
import { fieldKey, YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "@/lib/airtable/sync"
import { Phase } from "@/lib/enums"
import db from "@/lib/prisma8"
import { fundingGivenPatch } from "@/lib/starter-funding"

/**
 * Reads and writes a Week 1 starter's `Funding given` in Airtable, for the grant wave.
 *
 * A starter with money already recorded is kept out of the wave, and a card's total is written here before the card goes out, so the starter export always counts it.
 */

/** The Airtable design row for each project, from its sync history. A project with none is left out of the map. */
export async function starterRecordIds(projectIds: readonly string[]): Promise<Map<string, string>> {
	const byKey = new Map<string, string>()
	if (projectIds.length === 0) return byKey
	const events = await db.orm.public.AuditLog.where({ action: "AIRTABLE_SYNC_SUCCESS" })
		.where(entry => entry.targetId.in([...projectIds]))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	return recordIdsFromSyncEvents(events)
}

/**
 * `Funding given` for each design row, keyed by record ID. Null when Airtable cannot be read, so the caller fails closed rather than treating an unreadable row as nothing paid.
 */
export async function readStarterFundingGiven(recordIds: readonly string[]): Promise<Map<string, number> | null> {
	const config = getAirtableConfig()
	if (!config) return null
	const amounts = new Map<string, number>()
	if (recordIds.length === 0) return amounts
	const field = YSWS_SUBMISSION.fields.fundingGiven
	try {
		for (const part of chunk([...recordIds], 50)) {
			const formula = `OR(${part.map(id => `RECORD_ID()='${escapeAirtableValue(id)}'`).join(",")})`
			const result = await withRateLimitRetry("readStarterFundingGiven", () =>
				airtableFetch(
					AirtableListSchema,
					config,
					`${YSWS_SUBMISSION.tableId}?maxRecords=${part.length}&fields[]=${encodeURIComponent(fieldKey(field))}&filterByFormula=${encodeURIComponent(formula)}`,
				),
			)
			for (const record of result.records ?? []) {
				const value = record.fields[field.name]
				amounts.set(record.id, typeof value === "number" && Number.isFinite(value) ? value : 0)
			}
		}
	} catch (err) {
		console.error("[airtable] could not read Funding given for the grant wave:", err)
		return null
	}
	return amounts
}

/** Sets `Funding given` on one design row. Returns the reason it could not, or null when it was written. */
export async function setStarterFundingGiven(recordId: string, totalUsd: number): Promise<string | null> {
	const config = getAirtableConfig()
	if (!config) return "Airtable is not configured"
	try {
		await withRateLimitRetry("writeStarterFundingGiven", () =>
			airtableFetch(AirtableListSchema, config, YSWS_SUBMISSION.tableId, {
				body: fundingGivenPatch(recordId, YSWS_SUBMISSION.fields.fundingGiven.name, totalUsd),
				method: "PATCH",
			}),
		)
		return null
	} catch (err) {
		return err instanceof Error ? err.message : String(err)
	}
}

/** Sets `Funding given` for a project's design row, from its sync history. Returns the reason it could not, or null when it was written. */
export async function writeStarterFundingGiven(projectId: string, totalUsd: number): Promise<string | null> {
	const recordId = (await starterRecordIds([projectId])).get(`${projectId}:${Phase.DESIGN}`) ?? null
	if (!recordId) return "No Airtable row is linked to this project"
	return setStarterFundingGiven(recordId, totalUsd)
}
