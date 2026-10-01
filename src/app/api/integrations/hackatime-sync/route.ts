import type { NextRequest } from "next/server"
import { ok, withRoute } from "@/lib/api"
import { refreshLinkCache } from "@/lib/hackatime"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import prisma from "@/lib/prisma"
import { recordSyncRun } from "@/lib/sync-run-log"

export const maxDuration = 300

/**
 * At most this many links refreshed per run. The job runs every 15 minutes,
 * and each link can sit on a 10-second Hackatime timeout, so an unbounded run
 * over a real cohort exceeds `maxDuration` and is killed before it records
 * anything.
 */
const BATCH_SIZE = 200

/**
 * Every integration route takes `?dryRun=true` and returns what it would have
 * done without writing. This is the single thing that makes scheduled work
 * debuggable in production.
 */
export const POST = withRoute(async (req: NextRequest) => {
	const denied = requireIntegrationAuth(req)
	if (denied) return denied

	const dryRun = req.nextUrl.searchParams.get("dryRun") === "true"
	const started = Date.now()

	const links = await prisma.hackatimeLink.findMany({
		where: { hoursApproved: null },
		// Least-recently refreshed first (never-refreshed before those), so a run
		// that hits the batch bound still advances through the whole set instead
		// of restarting at the same head of the list every 15 minutes.
		orderBy: { cachedAt: { sort: "asc", nulls: "first" } },
		take: BATCH_SIZE,
		select: { id: true },
	})

	if (dryRun) {
		return ok({ dryRun: true, scanned: links.length, updated: 0, failed: 0 })
	}

	let updated = 0
	let failed = 0
	for (const link of links) {
		const result = await refreshLinkCache(link.id)
		if (result.stale) failed++
		else updated++
	}

	const summary = {
		scanned: links.length,
		updated,
		failed,
		limited: links.length === BATCH_SIZE,
		durationMs: Date.now() - started,
	}
	await recordSyncRun("hackatime", summary)
	return ok(summary)
})
