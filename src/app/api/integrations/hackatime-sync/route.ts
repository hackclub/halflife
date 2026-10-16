import type { NextRequest } from "next/server"
import { ok } from "@/lib/api"
import { refreshLinkCache } from "@/lib/hackatime"
import { warmLinkSpans } from "@/lib/hours"
import { wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import prisma from "@/lib/prisma"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * At most this many links refreshed per run. The job runs every 15 minutes, and each link can sit on a 10-second Hackatime timeout, so an unbounded run over a real cohort exceeds `maxDuration` and is killed before it records anything.
 */
const BATCH_SIZE = 200

/**
 * Every integration route takes `?dryRun=true` and returns what it would have done without writing. This is the single thing that makes scheduled work debuggable in production.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const dryRun = wantsDryRun(req)
	const started = Date.now()

	const links = await prisma.hackatimeLink.findMany({
		// Least-recently refreshed first (never-refreshed before those), so a run that hits the batch bound still advances through the whole set instead of restarting at the same head of the list every 15 minutes.
		orderBy: { cachedAt: { nulls: "first", sort: "asc" } },
		// cachedSpans rides along so the warm below can tell a link that already answers from one whose cache was never written or was fetched for a narrower window, and the owner's id so a recording attached under another project can be found and warmed for.
		select: {
			cachedSpans: true,
			hackatimeProject: true,
			id: true,
			phase: true,
			themeProject: { select: { userId: true } },
			themeProjectId: true,
		},
		take: BATCH_SIZE,
		where: { hoursApproved: null },
	})

	if (dryRun) {
		return ok({ dryRun: true, failed: 0, scanned: links.length, updated: 0 })
	}

	let updated = 0
	let failed = 0
	for (const link of links) {
		const result = await refreshLinkCache(link.id)
		if (result.stale) failed++
		else updated++
	}

	// The tracked intervals the deduplication depends on, warmed here rather than only when a recording is attached or a reviewer approves. Without this the seconds above are fresh while the spans stay cold, and every screen that reads the cache in between reports the same sitting twice – which is the complaint this run exists to end.
	const spans = await warmLinkSpans(
		links.map(l => ({
			cachedSpans: l.cachedSpans,
			hackatimeProject: l.hackatimeProject,
			id: l.id,
			phase: l.phase,
			themeProjectId: l.themeProjectId,
			userId: l.themeProject.userId,
		})),
	)

	const summary = {
		durationMs: Date.now() - started,
		failed,
		limited: links.length === BATCH_SIZE,
		scanned: links.length,
		spansFailed: spans.failed,
		spansWarmed: spans.warmed,
		updated,
	}
	await recordSyncRun("hackatime", summary)
	return ok(summary)
})
