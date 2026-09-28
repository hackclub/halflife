import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import { AuditAction, logAudit } from "@/lib/audit"

export interface SideEffectContext {
  actorId: string | null
  actorEmail?: string | null
  targetType: string
  targetId: string
  metadata?: Prisma.InputJsonValue
}

/**
 * Run an external side effect so its outcome becomes a queryable audit row
 * rather than a swallowed console error.
 *
 * The reviewer never sees these failures — the audit log is the operational
 * signal an admin queries to spot a regression, and the recovery route
 * (`POST /api/admin/theme-projects/[id]/sync-to-airtable`) is how they fix it.
 */
export async function trackSideEffect<T>(
  kind: "airtable" | "slack" | "ari" | "email",
  ctx: SideEffectContext,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    const result = await fn()
    if (kind === "airtable") {
      // A write that made or found an Airtable row reports its record id, and
      // it is kept here: the YSWS table has no column of ours to find the row
      // by later, so this is how a re-submission updates it and an unsubmit
      // deletes it (lib/airtable/sync). A write that was skipped — sync turned
      // off, Airtable not configured — logs no id, so it is retried later.
      const recordId =
        result && typeof result === "object" && "recordId" in result && typeof result.recordId === "string"
          ? result.recordId
          : undefined
      await logAudit({
        action: AuditAction.AIRTABLE_SYNC_SUCCESS,
        actorId: ctx.actorId,
        actorEmail: ctx.actorEmail,
        targetType: ctx.targetType,
        targetId: ctx.targetId,
        metadata: {
          ...(typeof ctx.metadata === "object" && ctx.metadata !== null && !Array.isArray(ctx.metadata)
            ? ctx.metadata
            : {}),
          ...(recordId ? { recordId } : {}),
        },
      })
    } else if (kind === "ari") {
      // The send itself records the Ari submission id on the row; this is the
      // operational trace that it happened.
      await logAudit({
        action: AuditAction.ARI_SYNC_SUCCESS,
        actorId: ctx.actorId,
        actorEmail: ctx.actorEmail,
        targetType: ctx.targetType,
        targetId: ctx.targetId,
        metadata: {
          ...(typeof ctx.metadata === "object" && ctx.metadata !== null && !Array.isArray(ctx.metadata)
            ? ctx.metadata
            : {}),
          ...(result && typeof result === "object" && "id" in result && typeof result.id === "string"
            ? { ariSubmissionId: result.id }
            : {}),
        },
      })
    }
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[side-effect] ${kind} failed for ${ctx.targetType}:${ctx.targetId}:`, err)
    await logAudit({
      action:
        kind === "airtable"
          ? AuditAction.AIRTABLE_SYNC_FAILURE
          : kind === "ari"
            ? AuditAction.ARI_SYNC_FAILURE
            : AuditAction.NOTIFICATION_FAILURE,
      actorId: ctx.actorId,
      actorEmail: ctx.actorEmail,
      targetType: ctx.targetType,
      targetId: ctx.targetId,
      metadata: { ...(typeof ctx.metadata === "object" ? ctx.metadata : {}), error: message },
    })
    return null
  }
}
