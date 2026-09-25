import { fail, ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"

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
  })
  if (!link) return fail("NOT_FOUND", "Link not found")

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
