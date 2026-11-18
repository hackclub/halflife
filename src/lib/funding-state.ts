/**
 * Where an approved design's money stands, said in words and as a chip.
 *
 * Approval is the review state; this is the stage after it. A design approved but not yet in the unified database is queued, one in the unified database waits on its grant card, and one whose card has been issued is funded. A card that was returned still counts as funded, because the money was paid out and the maker chose to hand it back.
 *
 * Pure, so the grid and the project page can both name it. Callers decide whether the project has a grant to wait on at all.
 */

export type FundingState = "queued" | "awaiting_funding" | "funded"

/** Plain words for each stage, as the grid and the project page show them. */
export const FUNDING_STATE_TEXT: { [_ in FundingState]: string } = {
	awaiting_funding: "awaiting funding",
	funded: "funded",
	queued: "queued",
}

/**
 * The stage for an approved design with a grant. A card that has been issued settles it outright. Without one, `inUnified` says whether the pipeline has taken the row; null means the check could not run, so no stage is claimed rather than a guessed one.
 */
export function fundingState(input: { cardIssued: boolean; inUnified: boolean | null }): FundingState | null {
	if (input.cardIssued) return "funded"
	if (input.inUnified === null) return null
	return input.inUnified ? "awaiting_funding" : "queued"
}

/** The chip tone for a stage: queued is quiet, waiting is gold, funded is teal like an approval. */
export function fundingChipTone(state: FundingState): "muted" | "gold" | "teal" {
	switch (state) {
		case "queued":
			return "muted"
		case "awaiting_funding":
			return "gold"
		case "funded":
			return "teal"
	}
}
