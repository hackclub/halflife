import { deflationFor, deflationJustification, deflationReasonText } from "@/lib/airtable/deflation"

/**
 * `Automation - Unified Justification`, as the base's formula builds it, so a reviewer can read what a decision will put in the unified database before making it.
 *
 * No `server-only` here: the review screen's decision panel builds its preview in the browser from what the reviewer is typing. Everything a decision derives from the row – the evidence columns, the claimed hours, the alternate-tracking text – is read on the server and handed over (see `/api/reviews/[id]/justification`).
 */

/**
 * What the technical-features column says when the reviewer's box was left empty.
 *
 * Once a project is in the base the pipeline's `[SPECIFIC TECHNICAL FEATURES]` section is always read, so an empty one reads as a gap rather than as "nothing was recorded".
 */
export const NO_FEATURES_RECORDED = "No technical features were recorded for this submission."

/**
 * The `Justification - Specific Technical Features` cell: Ari's `review.justification.technical_features`, the reviewer's own account of what the project has that accounts for the hours – and nothing else. An empty box writes the marker, so a project never sits blank in the base.
 */
export const reviewerTechnicalFeaturesCell = (reviewerText: string | null): string =>
	reviewerText?.trim() || NO_FEATURES_RECORDED

/** The cells the formula reads, each the empty string when the column is blank. */
export interface UnifiedJustificationColumns {
	additionalJustification: string
	alternateTracking: string
	deflationJustification: string
	hackatimeId: string
	hackatimeProjects: string
	lapseLinks: string
	/** `Optional - Override Hours Spent Justification`. Text here replaces everything else. */
	overrideJustification: string
	specificTechnicalFeatures: string
}

/**
 * The formula on `Automation - Unified Justification`, character for character – including the space it puts before the deflation text, and the Hackatime lines it writes even when they are empty.
 *
 * Read from the base on 2026-11-11. If the formula changes there, this has to change with it, or the preview stops matching what the pipeline sends.
 */
export function unifiedJustification(columns: UnifiedJustificationColumns): string {
	if (columns.overrideJustification) return columns.overrideJustification
	const section = (heading: string, body: string, lead = ""): string => (body ? `\n\n[${heading}]\n${lead}${body}` : "")
	return [
		`[HACKATIME]\nHackatime ID: ${columns.hackatimeId}\nHackatime Projects: ${columns.hackatimeProjects}`,
		columns.lapseLinks ? `\nLapse Links: ${columns.lapseLinks}` : "",
		`\n\n[SPECIFIC TECHNICAL FEATURES]\n${columns.specificTechnicalFeatures}`,
		section("DEFLATION JUSTIFICATION", columns.deflationJustification, " "),
		section("ALTERNATE TRACKING METHOD", columns.alternateTracking),
		section("ADDITIONAL JUSTIFICATION", columns.additionalJustification),
	].join("")
}

/** The row as a decision will find it, read on the server. */
export interface JustificationRow {
	/** The text an approval writes to `Justification - Alternate Tracking Method`: empty when the row has Hackatime or Lapse evidence. */
	alternateTracking: string
	/** `Hours spent (self reported)`, which a deflation is measured against. Null when the cell is empty. */
	claimedHours: number | null
	hackatimeId: string
	hackatimeProjects: string
	lapseLinks: string
	overrideJustification: string
}

/** Why there is no row to preview a justification from. */
export type JustificationRowMissing = "sync_disabled" | "not_configured" | "no_row" | "unreadable"

/** What the reviewer is about to approve with. */
export interface ApprovalDraft {
	approvedHours: number
	deflationReason: string
	internalNote: string
	technicalFeatures: string
}

/**
 * The unified justification an approval would produce, worked out the way `syncReviewDecisionToYsws` writes the columns: the deflation text from the cut and the reviewer's reason for it (falling back to the internal note), the internal note as the additional justification, and the technical features or the marker.
 */
export function previewUnifiedJustification(row: JustificationRow, draft: ApprovalDraft): string {
	const deflation = deflationFor(draft.approvedHours, row.claimedHours)
	const reason = deflationReasonText(draft.deflationReason, draft.internalNote)
	return unifiedJustification({
		additionalJustification: draft.internalNote.trim(),
		alternateTracking: row.alternateTracking,
		deflationJustification: deflation ? deflationJustification(deflation, reason) : "",
		hackatimeId: row.hackatimeId,
		hackatimeProjects: row.hackatimeProjects,
		lapseLinks: row.lapseLinks,
		overrideJustification: row.overrideJustification,
		specificTechnicalFeatures: reviewerTechnicalFeaturesCell(draft.technicalFeatures),
	})
}
