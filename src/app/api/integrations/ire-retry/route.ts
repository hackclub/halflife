import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import { isIreConfigured } from "@/lib/ire-platform"
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
 * Keep the shadow queue in Ire honest.
 *
 * Three jobs in one pass: refresh the open ships so a lost response or an operator's withdraw is noticed, replay the hand-ins that have no healthy ship, and close the copies whose local phase has left review. The local phase is authoritative; nothing here applies a decision, writes credit, mirrors Airtable or notifies a maker.
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
				metadata: { phase: item.phase, retry: true, shadow: true },
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
	if (isIreConfigured()) await recordSyncRun("ire_ship", summary)
	return ok(summary)
})
