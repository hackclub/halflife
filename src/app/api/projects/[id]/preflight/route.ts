import { fail, ok } from "@/lib/api"
import { type AuthedContext, withSession } from "@/lib/guards"
import { identityNeeded } from "@/lib/identity-reminder-needed"
import db from "@/lib/prisma8"
import { checkRepo, type RepoCheck } from "@/lib/repo-checks"

/** Where a maker goes to verify their identity with Hack Club. */
const VERIFY_URL = "https://auth.hackclub.com"

/**
 * The identity row the sheet shows when the maker has not cleared Hack Club Auth's check. It is a warning and never blocks: the hand-in goes ahead, and only grants and shop orders wait on the check.
 */
const IDENTITY_CHECK: RepoCheck = {
	detail:
		"You can still hand this in. Grants and shop orders wait until Hack Club Auth has verified you, which can take a while.",
	key: "identity",
	label: "Identity not verified yet",
	link: { href: VERIFY_URL, label: "Verify with Hack Club" },
	status: "warn",
}

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
export const GET = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
		.select("artifactLinks", "description", "githubRepo", "theme")
		.first()
	if (!project) return fail("NOT_FOUND", "Project not found")

	const checks = await checkRepo(project.githubRepo, project.theme, {
		artifactLinks: project.artifactLinks,
		description: project.description,
	})
	// Appended after the repo checks, so `canSubmit` is the repo's answer alone: an identity warning never stops a hand-in.
	const identity = (await identityNeeded(gate.user.id)) ? [IDENTITY_CHECK] : []
	return ok({ ...checks, checks: [...checks.checks, ...identity] })
})
