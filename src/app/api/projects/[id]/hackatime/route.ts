import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import { fetchProjectSeconds } from "@/lib/hackatime"
import prisma from "@/lib/prisma"
import { isPhaseDecided } from "@/lib/program"
import { hackatimeLinkSchema } from "@/lib/schemas/project"

type Params = { params: Promise<{ id: string }> }

export const GET = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const project = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
    include: { hackatimeLinks: true, user: { select: { hackatimeUserId: true } } },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")

  return ok({
    links: project.hackatimeLinks.map((l) => ({
      id: l.id,
      hackatimeProject: l.hackatimeProject,
      phase: l.phase,
      hours: l.hoursApproved ?? (l.cachedSeconds ?? 0) / 3600,
      hoursApproved: l.hoursApproved,
      cachedAt: l.cachedAt,
      lastFetchError: l.lastFetchError,
    })),
  })
})

export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, hackatimeLinkSchema)
  if (parsed.error) return parsed.error

  const project = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
    include: { user: { select: { hackatimeUserId: true } } },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")

  // A decided phase is frozen: linking a project adds hours to a number that
  // has already been judged, so it waits for a return or an un-approval.
  const phaseStatus = parsed.data.phase === "DESIGN" ? project.designStatus : project.buildStatus
  if (isPhaseDecided(phaseStatus)) {
    return fail("PHASE_LOCKED", "This phase has been submitted and decided, so no more hours can be linked")
  }

  if (!project.user.hackatimeUserId) {
    return fail("HACKATIME_NOT_LINKED", "Link your Hackatime account before linking a project to it")
  }

  const existing = await prisma.hackatimeLink.findUnique({
    where: {
      themeProjectId_hackatimeProject: {
        themeProjectId: id,
        hackatimeProject: parsed.data.hackatimeProject,
      },
    },
  })
  if (existing) return fail("CONFLICT", "That Hackatime project is already linked here")

  const fetched = await fetchProjectSeconds(project.user.hackatimeUserId, parsed.data.hackatimeProject)

  const link = await prisma.hackatimeLink.create({
    data: {
      themeProjectId: id,
      hackatimeProject: parsed.data.hackatimeProject,
      phase: parsed.data.phase,
      cachedSeconds: fetched.stale ? null : fetched.seconds,
      cachedAt: fetched.stale ? null : new Date(),
      lastFetchError: fetched.error ?? null,
    },
  })

  await logAudit({
    action: AuditAction.USER_LINK_HACKATIME,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "HackatimeLink",
    targetId: link.id,
    metadata: { themeProjectId: id, hackatimeProject: parsed.data.hackatimeProject },
  })

  return ok({ link }, { status: 201 })
})
