import { fail, ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { isPhaseDecided } from "@/lib/program"

type Params = { params: Promise<{ id: string; linkId: string }> }

export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id, linkId } = await params

  const link = await prisma.hackatimeLink.findFirst({
    where: {
      id: linkId,
      themeProjectId: id,
      themeProject: { userId: gate.user.id, deletedAt: null },
    },
    include: { themeProject: { select: { designStatus: true, buildStatus: true } } },
  })
  if (!link) return fail("NOT_FOUND", "Link not found")

  // Removing a link is a correction to the record, so it is frozen once the
  // week is decided, exactly as editing an entry is.
  const phaseStatus = link.phase === "DESIGN" ? link.themeProject.designStatus : link.themeProject.buildStatus
  if (isPhaseDecided(phaseStatus)) {
    return fail("PHASE_LOCKED", "This phase has been submitted and decided, so its links are final")
  }

  // A reviewer-set override is part of a decision; removing the link would
  // silently drop hours someone was already credited for.
  if (link.hoursApproved !== null) {
    return fail("PHASE_LOCKED", "A reviewer has set hours on this link")
  }

  await prisma.hackatimeLink.delete({ where: { id: linkId } })

  await logAudit({
    action: AuditAction.USER_UNLINK_HACKATIME,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "HackatimeLink",
    targetId: linkId,
    metadata: { themeProjectId: id, hackatimeProject: link.hackatimeProject },
  })

  return ok({ ok: true })
})
