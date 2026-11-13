import "server-only"
import { Phase, PhaseStatus } from "@/lib/enums"
import db, { type DbOrTx } from "@/lib/prisma8"
import { SUBMISSION_LIMIT, submissionBudget } from "@/lib/resubmissions"
import { parseDbTimestamp } from "@/lib/time"

/**
 * Why a maker cannot delete this project, or null when they can.
 *
 * Deleting is a soft delete (`deletedAt`), but to the maker it is gone, so the line is drawn where a project stops being only theirs:
 *
 * - A phase in review is on a reviewer's desk; unsubmitting takes it back.
 *
 * - An approved phase, a grant, or a coin in the ledger means money was paid against the project, and the ledger has to keep pointing at a live one.
 *
 * - An open dispute is still waiting on a reviewer's second look.
 *
 * Week one's project may go too, though onboarding made it: the trail then gives week one a "New project" node of its own (see `checkpointsFor`).
 *
 * Shared by the DELETE handler and the project page, so the page only offers what the server will do.
 */
export async function deleteBlockReason(
	project: {
		id: string
		designStatus: PhaseStatus
		buildStatus: PhaseStatus
		grantEmittedAt: Date | null
	},
	client?: DbOrTx,
): Promise<string | null> {
	if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review)
		return "A phase is in review, so unsubmit before deleting"
	if (project.designStatus === PhaseStatus.approved || project.buildStatus === PhaseStatus.approved)
		return "An approved project can't be deleted"
	if (project.designStatus === PhaseStatus.rejected || project.buildStatus === PhaseStatus.rejected)
		return "A rejected project can't be deleted. Ask a reviewer in Slack if you think the decision was wrong"
	if (project.grantEmittedAt) return "A funded project can't be deleted"

	// The three submissions a phase is given are counted per project row, so a soft delete and a new project would hand back a fresh three and put the old rejections out of a reviewer's sight. A project whose phase has spent its budget stays.
	const submissions = await (client ?? db).orm.public.PhaseSubmission.where({ themeProjectId: project.id })
		.select("createdAt", "phase")
		.all()
	const stamps = submissions.map(row => ({ createdAt: parseDbTimestamp(row.createdAt), phase: row.phase }))
	if ([Phase.DESIGN, Phase.BUILD].some(phase => submissionBudget(stamps, phase).used >= SUBMISSION_LIMIT))
		return "This project has used all its submissions for a phase, so it can't be deleted"

	const dbOrTx = client ?? db
	const [ledger, topUps, cards, disputes] = await Promise.all([
		dbOrTx.orm.public.LedgerEntry.where({ themeProjectId: project.id }).aggregate(a => ({ count: a.count() })),
		dbOrTx.orm.public.HcbGrantTopUp.where({ themeProjectId: project.id }).aggregate(a => ({ count: a.count() })),
		dbOrTx.orm.public.HcbGrantCard.where({ themeProjectId: project.id }).aggregate(a => ({ count: a.count() })),
		dbOrTx.orm.public.ReviewDispute.where({ resolvedAt: null })
			.where(dispute => dispute.submission.some(submission => submission.themeProjectId.eq(project.id)))
			.aggregate(a => ({ count: a.count() })),
	])
	if (ledger.count > 0 || topUps.count > 0 || cards.count > 0)
		return "This project has earned coins or funding, so it can't be deleted"
	if (disputes.count > 0) return "A reviewer is still taking a second look, so it can't be deleted yet"
	return null
}
