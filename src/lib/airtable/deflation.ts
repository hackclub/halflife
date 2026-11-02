import { round2 } from "@/lib/money"
import { fmtHours } from "@/lib/numbers"

/**
 * The hour cut a review made, and the text that explains it.
 *
 * A review approves a number of hours, and the base keeps the maker's own figure in `Hours spent (self reported)`. When the approved number is lower, the difference is a deflation: the payout pipeline cannot see it unless the approved figure is put in `Optional - Override Hours Spent`, and a person cannot audit it unless the reason is in `Justification - Deflation Justification`.
 *
 * Pure on purpose: the live mirror and the backfill both use these, and a test can pin the boundary between "rounded away" and "a real cut" without a base or a database.
 */
export interface Deflation {
	/** The figure written to `Optional - Override Hours Spent`. */
	approvedHours: number
	/** The figure the row's own `Hours spent (self reported)` holds. */
	claimedHours: number
	/** `claimedHours - approvedHours`, for the justification text. */
	removedHours: number
}

/**
 * A numeric cell, which Airtable hands back as a number for a number column and as text when the column is a formula or was created differently.
 */
export function numberCell(value: unknown): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null
	if (typeof value !== "string" || value.trim() === "") return null
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : null
}

/**
 * The cut a decision made, or null when it approved the whole claimed figure.
 *
 * Both figures are rounded to the precision the base shows before they are compared, so a sum of minutes that lands a hundredth over its own total is not reported as deflation. An approval above the claim is not a deflation either: the override column exists to take hours away, not to add them.
 */
export function deflationFor(approvedHours: number | null, claimedHours: number | null): Deflation | null {
	if (approvedHours === null || claimedHours === null) return null
	const approved = round2(approvedHours)
	const claimed = round2(claimedHours)
	if (approved >= claimed) return null
	return { approvedHours: approved, claimedHours: claimed, removedHours: round2(claimed - approved) }
}

/**
 * The explanation a deflation justification quotes: Ari's dedicated deflation reason when the decision carried one, else the review's internal note.
 *
 * The note to the maker is deliberately not a parameter. That note is written to `Loops - halfLifeReviewerNotes` and emailed; quoting it in the audit column put encouragement and unrelated feedback there (see `deflationJustification`).
 */
export function deflationReasonText(
	deflationReason: string | null | undefined,
	reviewReason: string | null | undefined,
): string | null {
	return deflationReason?.trim() || reviewReason?.trim() || null
}

/**
 * The `Justification - Deflation Justification` text.
 *
 * The amounts are always stated, because they are the part no one can reconstruct later without both columns, and the reviewer's reason is appended when there is one – it is usually the actual reason, and the column is read by whoever audits the payout.
 *
 * `reason` is the reviewer's justification for the cut, never the note to the maker. That note is written to `Loops - halfLifeReviewerNotes` and emailed to the maker; quoting it here put encouragement ("great work!") and unrelated feedback into the audit trail, where it says nothing about why the hours came down.
 */
export function deflationJustification(deflation: Deflation, reason: string | null | undefined): string {
	const summary = `Deflated from ${fmtHours(deflation.claimedHours)} claimed to ${fmtHours(deflation.approvedHours)} approved (${fmtHours(deflation.removedHours)} removed).`
	const text = reason?.trim()
	return text ? `${summary} ${text}` : summary
}
