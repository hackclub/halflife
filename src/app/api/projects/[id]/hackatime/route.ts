import prisma from "@/lib/prisma"
import { ok, fail, parseBody, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { hackatimeLinkSchema } from "@/lib/schemas/project"
import { fetchProjectSeconds } from "@/lib/hackatime"
import { AuditAction, logAudit } from "@/lib/audit"

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
