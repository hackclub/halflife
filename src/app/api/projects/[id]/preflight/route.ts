import prisma from "@/lib/prisma"
import { ok, fail, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { checkRepo } from "@/lib/repo-checks"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * The repo checks for one of the caller's projects, for the submit sheet.
 *
 * Advisory only: the submit route runs the same checks itself before it lets
 * a phase through, so nothing here is an authorisation.
 */
export const GET = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const project = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
    select: { githubRepo: true, theme: true },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")

  return ok(await checkRepo(project.githubRepo, project.theme))
})
