import { Phase, type PhaseStatus } from "@/app/generated/prisma/enums"

/**
 * A project's two phase statuses.
 *
 * A structural type rather than `ThemeProject` so every caller can pass a row it selected only these two columns from, and so this module stays pure: it is imported by the review, Ari, Airtable and reel paths, and none of them should drag the rest of `lib/submissions` in for a one-line branch.
 */
export interface PhaseStatuses {
	buildStatus: PhaseStatus
	designStatus: PhaseStatus
}

/** The status of one phase, from a row carrying both. */
export function statusFor(project: PhaseStatuses, phase: Phase): PhaseStatus {
	return phase === Phase.DESIGN ? project.designStatus : project.buildStatus
}

/**
 * The update fragment that sets one phase's status.
 *
 * The inverse of `statusFor`, for `data: phaseStatusUpdate(phase, status)` – the shape that was written out at every write site.
 */
export function phaseStatusUpdate(
	phase: Phase,
	status: PhaseStatus,
): { designStatus: PhaseStatus } | { buildStatus: PhaseStatus } {
	return phase === Phase.DESIGN ? { designStatus: status } : { buildStatus: status }
}
