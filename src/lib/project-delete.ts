import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import { PhaseStatus } from "@/app/generated/prisma/enums"
import prisma from "@/lib/prisma"

/**
 * Why a maker cannot delete this project, or null when they can.
 *
 * Deleting is a soft delete (`deletedAt`), but to the maker it is gone, so the line is drawn where a project stops being only theirs:
 *
 * - A phase in review is on a reviewer's desk; unsubmitting takes it back.
 * - An approved phase, a grant, or a coin in the ledger means money was paid against the project, and the ledger has to keep pointing at a live one.
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
	client?: Prisma.TransactionClient,
): Promise<string | null> {
	if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review)
		return "Unsubmit before deleting – a phase is in review"
	if (project.designStatus === PhaseStatus.approved || project.buildStatus === PhaseStatus.approved)
		return "An approved project can't be deleted"
	if (project.grantEmittedAt) return "A funded project can't be deleted"

	const db = client ?? prisma
	const [ledger, topUps, disputes] = await Promise.all([
		db.ledgerEntry.count({ where: { themeProjectId: project.id } }),
		db.hcbGrantTopUp.count({ where: { themeProjectId: project.id } }),
		db.reviewDispute.count({ where: { submission: { themeProjectId: project.id }, resolvedAt: null } }),
	])
	if (ledger > 0 || topUps > 0) return "This project has earned coins or funding, so it can't be deleted"
	if (disputes > 0) return "A reviewer is still taking a second look, so it can't be deleted yet"
	return null
}
