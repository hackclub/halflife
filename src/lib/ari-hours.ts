import type { AriReview } from "@hackclub/ari"
import { MAX_APPROVED_HOURS } from "@/lib/config/program"
import { round2 } from "@/lib/money"

/**
 * Ari's approved time is authoritative; fall back to its minutes breakdown.
 *
 * Bounded at MAX_APPROVED_HOURS, the same ceiling the console's hours override has. The number is not a display value: it is frozen onto the project and the review, and it is what the coins are minted from, so an hour count that can be posted by a machine must not be able to mint an absurd figure. A figure outside the bound is treated as no figure at all – the decision is then paid on the hours Half Life computed, rather than on a number nothing in the programme could have produced.
 *
 * Zero is not a figure either. An approval is a statement that work was done, and the submit gate already refuses a hand-in with no logged time, so a machine reporting 0 has left the field at its default rather than decided to approve nothing. Treating it as authoritative froze the phase at 0h and minted 0 coins while still marking the project approved; falling through to the computed hours is what the reviewer meant to accept.
 */
export function approvedHoursFrom(review: AriReview): number | null {
	if (
		typeof review.approved_hours === "number"
		&& Number.isFinite(review.approved_hours)
		&& review.approved_hours > 0
		&& review.approved_hours <= MAX_APPROVED_HOURS
	)
		return round2(review.approved_hours)

	if (
		typeof review.approved_minutes === "number"
		&& Number.isFinite(review.approved_minutes)
		&& review.approved_minutes > 0
		&& review.approved_minutes <= MAX_APPROVED_HOURS * 60
	)
		return round2(review.approved_minutes / 60)

	return null
}
