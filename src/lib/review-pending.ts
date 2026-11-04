import { Phase, PhaseStatus } from "@/lib/enums"
import { statusFor } from "@/lib/phase"

/**
 * Which (project, phase) hand-ins have no healthy shadow ship in Review.
 *
 * Pure so `verify:contracts` can pin the rules without a database. This decides what the hourly `review-retry` job replays and what the admin panel offers a manual retry for; getting it wrong either leaves a hand-in absent from the shadow queue or resends one Review already has.
 *
 * A ship is pending when there is no row at all, when the row has no remote id (a failed first send), when the row was closed (withdrawn, usually because an earlier hand-in was withdrawn or resolved), or when the row belongs to an older hand-in than the newest open submission. The last case is a resubmission: the send path withdraws the stale copy and creates the next version.
 */

export interface PendingReviewProject {
	buildStatus: PhaseStatus
	designStatus: PhaseStatus
	id: string
}

export interface PendingReviewSubmission {
	createdAt: Date
	id: string
	phase: Phase
	themeProjectId: string
}

export interface PendingReviewShip {
	closedAt: Date | null
	decision: string | null
	lastError: string | null
	lastSubmissionId: string | null
	phase: Phase
	remoteId: string | null
	themeProjectId: string
}

export interface PendingReviewShipItem {
	phase: Phase
	reason: string | null
	themeProjectId: string
}

export function selectPendingReviewShips(
	projects: readonly PendingReviewProject[],
	submissions: readonly PendingReviewSubmission[],
	ships: readonly PendingReviewShip[],
): PendingReviewShipItem[] {
	// The newest open submission per (project, phase) is the one a reviewer would be looking at, so an older row cannot make its phase look sent.
	const newest = new Map<string, PendingReviewSubmission>()
	for (const submission of submissions) {
		const key = `${submission.themeProjectId}:${submission.phase}`
		const current = newest.get(key)
		if (!current || submission.createdAt > current.createdAt) newest.set(key, submission)
	}

	const byPhase = new Map<string, PendingReviewShip>()
	for (const ship of ships) byPhase.set(`${ship.themeProjectId}:${ship.phase}`, ship)

	const out: PendingReviewShipItem[] = []
	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			if (statusFor(project, phase) !== PhaseStatus.in_review) continue
			const submission = newest.get(`${project.id}:${phase}`)
			if (!submission) continue
			const ship = byPhase.get(`${project.id}:${phase}`)
			// A decision means Review has already finished this ship, even if a row was closed by a later lifecycle pass. Never send a decided hand-in back into the shadow queue.
			const sent = typeof ship?.remoteId === "string" && (ship.closedAt === null || ship.decision !== null)
			if (sent && ship.lastSubmissionId === submission.id) continue
			out.push({ phase, reason: ship?.lastError ?? null, themeProjectId: project.id })
		}

	return out
}
