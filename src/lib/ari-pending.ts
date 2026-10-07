import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"

/**
 * Which (project, phase) hand-ins never reached Ari.
 *
 * Pure so `verify:contracts` can pin the selection rules without a database –
 * this decides what the hourly retry job replays and what the admin's Retry
 * button is offered, and getting it wrong either resends a ship Ari already
 * has or leaves a hand-in nobody will ever review.
 */
export interface PendingShipProject {
	id: string
	designStatus: PhaseStatus
	buildStatus: PhaseStatus
}

export interface PendingShipSubmission {
	themeProjectId: string
	phase: Phase
	ariSubmissionId: string | null
	createdAt: Date
}

export function selectPendingShips(
	projects: readonly PendingShipProject[],
	submissions: readonly PendingShipSubmission[],
): { themeProjectId: string; phase: Phase }[] {
	// The newest open submission per (project, phase) is the one a reviewer
	// would be looking at, so an older row cannot make its phase look unsent.
	const newest = new Map<string, PendingShipSubmission>()
	for (const submission of submissions) {
		const key = `${submission.themeProjectId}:${submission.phase}`
		const current = newest.get(key)
		if (!current || submission.createdAt > current.createdAt) newest.set(key, submission)
	}

	const out: { themeProjectId: string; phase: Phase }[] = []
	for (const project of projects) {
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
			if (status !== PhaseStatus.in_review) continue
			const submission = newest.get(`${project.id}:${phase}`)
			if (submission && !submission.ariSubmissionId) out.push({ themeProjectId: project.id, phase })
		}
	}
	return out
}
