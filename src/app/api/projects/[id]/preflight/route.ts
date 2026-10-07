import { markChecksPassed } from "@/lib/analytics"
import { fail, ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { checkRepo } from "@/lib/repo-checks"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * The repo checks for one of the caller's projects, for the submit sheet.
 *
 * Advisory only: the submit route runs the same checks itself before it lets a phase through, so nothing here is an authorisation.
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

	const checks = await checkRepo(project.githubRepo, project.theme)
	// First time the checks come back green, stamp it – the admin funnel uses it to separate "passed the repo checks" from "actually submitted".
	if (checks.canSubmit) markChecksPassed(gate.user.id)
	return ok(checks)
})
