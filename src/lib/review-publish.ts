import "server-only"
import { mirrorReviewDecision, reviewStatusForResult } from "@/lib/airtable/sync"
import { ReviewResult } from "@/lib/enums"
import { notifyReviewOutcome } from "@/lib/notifications"
import type { FinalizeOutcome } from "@/lib/review"
import { isRobertConfigured, submitToRobert } from "@/lib/telescreen"

/** What a decision carries past the review itself: the Airtable row, the maker's notice and the Robert resend. */
export interface PublishedDecision {
	deflationReason: string | null
	feedback: string
	justification: string | null
	reason: string | null
	reviewerEmail: string | null
}

/**
 * Everything a committed decision sends outside Postgres. Called after the decision has committed, from the decision route and from a deferred build approval being applied, so both publish the same way.
 */
export async function publishReviewDecision(outcome: FinalizeOutcome, decision: PublishedDecision): Promise<void> {
	await mirrorReviewDecision(
		outcome.themeProjectId,
		outcome.phase,
		reviewStatusForResult(outcome.result),
		decision.feedback || null,
		decision.reviewerEmail,
		decision.deflationReason,
		decision.reason,
		// Undefined from a page that composed none, which leaves the column to the formula.
		outcome.result === ReviewResult.APPROVED ? (decision.justification ?? undefined) : undefined,
	)
	await notifyReviewOutcome({
		// A console reviewer always writes the note themselves, so an empty one is an empty one rather than a missing field.
		note: decision.feedback || null,
		phase: outcome.phase,
		result: outcome.result,
		themeProjectId: outcome.themeProjectId,
	})
	// An approval sends the project to Robert again, so its journal there is the one that was approved (see lib/telescreen).
	if (outcome.result === ReviewResult.APPROVED && isRobertConfigured()) {
		try {
			await submitToRobert(outcome.themeProjectId)
		} catch (err) {
			console.error("[review] robert resend failed:", err)
		}
	}
}
