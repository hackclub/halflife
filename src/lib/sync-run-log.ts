import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import prisma from "@/lib/prisma"

/** Keep these literals stable – admin surfaces match them by string. */
type SyncKey =
	| "hackatime"
	| "airtable_ysws"
	| "airtable_rsvp"
	| "airtable_loops"
	| "ari_ship"
	| "claim_sweep"
	| "printer_reconcile"
	| "help_ticket_summary"
	| "project_review_summary"

/**
 * One row per successful run. Failures go to the audit log instead, so a timestamp in this table always means a real round trip completed.
 */
async function recordSyncRun(
	syncKey: SyncKey,
	result: Prisma.InputJsonValue | null,
	actorId: string | null = null,
): Promise<void> {
	try {
		await prisma.syncRunLog.create({
			data: { actorId, result: result ?? undefined, syncKey },
		})
	} catch (err) {
		// Never fail a sync because its bookkeeping row didn't land.
		console.error(`[sync] failed to record run for ${syncKey}:`, err)
	}
}

interface LatestSyncRun {
	actor: { id: string; name: string | null; email: string } | null
	lastRunAt: Date
	result: unknown
	syncKey: string
}

async function getLatestSyncRuns(keys: SyncKey[]): Promise<LatestSyncRun[]> {
	const rows = await Promise.all(
		keys.map(syncKey =>
			prisma.syncRunLog.findFirst({
				include: { actor: { select: { email: true, id: true, name: true } } },
				orderBy: { createdAt: "desc" },
				where: { syncKey },
			}),
		),
	)
	return rows
		.filter((r): r is NonNullable<typeof r> => r !== null)
		.map(r => ({
			actor: r.actor,
			lastRunAt: r.createdAt,
			result: r.result,
			syncKey: r.syncKey,
		}))
}

export { getLatestSyncRuns, type LatestSyncRun, recordSyncRun, type SyncKey }
