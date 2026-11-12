import "server-only"
import { AirtableListSchema, airtableFetch, getAirtableConfig, withRateLimitRetry } from "@/lib/airtable/client"
import { YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "@/lib/airtable/sync"
import { Phase } from "@/lib/enums"
import db from "@/lib/prisma8"
import { fundingGivenPatch } from "@/lib/starter-funding"

/**
 * The Airtable write behind the grant wave: after a card is issued to a Week 1 starter, its `Funding given` is set to the total sent, so the starter export counts that money.
 */

/**
 * Sets `Funding given` on a project's Airtable design row. Returns the reason it could not, or null when it was written.
 *
 * It finds the row the same way the starter export does, from the project's sync history, so a project with no linked row is reported rather than guessed at.
 */
export async function writeStarterFundingGiven(projectId: string, totalUsd: number): Promise<string | null> {
	const config = getAirtableConfig()
	if (!config) return "Airtable is not configured"
	const events = await db.orm.public.AuditLog.where({ action: "AIRTABLE_SYNC_SUCCESS" })
		.where(entry => entry.targetId.in([projectId]))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const recordId = recordIdsFromSyncEvents(events).get(`${projectId}:${Phase.DESIGN}`) ?? null
	if (!recordId) return "No Airtable row is linked to this project"

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
