import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import { isReviewConfigured } from "@/lib/review-platform"
import {
	closeResolvedReviewShips,
	findUnsyncedReviewSubmissions,
	refreshOpenReviewShips,
	sendSubmissionToReview,
} from "@/lib/review-shadow"
import { trackSideEffect } from "@/lib/side-effects"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * Keep the shadow queue in Review honest.
 *
 * Three jobs in one pass: refresh the open ships so a lost response or an operator's withdraw is noticed, replay the hand-ins that have no healthy ship, and close the copies whose local phase has left review. The local phase is authoritative; nothing here applies a decision, writes credit, mirrors Airtable or notifies a maker.
 *
 * `?dryRun=true` reports what is pending without writing. The route is separate from `ari-retry` so a Review outage cannot delay an Ari retry.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const pending = await findUnsyncedReviewSubmissions()

	if (dryRun) return ok({ dryRun: true, pending })

	const status = await refreshOpenReviewShips({ limit: 50 })

	let failed = 0
	let skipped = 0
	let synced = 0
	for (const item of pending) {
		const result = await trackSideEffect(
			"review",
			{
				actorId: null,
				metadata: { phase: item.phase, retry: true, shadow: true },
				targetId: item.themeProjectId,
				targetType: "ThemeProject",
			},
			() => sendSubmissionToReview(item.themeProjectId, item.phase),
		)
		if (!result) failed++
		else if ("skipped" in result) skipped++
		else synced++
	}

	const close = await closeResolvedReviewShips({ limit: 100 })

	const summary = {
		attempted: pending.length,
		closeChecked: close.checked,
		closed: close.closed,
		closeFailed: close.failed,
		closeSkipped: close.skipped,
		failed,
		missing: status.missing,
		skipped,
		statusChecked: status.checked,
		statusFailed: status.failed,
		synced,
	}
	if (isReviewConfigured()) await recordSyncRun("review_ship", summary)
	return ok(summary)
})
