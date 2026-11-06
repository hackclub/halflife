import { ReviewResult } from "@/lib/enums"
import type { ReviewShipInput } from "@/lib/review-ship"
import { parseDbTimestamp } from "@/lib/time"

/** The reviewer address used when Half Life never learned who decided a ship (an Ari placeholder or an unattributed rebuild). */
export const fallbackReviewerEmail = "ari-system@hackclub.com"

export type IreImportDecision = "approved" | "changes" | "rejected"

export interface IreImportReview {
	acknowledgements?: string[]
	decided_at: string
	decision: IreImportDecision
	hours_approved_seconds: number
	internal_note?: string
	note_to_maker?: string
	reviewer_email: string
	reviewer_name?: string
	stage: 1 | 2
}

export interface IreImportShip {
	reviews: IreImportReview[]
	ship: ReviewShipInput
	version?: number
}

export interface IreImportFailure {
	error: string
	external_id: string
}

export interface IreImportResult {
	failed: IreImportFailure[]
	imported: number
	skipped: number
}

/** The columns of one `submission_review` row the backfill reads. */
export interface ImportableReview {
	createdAt: string
	feedback: string
	frozenApprovedHours: number | null
	hoursOverride: number | null
	invalidated: boolean
	reason: string | null
	result: ReviewResult
	reviewerEmail: string | null
	reviewerName: string | null
}

function decisionFor(result: ReviewResult): IreImportDecision {
	if (result === ReviewResult.APPROVED) return "approved"
	if (result === ReviewResult.RETURNED) return "changes"
	return "rejected"
}

// mapReview turns one stored review into the import shape, or null for a review that was invalidated.
export function mapReview(row: ImportableReview): IreImportReview | null {
	if (row.invalidated) return null

	const hours = row.frozenApprovedHours ?? row.hoursOverride ?? 0
	const reviewerEmail = row.reviewerEmail?.trim() || fallbackReviewerEmail

	return {
		decided_at: parseDbTimestamp(row.createdAt).toISOString(),
		decision: decisionFor(row.result),
		hours_approved_seconds: Math.max(0, Math.round(hours * 3600)),
		internal_note: row.reason?.trim() || undefined,
		note_to_maker: row.feedback,
		reviewer_email: reviewerEmail,
		reviewer_name: row.reviewerName?.trim() || (row.reviewerEmail ? undefined : "Ari"),
		stage: 1,
	}
}
