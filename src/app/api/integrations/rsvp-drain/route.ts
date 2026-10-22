import type { NextRequest } from "next/server"
import { drainRsvpBuffer } from "@/lib/airtable/rsvp"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const result = await drainRsvpBuffer(100, { dryRun })
	if (!dryRun && !result.skipped) {
		await recordSyncRun("airtable_rsvp", { ...result })
		// Said out loud, because a base without the user-id column drains cleanly forever while quietly never filling it, and the column is what the Loops sync joins on.
		if (result.skippedUserId > 0)
			console.warn(
				`[airtable] rsvp-drain wrote ${result.updated + result.created} row(s) but skipped the user id on `
					+ `${result.skippedUserId} of them: the Signups table has no \`Half-Life User ID\` column. Add it and `
					+ "the next run fills it.",
			)
	}
	return ok({ dryRun, ...result })
})
