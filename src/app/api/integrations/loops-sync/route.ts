import type { NextRequest } from "next/server"
import { syncLoopsProperties } from "@/lib/airtable/loops"
import { ok, withRoute } from "@/lib/api"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * Push the Loops properties (last login, last entry, one checkbox per week) to
 * the Signups table. Meant to run on a schedule from Orchard, like the other
 * integration jobs; `?dryRun=true` reports what would change without writing.
 */
export const POST = withRoute(async (req: NextRequest) => {
	const denied = requireIntegrationAuth(req)
	if (denied) return denied

	const dryRun = req.nextUrl.searchParams.get("dryRun") === "true"
	const result = await syncLoopsProperties({ dryRun })
	if (!dryRun && "updated" in result) {
		await recordSyncRun("airtable_loops", {
			users: result.users,
			matched: result.matched,
			matchedById: result.matchedById,
			matchedByRecord: result.matchedByRecord,
			matchedByEmail: result.matchedByEmail,
			unmatched: result.unmatched,
			updated: result.updated,
			// Logged rather than assumed, so the sync-run history says "wrote
			// nothing" instead of showing a healthy row for a broken join.
			degraded: result.degraded,
		})
	}
	return ok(result)
})
