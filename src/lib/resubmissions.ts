import type { Phase } from "@/lib/enums"

/**
 * How many times one phase may be handed in again after a review.
 *
 * A design and a build are reviewed separately, so each phase carries its own two. A return on the design must not spend the build's budget.
 */
export const RESUBMISSION_LIMIT = 2

/**
 * When the limit began counting. Hand-ins before this instant are grandfathered, so a project already stuck in a long review loop does not start at the cap the moment this shipped.
 *
 * The policy starts fresh: every phase gets its two from here, on top of whatever it had already handed in. Moving this forward grandfathers more history; it is a fixed instant rather than a settings column so the rule cannot drift with a stray settings write.
 */
export const RESUBMISSIONS_COUNTED_FROM = Date.parse("2026-10-27T20:55:00.000Z")

/** The refusal, in the maker's terms. Shared so the route, the sheet and the project page say the same thing. */
export const RESUBMISSION_LIMIT_MESSAGE =
	"You've used both resubmissions for this phase. If you think this decision is wrong, dispute it on the project page or ask a reviewer in Slack."

/** The two fields every hand-in carries that the limit reads. Structural, so a submission row or a store row can be passed as-is. */
export interface ResubmissionStamp {
	createdAt: Date
	phase: Phase
}

export interface ResubmissionBudget {
	/** How many may be used in all, for the copy that says "of 2". */
	limit: number
	/** How many are still available. */
	remaining: number
	/** Hand-ins counted against the limit: every hand-in after the first since the policy began. */
	used: number
}

/**
 * One phase's resubmission budget, read from its hand-ins.
 *
 * Counts rows rather than keeping a counter: a submission withdrawn before review has its row deleted, so it never spends a resubmission a reviewer did not look at. The first hand-in a phase ever made is not a resubmission; with no history at or before the start of the policy, the earliest hand-in since then takes that place. A phase that already had history before the policy begins its count immediately, which is what "keep your two from now on" means.
 */
export function resubmissionBudget(submissions: readonly ResubmissionStamp[], phase: Phase): ResubmissionBudget {
	let before = 0
	let after = 0
	for (const submission of submissions) {
		if (submission.phase !== phase) continue
		if (submission.createdAt.getTime() < RESUBMISSIONS_COUNTED_FROM) before += 1
		else after += 1
	}

	// The initial hand-in is free. If the phase was already being submitted before the policy, every hand-in since is a resubmission.
	const used = Math.max(0, after - (before === 0 ? 1 : 0))
	return { limit: RESUBMISSION_LIMIT, remaining: Math.max(0, RESUBMISSION_LIMIT - used), used }
}
