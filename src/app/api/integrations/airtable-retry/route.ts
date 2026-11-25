import type { NextRequest } from "next/server"
import { findUnsyncedSubmissions, syncSubmissionToYsws } from "@/lib/airtable/sync"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import { trackSideEffect } from "@/lib/side-effects"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * Replays submission rows that never reached the YSWS table. Loops emails makers from that table, so a row that failed to write is a decision the maker is never told about.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const pending = await findUnsyncedSubmissions()

	if (dryRun) return ok({ dryRun: true, pending })

	let synced = 0
	let skipped = 0
	let failed = 0
	for (const item of pending) {
		const result = await trackSideEffect(
			"airtable",
			{
				actorId: null,
				metadata: { phase: item.phase, retry: true },
				targetId: item.themeProjectId,
				targetType: "ThemeProject",
			},
			() => syncSubmissionToYsws(item.themeProjectId, item.phase),
		)
		if (!result) failed++
		else if ("skipped" in result) skipped++
		else synced++
	}

	const summary = { attempted: pending.length, failed, skipped, synced }
	await recordSyncRun("airtable_ysws", summary)
	return ok(summary)
})
