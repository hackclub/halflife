import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import prisma from "@/lib/prisma"

/** Keep these literals stable – admin surfaces match them by string. */
export type SyncKey =
	| "hackatime"
	| "airtable_ysws"
	| "airtable_rsvp"
	| "airtable_loops"
	| "ari_ship"
	| "claim_sweep"
	| "printer_reconcile"
	| "help_ticket_summary"

/**
 * One row per successful run. Failures go to the audit log instead, so a
 * timestamp in this table always means a real round trip completed.
 */
export async function recordSyncRun(
	syncKey: SyncKey,
	result: Prisma.InputJsonValue | null,
	actorId: string | null = null,
): Promise<void> {
	try {
		await prisma.syncRunLog.create({
			data: { syncKey, result: result ?? undefined, actorId },
		})
	} catch (err) {
		// Never fail a sync because its bookkeeping row didn't land.
		console.error(`[sync] failed to record run for ${syncKey}:`, err)
	}
}

export interface LatestSyncRun {
	syncKey: string
	lastRunAt: Date
	result: unknown
	actor: { id: string; name: string | null; email: string } | null
}

export async function getLatestSyncRuns(keys: SyncKey[]): Promise<LatestSyncRun[]> {
	const rows = await Promise.all(
		keys.map((syncKey) =>
			prisma.syncRunLog.findFirst({
				where: { syncKey },
				orderBy: { createdAt: "desc" },
				include: { actor: { select: { id: true, name: true, email: true } } },
			}),
		),
	)
	return rows
		.filter((r): r is NonNullable<typeof r> => r !== null)
		.map((r) => ({
			syncKey: r.syncKey,
			lastRunAt: r.createdAt,
			result: r.result,
			actor: r.actor,
		}))
}
