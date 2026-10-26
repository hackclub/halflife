import "server-only"
import { AuditAction, logAudit } from "@/lib/audit"
import type { InputJsonValue } from "@/lib/json"

export interface SideEffectContext {
	actorEmail?: string | null
	actorId: string | null
	metadata?: InputJsonValue
	targetId: string
	targetType: string
}

/** The metadata object to spread into an audit row, ignoring JSON values that are not objects. */
function metadataObject(value: InputJsonValue | undefined): { [_: string]: InputJsonValue } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
	return value as { [_: string]: InputJsonValue }
}

/**
 * Run an external side effect so its outcome becomes a queryable audit row rather than a swallowed console error.
 *
 * The reviewer never sees these failures – the audit log is the operational signal an admin queries to spot a regression, and the recovery route (`POST /api/admin/theme-projects/[id]/sync-to-airtable`) is how they fix it.
 */
export async function trackSideEffect<T>(
	kind: "airtable" | "slack" | "ari",
	ctx: SideEffectContext,
	fn: () => Promise<T>,
	opts: {
		/**
		 * Rethrow after recording the failure. For a manual action whose caller can show the reason – the admin's Retry button, say – swallowing it into the audit log alone leaves the person staring at a generic error.
		 */
		rethrow?: boolean
	} = {},
): Promise<T | null> {
	try {
		const result = await fn()
		// A skipped write – sync disabled, the service unconfigured, the project gone – is not a completed side effect: a success audit row for work that never happened turns the retry jobs green and hides the outage.
		const skipped = result !== null && typeof result === "object" && "skipped" in result
		if (kind === "airtable" && !skipped) {
			// A write that made or found an Airtable row reports its record id, and it is kept here: the YSWS table has no column of ours to find the row by later, so this is how a re-submission updates it and an unsubmit deletes it (lib/airtable/sync). A write that was skipped – sync turned off, Airtable not configured – logs no id, so it is retried later.
			const recordId =
				result && typeof result === "object" && "recordId" in result && typeof result.recordId === "string"
					? result.recordId
					: undefined
			await logAudit({
				action: AuditAction.AIRTABLE_SYNC_SUCCESS,
				actorEmail: ctx.actorEmail,
				actorId: ctx.actorId,
				metadata: {
					...metadataObject(ctx.metadata),
					...(recordId ? { recordId } : {}),
				},
				targetId: ctx.targetId,
				targetType: ctx.targetType,
			})
		} else if (kind === "ari" && !skipped)
			// The send itself records the Ari submission id on the row; this is the operational trace that it happened.
			await logAudit({
				action: AuditAction.ARI_SYNC_SUCCESS,
				actorEmail: ctx.actorEmail,
				actorId: ctx.actorId,
				metadata: {
					...metadataObject(ctx.metadata),
					...(result && typeof result === "object" && "id" in result && typeof result.id === "string"
						? { ariSubmissionId: result.id }
						: {}),
				},
				targetId: ctx.targetId,
				targetType: ctx.targetType,
			})

		return result
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		// An upstream rejection says all it can in its message; in production its stack points into minified chunks and buries the one line an operator reads. A failure without a status is our own bug, so that one keeps its stack.
		const rejected = typeof err === "object" && err !== null && "status" in err && "code" in err
		if (rejected) console.error(`[side-effect] ${kind} failed for ${ctx.targetType}:${ctx.targetId}: ${message}`)
		else console.error(`[side-effect] ${kind} failed for ${ctx.targetType}:${ctx.targetId}:`, err)
		await logAudit({
			action:
				kind === "airtable"
					? AuditAction.AIRTABLE_SYNC_FAILURE
					: kind === "ari"
						? AuditAction.ARI_SYNC_FAILURE
						: AuditAction.NOTIFICATION_FAILURE,
			actorEmail: ctx.actorEmail,
			actorId: ctx.actorId,
			metadata: { ...metadataObject(ctx.metadata), error: message },
			targetId: ctx.targetId,
			targetType: ctx.targetType,
		})
		if (opts.rethrow) throw err
		return null
	}
}
