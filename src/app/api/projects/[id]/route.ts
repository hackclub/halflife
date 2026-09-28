import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { markProjectCreated } from "@/lib/analytics"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { getThemeDef } from "@/lib/config/program"
import { requireSession } from "@/lib/guards"
import { getHoursBreakdown } from "@/lib/hours"
import prisma from "@/lib/prisma"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"
import { projectUpdateSchema } from "@/lib/schemas/project"
import { isOwnedKey, publicUrlFor } from "@/lib/uploads/r2"

type Params = { params: Promise<{ id: string }> }

export const GET = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const project = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
    include: {
      workSessions: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { media: true, timelapses: true },
      },
      hackatimeLinks: true,
      submissions: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  })
  // 404 rather than 403 for someone else's project: don't leak the ID space.
  if (!project) return fail("NOT_FOUND", "Project not found")

  const [design, build] = await Promise.all([
    getHoursBreakdown(project.id, Phase.DESIGN),
    getHoursBreakdown(project.id, Phase.BUILD),
  ])

  return ok({
    project: {
      ...project,
      coverImageUrl: publicUrlFor(project.coverImageKey),
      workSessions: project.workSessions.map((s) => ({
        ...s,
        media: s.media.map((m) => ({ ...m, url: publicUrlFor(m.objectKey) })),
      })),
    },
    theme: getThemeDef(project.theme),
    hours: { design, build },
  })
})

export const PATCH = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, projectUpdateSchema)
  if (parsed.error) return parsed.error

  const project = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")

  const access = await getSubmissionAccess(gate.user.id, id)
  if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

  // Editing the thing a reviewer is currently reading changes what they are
  // deciding on halfway through.
  if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review) {
    return fail("PHASE_LOCKED", "Unsubmit before editing — a phase is in review")
  }

  const data = parsed.data

  // The project page promises the tier is final once the design week is handed
  // in, and a starter project is scoped to tier 1 from the start. Hold the
  // server to the same promise rather than trusting the picker to be hidden.
  if (data.requestedTier !== undefined && data.requestedTier !== project.requestedTier) {
    if (project.designStatus === PhaseStatus.approved) {
      return fail("PHASE_LOCKED", "The design week is approved, so the tier is final")
    }
    if (project.starterProjectId !== null && data.requestedTier !== 1) {
      return fail("VALIDATION_FAILED", "Starter projects are scoped to tier 1")
    }
  }

  // A cover is a key, and a key is a path into the bucket: only one this user
  // uploaded as a cover, or a project could point its cover at anyone's file.
  // `isOwnedKey` refuses path tricks (`..`, `%2e%2e`); the prefix pins it to the
  // covers folder, so a key genuinely yours but uploaded as session evidence
  // cannot be re-filed as a cover.
  if (
    data.coverImageKey &&
    (!isOwnedKey(gate.user.id, data.coverImageKey) || !data.coverImageKey.startsWith("covers/"))
  ) {
    return fail("VALIDATION_FAILED", "Upload the cover image first")
  }

  const updated = await prisma.themeProject.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: sanitize(data.title) } : {}),
      ...(data.description !== undefined ? { description: sanitizeOptional(data.description) } : {}),
      ...(data.githubRepo !== undefined ? { githubRepo: data.githubRepo } : {}),
      // `requestedTier`, never `tier`. The assigned tier is a reviewer's call at
      // design approval because it decides parts money, and letting this route
      // write it would let anyone grant themselves $100.
      ...(data.requestedTier !== undefined ? { requestedTier: data.requestedTier } : {}),
      ...(data.coverImageKey !== undefined ? { coverImageKey: data.coverImageKey } : {}),
      ...(data.artifactLinks !== undefined
        ? {
            artifactLinks: data.artifactLinks.map((l) => ({
              label: sanitize(l.label),
              url: l.url,
            })),
          }
        : {}),
    },
  })

  // A project counts as started once it has a description and a tier; the row
  // itself has existed since sign-up.
  await markProjectCreated(id, gate.user.id)

  await logAudit({
    action: AuditAction.USER_UPDATE_PROJECT,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "ThemeProject",
    targetId: id,
    metadata: {
      before: { title: project.title, githubRepo: project.githubRepo },
      after: { title: updated.title, githubRepo: updated.githubRepo },
    },
  })

  return ok({ project: updated })
})
