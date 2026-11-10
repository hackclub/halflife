import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import { ireMode, isIreConfigured } from "@/lib/ire-platform"
import { reconcileIreDecisions } from "@/lib/ire-review"
import {
	closeResolvedIreShips,
	findUnsyncedIreSubmissions,
	refreshOpenIreShips,
	sendSubmissionToIre,
} from "@/lib/ire-shadow"
import { trackSideEffect } from "@/lib/side-effects"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * Keep the Ire queue honest.
 *
 * Four jobs in one pass: refresh the open ships so a lost response or an operator's withdraw is noticed, replay the hand-ins that have no healthy ship, close the copies whose local phase has left review, and – in live mode only – reconcile standing Ire decisions the webhook never delivered. The local phase is authoritative for the first three; the reconcile applies decisions through `finalizeReview`, quietly, like Ari's.
 *
 * `?dryRun=true` reports what is pending without writing. The route is separate from `ari-retry` so an Ire outage cannot delay an Ari retry.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const pending = await findUnsyncedIreSubmissions()

	if (dryRun) return ok({ dryRun: true, pending })

	const status = await refreshOpenIreShips({ limit: 50 })

	let failed = 0
	let skipped = 0
	let synced = 0
	for (const item of pending) {
		const result = await trackSideEffect(
			"ire",
			{
				actorId: null,
				metadata: { live: ireMode() === "live", phase: item.phase, retry: true },
				targetId: item.themeProjectId,
				targetType: "ThemeProject",
			},
			() => sendSubmissionToIre(item.themeProjectId, item.phase),
		)
		if (!result) failed++
		else if ("skipped" in result) skipped++
		else synced++
	}

	const close = await closeResolvedIreShips({ limit: 100 })

	// Missed decisions: a delivery the webhook never received leaves a hand-in open here while Ire has decided it. Live mode only – in shadow Ire never decides, and nothing here may move credit. Bounded, shuffled and quiet.
	let reconciled = 0
	let reconciledApplied = 0
	let reconciledDecided = 0
	let reconciledReverted = 0
	if (isIreConfigured() && ireMode() === "live") {
		const result = await reconcileIreDecisions({ announce: false, commit: true, limit: 150 })
		reconciled = result.checked
		reconciledApplied = result.applied
		reconciledDecided = result.decided
		reconciledReverted = result.reverted
	}

	const summary = {
		attempted: pending.length,
		closeChecked: close.checked,
		closed: close.closed,
		closeFailed: close.failed,
		closeSkipped: close.skipped,
		failed,
		missing: status.missing,
		reconciled,
		reconciledApplied,
		reconciledDecided,
		reconciledReverted,
		skipped,
		statusChecked: status.checked,
		statusFailed: status.failed,
		synced,
	}
	if (isIreConfigured()) await recordSyncRun("ire_ship", summary)
	return ok(summary)
})
