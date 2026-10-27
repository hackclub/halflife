import type { Phase } from "@/lib/enums"

/**
 * How many times one phase may be submitted in all: the first hand-in and the two that follow a review.
 *
 * A design and a build are reviewed separately, so each phase carries its own three. A return on the design must not spend the build's budget.
 */
export const SUBMISSION_LIMIT = 3

/** The part of the limit that comes after a review. Derived, so the count on the page and the gate cannot disagree. */
export const RESUBMISSION_LIMIT = SUBMISSION_LIMIT - 1

/**
 * When the limit began counting. Hand-ins before this instant are grandfathered, so a project already stuck in a long review loop does not start at the cap the moment this shipped.
 *
 * The policy starts fresh: every phase gets its three from here, with any earlier work counting as the first submission. Moving this forward grandfathers more history; it is a fixed instant rather than a settings column so the rule cannot drift with a stray settings write.
 */
export const RESUBMISSIONS_COUNTED_FROM = Date.parse("2026-10-27T20:55:00.000Z")

/** The refusal, in the maker's terms. Shared so the route, the sheet and the project page say the same thing. */
export const SUBMISSION_LIMIT_MESSAGE = `You've used all ${SUBMISSION_LIMIT} submissions for this phase. If you think this decision is wrong, dispute it on the project page or ask a reviewer in Slack.`

/** The two fields every hand-in carries that the limit reads. Structural, so a submission row or a store row can be passed as-is. */
export interface ResubmissionStamp {
	createdAt: Date
	phase: Phase
}

export interface SubmissionBudget {
	/** How many submissions a phase may make in all. */
	limit: number
	/** How many submissions are still available. */
	remaining: number
	/** Resubmissions used after the first, which is the count the server gate compares with `RESUBMISSION_LIMIT`. */
	resubmissions: number
	/** Whether the phase has any hand-in at all, including one from before the policy. */
	submitted: boolean
	/** Submissions counted against the limit: 0 before the first, then 1, 2 and 3. */
	used: number
}

/**
 * One phase's submission budget, read from its hand-ins.
 *
 * Counts rows rather than keeping a counter: a submission withdrawn before review has its row deleted, so it never spends a submission a reviewer did not look at. The first hand-in a phase ever made is the first of the three; with no history at or before the start of the policy, the earliest hand-in since then takes that place. A phase that already had history before the policy begins its count at one, with its two resubmissions intact, which is what "keep your two from now on" means.
 */
export function submissionBudget(submissions: readonly ResubmissionStamp[], phase: Phase): SubmissionBudget {
	let before = 0
	let after = 0
	for (const submission of submissions) {
		if (submission.phase !== phase) continue
		if (submission.createdAt.getTime() < RESUBMISSIONS_COUNTED_FROM) before += 1
		else after += 1
	}

	// The initial hand-in is part of the three. If the phase was already being submitted before the policy, every hand-in since is a resubmission and the history before it stands as the first.
	const resubmissions = Math.max(0, after - (before === 0 ? 1 : 0))
	const submitted = before + after > 0
	const used = submitted ? Math.min(SUBMISSION_LIMIT, resubmissions + 1) : 0
	return { limit: SUBMISSION_LIMIT, remaining: SUBMISSION_LIMIT - used, resubmissions, submitted, used }
}
