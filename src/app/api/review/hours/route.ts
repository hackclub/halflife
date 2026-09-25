import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { sanitizeOptional } from "@/lib/sanitize"
import { hoursDecisionSchema } from "@/lib/schemas/review"

/**
 * Batched, because a reviewer approves a whole project's hours in one pass and
 * one request per entry would be a dozen round trips per review.
 */
export const POST = withRoute(async (req: Request) => {
  const gate = await requirePermission(Permission.REVIEW_HOURS)
  if (gate.error) return gate.error

  const parsed = await parseBody(req, hoursDecisionSchema)
  if (parsed.error) return parsed.error

  // Approving hours is the other half of the money path, so it needs the same
  // rule the decision route has: nobody rules on their own work.
  const sessionIds = parsed.data.decisions.filter((d) => d.kind === "session").map((d) => d.id)
  const linkIds = parsed.data.decisions.filter((d) => d.kind === "hackatime").map((d) => d.id)
  const [ownSessions, ownLinks] = await Promise.all([
    sessionIds.length
      ? prisma.workSession.count({
          where: { id: { in: sessionIds }, themeProject: { userId: gate.user.id } },
        })
      : 0,
    linkIds.length
      ? prisma.hackatimeLink.count({
          where: { id: { in: linkIds }, themeProject: { userId: gate.user.id } },
        })
      : 0,
  ])
  if (ownSessions > 0 || ownLinks > 0) {
    return fail("FORBIDDEN", "You cannot approve hours on your own work")
  }

  const now = new Date()
  const applied = await prisma.$transaction(async (tx) => {
    const changes: { kind: string; id: string; before: number | null; after: number }[] = []

    for (const decision of parsed.data.decisions) {
      if (decision.kind === "session") {
        const before = await tx.workSession.findUnique({
          where: { id: decision.id },
          select: { hoursApproved: true },
        })
        if (!before) continue
        await tx.workSession.update({
          where: { id: decision.id },
          data: {
            hoursApproved: decision.hoursApproved,
            reviewComments: sanitizeOptional(decision.comments),
            reviewedAt: now,
            reviewedById: gate.user.id,
          },
        })
        changes.push({
          kind: "session",
          id: decision.id,
          before: before.hoursApproved,
          after: decision.hoursApproved,
        })
      } else {
        const before = await tx.hackatimeLink.findUnique({
          where: { id: decision.id },
          select: { hoursApproved: true },
        })
        if (!before) continue
        await tx.hackatimeLink.update({
          where: { id: decision.id },
          data: {
            hoursApproved: decision.hoursApproved,
            reviewedAt: now,
            reviewedById: gate.user.id,
          },
        })
        changes.push({
          kind: "hackatime",
          id: decision.id,
          before: before.hoursApproved,
          after: decision.hoursApproved,
        })
      }
    }
    return changes
  })

  await logAudit({
    action: AuditAction.REVIEW_APPROVE_HOURS,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "WorkSession",
    targetId: applied[0]?.id ?? null,
    metadata: { changes: applied },
  })

  return ok({ updated: applied.length, changes: applied })
})
