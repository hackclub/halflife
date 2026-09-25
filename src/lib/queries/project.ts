import "server-only"
import { Phase } from "@/app/generated/prisma/enums"
import { getThemeDef, themeDefBySlug } from "@/lib/config/program"
import { getHoursBreakdown, type HoursBreakdown } from "@/lib/hours"
import prisma from "@/lib/prisma"
import { canSubmitPhase, getSubmitReadiness, type ReadinessCheck } from "@/lib/submissions"
import { publicUrlFor } from "@/lib/uploads/r2"

export async function getProjectBySlug(userId: string, slug: string) {
  const def = themeDefBySlug(slug)
  if (!def) return null
  return prisma.themeProject.findFirst({
    where: { userId, theme: def.id, deletedAt: null },
  })
}

export interface ProjectDetail {
  project: NonNullable<Awaited<ReturnType<typeof getProjectBySlug>>>
  themeLabel: string
  slug: string
  designWeek: number
  buildWeek: number
  coverImageUrl: string | null
  design: HoursBreakdown
  build: HoursBreakdown
  designReadiness: ReadinessCheck[]
  buildReadiness: ReadinessCheck[]
  canSubmitDesign: boolean
  canSubmitBuild: boolean
  sessions: Awaited<ReturnType<typeof listSessions>>
  hackatimeLinks: Awaited<ReturnType<typeof listHackatimeLinks>>
}

export async function listSessions(themeProjectId: string, limit = 50) {
  return prisma.workSession.findMany({
    where: { themeProjectId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    include: { media: true, timelapses: true },
  })
}

export async function listHackatimeLinks(themeProjectId: string) {
  return prisma.hackatimeLink.findMany({
    where: { themeProjectId },
    orderBy: { createdAt: "asc" },
  })
}

export async function getProjectDetail(userId: string, slug: string): Promise<ProjectDetail | null> {
  const project = await getProjectBySlug(userId, slug)
  if (!project) return null
  const def = getThemeDef(project.theme)

  const [design, build, designReadiness, buildReadiness, sessions, hackatimeLinks] = await Promise.all([
    getHoursBreakdown(project.id, Phase.DESIGN),
    getHoursBreakdown(project.id, Phase.BUILD),
    getSubmitReadiness(project, Phase.DESIGN),
    getSubmitReadiness(project, Phase.BUILD),
    listSessions(project.id),
    listHackatimeLinks(project.id),
  ])

  return {
    project,
    themeLabel: def.label,
    slug: def.slug,
    designWeek: def.designWeek,
    buildWeek: def.buildWeek,
    coverImageUrl: publicUrlFor(project.coverImageKey),
    design,
    build,
    designReadiness,
    buildReadiness,
    canSubmitDesign: canSubmitPhase(project, Phase.DESIGN).ok,
    canSubmitBuild: canSubmitPhase(project, Phase.BUILD).ok,
    sessions,
    hackatimeLinks,
  }
}
