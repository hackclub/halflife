import type { NextRequest } from "next/server"
import { findUnsyncedSubmissions, syncSubmissionToYsws } from "@/lib/airtable/sync"
import { ok, withRoute } from "@/lib/api"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import { trackSideEffect } from "@/lib/side-effects"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * Replays submission rows that never reached the YSWS table. Reviewers work
 * from that table on ari.hackclub.com, so a row that failed to write is a
 * submission nobody can see – this is what keeps an Airtable outage from
 * turning into a project that is never reviewed.
 */
export const POST = withRoute(async (req: NextRequest) => {
	const denied = requireIntegrationAuth(req)
	if (denied) return denied

	const dryRun = req.nextUrl.searchParams.get("dryRun") === "true"
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
				targetType: "ThemeProject",
				targetId: item.themeProjectId,
				metadata: { phase: item.phase, retry: true },
			},
			() => syncSubmissionToYsws(item.themeProjectId, item.phase),
		)
		if (!result) failed++
		else if ("skipped" in result) skipped++
		else synced++
	}

	const summary = { attempted: pending.length, synced, skipped, failed }
	await recordSyncRun("airtable_ysws", summary)
	return ok(summary)
})
