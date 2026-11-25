import "server-only"
import type { JsonValue } from "@/lib/json"
import db from "@/lib/prisma8"
import { parseDbTimestamp } from "@/lib/time"

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
	| "project_review_summary"

/**
 * One row per successful run. Failures go to the audit log instead, so a timestamp in this table always means a real round trip completed.
 */
export async function recordSyncRun(
	syncKey: SyncKey,
	result: JsonValue | null,
	actorId: string | null = null,
): Promise<void> {
	try {
		await db.orm.public.SyncRunLog.create({ actorId, result: result ?? undefined, syncKey })
	} catch (err) {
		// Never fail a sync because its bookkeeping row didn't land.
		console.error(`[sync] failed to record run for ${syncKey}:`, err)
	}
}

export interface LatestSyncRun {
	actor: { id: string; name: string | null; email: string } | null
	lastRunAt: Date
	result: unknown
	syncKey: string
}

export async function getLatestSyncRuns(keys: SyncKey[]): Promise<LatestSyncRun[]> {
	const rows = await Promise.all(
		keys.map(syncKey =>
			db.orm.public.SyncRunLog.where({ syncKey })
				.orderBy(run => run.createdAt.desc())
				.include("actor", actor => actor.select("email", "id", "name"))
				.first(),
		),
	)
	return rows
		.filter((r): r is NonNullable<typeof r> => r !== null)
		.map(r => ({
			actor: r.actor,
			lastRunAt: parseDbTimestamp(r.createdAt),
			result: r.result,
			syncKey: r.syncKey,
		}))
}
