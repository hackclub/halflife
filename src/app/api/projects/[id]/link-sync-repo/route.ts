import { PhaseStatus } from "@/app/generated/prisma/enums"
import { fail, ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { getSubmissionAccess, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"
import { getRepoSyncState, scheduleRepoSync } from "@/lib/repo-sync"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Point a project's repo link at the repo its sync writes to.
 *
 * A maker can turn the sync on before the project details ever name a repo, and the two fields are independent: `repoSyncRepo` is where the derived JOURNAL.md and BOM.csv land, `githubRepo` is the project's own link a reviewer opens and the pre-submission checks read. Nothing copies one onto the other, so a maker who picks their repo in the sync box alone ends up with a project the checks call "No repo yet" and a sync that is happily writing to a repo the project does not point at.
 *
 * This closes that gap with one press. It is not a general "copy the sync repo over the link" – the button that calls it appears only when the two are actually different repos (see `syncRepoDiffers`), and the URL it writes is taken from the sync's own stored target server-side, never from the client, so a caller cannot use it to point their project at a repo of their choosing.
 *
 * What it refuses, it refuses for the same reasons a repo edit is refused anywhere else: submissions closed, or a phase in review because that is the thing a reviewer is reading. The local phase check is repeated inside the write, as every write that races a review is, so a review landing between the two cannot be edited out from under.
 */
export const POST = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const project = await prisma.themeProject.findFirst({
		select: { buildStatus: true, designStatus: true, githubRepo: true, id: true },
		where: { deletedAt: null, id, userId: gate.user.id },
	})
	if (!project) return fail("NOT_FOUND", "Project not found")

	// The state resolves both the sync target and whether it differs from the project link, and is the one place that logic lives.
	const state = await getRepoSyncState(id, gate.user.id)
	if (!state.syncRepoDiffers || !state.repo) return fail("CONFLICT", "There is no different repo to link to.")
	const syncRepo = state.repo

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
	if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review)
		return fail("PHASE_LOCKED", "Unsubmit before editing – a phase is in review")

	// Conditional on the statuses just checked, so a review that lands between the read and the write is not edited out from under. It also repeats the "still different" test against the current link, in case another tab changed it while this one was deciding to press the button.
	const claimed = await prisma.themeProject.updateMany({
		data: { githubRepo: syncRepo },
		where: {
			buildStatus: { notIn: [PhaseStatus.in_review, PhaseStatus.approved] },
			deletedAt: null,
			designStatus: { notIn: [PhaseStatus.in_review, PhaseStatus.approved] },
			githubRepo: project.githubRepo,
			id,
			userId: gate.user.id,
		},
	})
	if (claimed.count === 0) return fail("PHASE_LOCKED", "This project just changed – reload and try again")

	await logAudit({
		action: AuditAction.USER_UPDATE_PROJECT,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			after: { githubRepo: syncRepo },
			before: { githubRepo: project.githubRepo },
			via: "link-sync-repo",
		},
		targetId: id,
		targetType: "ThemeProject",
	})

	// The link moved, so any sync that was using the old one is stale. This is a no-op when the sync is off or was writing elsewhere; when it was writing to a bare slug that matched neither, the fresh sync now follows the link.
	await scheduleRepoSync(id)

	return ok({ githubRepo: syncRepo })
})
