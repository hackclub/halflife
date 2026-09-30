import { fail, ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { claimSubmission, releaseClaim } from "@/lib/review"

type Params = { params: Promise<{ id: string }> }

export const POST = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.REVIEW_SUBMISSIONS)
  if (gate.error) return gate.error
  const { id } = await params

  const result = await claimSubmission(id, gate.user.id)
  if (!result.ok) {
    return fail(
      "CLAIMED_BY_OTHER",
      `${result.heldByName ?? "Another reviewer"} is reviewing this until ${result.expiresAt.toISOString()}`,
      { heldBy: result.heldBy, expiresAt: result.expiresAt },
    )
  }

  await logAudit({
    action: AuditAction.REVIEW_CLAIM,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "PhaseSubmission",
    targetId: id,
    metadata: { expiresAt: result.expiresAt.toISOString() },
  })

  return ok({ expiresAt: result.expiresAt })
})

export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.REVIEW_SUBMISSIONS)
  if (gate.error) return gate.error
  const { id } = await params

  await releaseClaim(id, gate.user.id)

  await logAudit({
    action: AuditAction.REVIEW_RELEASE,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "PhaseSubmission",
    targetId: id,
  })

  return ok({ ok: true })
})
