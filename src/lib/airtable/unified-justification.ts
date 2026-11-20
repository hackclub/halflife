/**
 * `Automation - Unified Justification`, as the base's formula builds it.
 *
 * Ari's decisions are sent through this formula: the evidence columns, the reviewer's technical features, the deflation line and the internal note, each under its heading. A website approval is not – it writes its own account to `Optional - Override Hours Spent Justification`, which the formula sends in place of all of them (see lib/review-platform/justification).
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

const section = (heading: string, body: string, lead = ""): string => (body ? `\n\n[${heading}]\n${lead}${body}` : "")

/**
 * The formula on `Automation - Unified Justification`, character for character – including the space it puts before the deflation text, and the Hackatime lines it writes even when they are empty.
 *
 * Read from the base on 2026-11-11. If the formula changes there, this has to change with it, or the preview stops matching what the pipeline sends.
 */
export function unifiedJustification(columns: UnifiedJustificationColumns): string {
	if (columns.overrideJustification) return columns.overrideJustification
	return [
		`[HACKATIME]\nHackatime ID: ${columns.hackatimeId}\nHackatime Projects: ${columns.hackatimeProjects}`,
		columns.lapseLinks ? `\nLapse Links: ${columns.lapseLinks}` : "",
		`\n\n[SPECIFIC TECHNICAL FEATURES]\n${columns.specificTechnicalFeatures}`,
		section("DEFLATION JUSTIFICATION", columns.deflationJustification, " "),
		section("ALTERNATE TRACKING METHOD", columns.alternateTracking),
		section("ADDITIONAL JUSTIFICATION", columns.additionalJustification),
	].join("")
}
