import type { NextRequest } from "next/server"
import { syncLoopsProperties } from "@/lib/airtable/loops"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * Push the Loops properties (last login, last entry, one checkbox per week) to the Signups table. Meant to run on a schedule from Orchard, like the other integration jobs; `?dryRun=true` reports what would change without writing.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const result = await syncLoopsProperties({ dryRun })
	if (!dryRun && "updated" in result) {
		await recordSyncRun("airtable_loops", {
			// Logged rather than assumed, so the sync-run history says "wrote nothing" instead of showing a healthy row for a broken join.
			degraded: result.degraded,
			matched: result.matched,
			matchedByEmail: result.matchedByEmail,
			matchedById: result.matchedById,
			matchedByRecord: result.matchedByRecord,
			relinked: result.relinked,
			unmatched: result.unmatched,
			updated: result.updated,
			users: result.users,
		})
	}
	return ok(result)
})
