import type { PhaseStatus } from "@/app/generated/prisma/enums"

/**
 * How a review state is said and shown, in one place.
 *
 * The projects grid and the project page both read it, so a card and the page it opens can never disagree about what "needs changes" looks like. Pure, so both server and client components can name it.
 */

export type ReviewTone = "line" | "sky" | "teal" | "orange" | "coral"

/**
 * Where a project stands, as one colour for its card.
 *
 * Attention wins: something rejected or sent back is what the maker needs to see first, then a phase under review. Otherwise it follows the current phase – the build once it has started, the design until then – so a design that passed while the build has not begun still reads as approved. The per-phase chips carry the detail this single colour cannot.
 */
export function reviewTone(design: PhaseStatus, build: PhaseStatus): ReviewTone {
	const phases = new Set([design, build])
	if (phases.has("rejected")) return "coral"
	if (phases.has("update_requested")) return "orange"
	if (phases.has("in_review")) return "sky"
	const current = build !== "draft" ? build : design
	if (current === "approved") return "teal"
	return "line"
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
		default:
			return "muted"
	}
}
