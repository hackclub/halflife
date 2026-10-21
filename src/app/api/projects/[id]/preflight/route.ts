import { fail, ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { checkRepo } from "@/lib/repo-checks"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * The repo checks for one of the caller's projects, for the submit sheet.
 *
 * Advisory only: the submit route runs the same checks itself before it lets a phase through, so nothing here is an authorisation.
 *
 * A read, and only a read. The first green check used to be stamped here, which made this a GET that wrote to the database – and a cross-site top-level navigation carries the session cookie, so any site could stamp a participant's funnel marker by linking them at it. The stamp moved to the path that enforces the checks (lib/submissions.ts), where it sits behind the POST that hands a phase in.
 */
export const GET = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const project = await prisma.themeProject.findFirst({
		select: { githubRepo: true, theme: true },
		where: { deletedAt: null, id, userId: gate.user.id },
	})
	if (!project) return fail("NOT_FOUND", "Project not found")

	const checks = await checkRepo(project.githubRepo, project.theme)
	return ok(checks)
})
