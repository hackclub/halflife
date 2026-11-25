import { PhaseStatus } from "@/lib/enums"

/**
 * A decided phase is frozen. Its entries are the record the decision was made against, so no edit, delete or new entry may land until an admin returns it or un-approves it – either of which moves it back to `update_requested`.
 *
 * `in_review` is a separate, softer lock: that one is released by the participant unsubmitting, so it is checked apart from this.
 */
export function isPhaseDecided(status: PhaseStatus): boolean {
	return status === PhaseStatus.approved || status === PhaseStatus.rejected
}

/**
 * Why a project's own details cannot change right now, or null when they can.
 *
 * One place, so the route that refuses the edit, the page that says so and the card that hides its controls cannot disagree about which phases are frozen. Kept free of server imports so a client component can ask the same question the server does.
 */
export function projectEditLockReason(project: { buildStatus: PhaseStatus; designStatus: PhaseStatus }): string | null {
	if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review)
		return "In review, so it can't be edited. Unsubmit to change it"
	if (isPhaseDecided(project.designStatus) || isPhaseDecided(project.buildStatus))
		return "A phase of this project has been decided, so its details are final"
	return null
}
