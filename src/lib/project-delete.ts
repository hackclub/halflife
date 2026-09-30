import "server-only"
import { PhaseStatus, type Theme } from "@/app/generated/prisma/enums"
import { ONBOARDING_THEME } from "@/lib/onboarding"
import prisma from "@/lib/prisma"

/**
 * Why a maker cannot delete this project, or null when they can.
 *
 * Deleting is a soft delete (`deletedAt`), but to the maker it is gone, so the
 * line is drawn where a project stops being only theirs:
 *
 * - Week one's project is made by onboarding, not by a "create a project"
 *   node, so the trail would have no way to make it again.
 * - A phase in review is on a reviewer's desk; unsubmitting takes it back.
 * - An approved phase, a grant, or a coin in the ledger means money was paid
 *   against the project, and the ledger has to keep pointing at a live one.
 * - An open dispute is still waiting on a reviewer's second look.
 *
 * Shared by the DELETE handler and the project page, so the page only offers
 * what the server will do.
 */
export async function deleteBlockReason(project: {
  id: string
  theme: Theme
  designStatus: PhaseStatus
  buildStatus: PhaseStatus
  grantEmittedAt: Date | null
}): Promise<string | null> {
  if (project.theme === ONBOARDING_THEME) {
    return "Your week 1 project comes from onboarding, so it can't be deleted"
  }
  if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review) {
    return "Unsubmit before deleting — a phase is in review"
  }
  if (project.designStatus === PhaseStatus.approved || project.buildStatus === PhaseStatus.approved) {
    return "An approved project can't be deleted"
  }
  if (project.grantEmittedAt) return "A funded project can't be deleted"

  const [ledger, topUps, disputes] = await Promise.all([
    prisma.ledgerEntry.count({ where: { themeProjectId: project.id } }),
    prisma.hcbGrantTopUp.count({ where: { themeProjectId: project.id } }),
    prisma.reviewDispute.count({ where: { submission: { themeProjectId: project.id }, resolvedAt: null } }),
  ])
  if (ledger > 0 || topUps > 0) return "This project has earned coins or funding, so it can't be deleted"
  if (disputes > 0) return "A reviewer is still taking a second look, so it can't be deleted yet"
  return null
}
