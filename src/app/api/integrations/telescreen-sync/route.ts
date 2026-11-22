import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import {
	findUnchecked,
	isRobertConfigured,
	isSporkConfigured,
	SPORK_TIMEOUT_MS,
	screenWithSpork,
	submitToRobert,
	syncRobert,
	TelescreenError,
} from "@/lib/telescreen"

export const maxDuration = 1800

const ROBERT_BATCH = 25
const SPORK_BUDGET_MS = 15 * 60_000

/**
 * Keep Telescreen's checks current (see lib/telescreen), Fabricate's `RobertSyncJob` plus its retries.
 *
 * Pulls every unresolved project's trust score and outcome from Robert, which also records the outcomes Half Life decides on its own. Then sends what Robert missed and screens what Spork missed – hand-ins still in review that were never sent or screened since they were handed in, or failed over an hour ago. Spork screens one repo at a time and a big STEP model takes minutes, so it stops starting new ones once it could run past its budget, or when Spork says it is rate limited; the rest wait for the next run.
 *
 * `?dryRun=true` reports what is pending without writing.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const pending = await findUnchecked()
	if (wantsDryRun(req)) return ok({ dryRun: true, pending })

	const robert = { failed: 0, sent: 0, synced: 0, syncFailed: 0 }
	if (isRobertConfigured()) {
		for (const themeProjectId of pending.robert.slice(0, ROBERT_BATCH))
			try {
				await submitToRobert(themeProjectId)
				robert.sent++
			} catch {
				robert.failed++
			}
		const synced = await syncRobert()
		robert.synced = synced.updated
		robert.syncFailed = synced.failed
	}

	const spork = { failed: 0, left: 0, screened: 0 }
	if (isSporkConfigured()) {
		const stopAt = Date.now() + SPORK_BUDGET_MS - SPORK_TIMEOUT_MS
		for (const [n, themeProjectId] of pending.spork.entries()) {
			if (Date.now() > stopAt) {
				spork.left = pending.spork.length - n
				break
			}
			try {
				await screenWithSpork(themeProjectId)
				spork.screened++
			} catch (err) {
				spork.failed++
				// Rate limited: the rest would be too.
				if (err instanceof TelescreenError && err.status === 429) {
					spork.left = pending.spork.length - n - 1
					break
				}
			}
		}
	}

	return ok({ robert, spork })
})
