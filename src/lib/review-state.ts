import type { PhaseStatus } from "@/lib/enums"

/**
 * How a review state is said and shown, in one place.
 *
 * The projects grid and the project page both read it, so a card and the page it opens can never disagree about what "needs changes" looks like. Pure, so both server and client components can name it.
 */

export type ReviewTone = "line" | "sky" | "teal" | "orange" | "coral"

/** The one state a project is in, for the single status its card shows and the one slice it occupies in a project count. */
export type ProjectReviewState = "approved" | "changes" | "not_started" | "pending" | "rejected"

/**
 * Where a project stands, as one state rather than one per phase.
 *
 * Attention wins: something rejected or sent back is what the maker needs to see first, then a phase under review. Otherwise it follows the current phase – the build once it has started, the design until then – so a design that passed while the build has not begun still reads as approved. The projects grid colours a card from this, and the admin overview counts each project in exactly one slice of it, so a project can never appear in two states at once.
 */
export function projectReviewState(design: PhaseStatus, build: PhaseStatus): ProjectReviewState {
	const phases = new Set([design, build])
	if (phases.has("rejected")) return "rejected"
	if (phases.has("update_requested")) return "changes"
	if (phases.has("in_review")) return "pending"
	const current = build !== "draft" ? build : design
	return current === "approved" ? "approved" : "not_started"
}

/**
 * Where a project stands, as one colour for its card.
 *
 * The tone is `projectReviewState`'s state, so a card and any count built on the same state cannot disagree about which slice the project is in.
 */
export function reviewTone(design: PhaseStatus, build: PhaseStatus): ReviewTone {
	switch (projectReviewState(design, build)) {
		case "rejected":
			return "coral"
		case "changes":
			return "orange"
		case "pending":
			return "sky"
		case "approved":
			return "teal"
		case "not_started":
			return "line"
	}
}

/** Plain words, not the enum. */
export const REVIEW_STATUS_TEXT: Record<PhaseStatus, string> = {
	approved: "approved",
	draft: "not started",
	in_review: "in review",
	rejected: "rejected",
	update_requested: "needs changes",
}

/** Tailwind background for a state's dot, in the platform's own state colours. */
export const REVIEW_STATUS_DOT: Record<PhaseStatus, string> = {
	approved: "bg-teal",
	draft: "bg-line-strong",
	in_review: "bg-sky",
	rejected: "bg-coral",
	update_requested: "bg-orange",
}

/** The platform `Chip` tone for a state. */
export function reviewChipTone(status: PhaseStatus): "sky" | "teal" | "gold" | "coral" | "muted" {
	switch (status) {
		case "approved":
			return "teal"
		case "in_review":
			return "sky"
		case "update_requested":
			return "gold"
		case "rejected":
			return "coral"
		case "draft":
			return "muted"
		default:
			return "muted"
	}
}
