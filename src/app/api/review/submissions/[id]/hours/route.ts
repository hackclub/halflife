import { after } from "next/server"
import { mirrorReviewDecision, reviewStatusForResult } from "@/lib/airtable/sync"
import { ok, parseBody } from "@/lib/api"
import { ReviewResult } from "@/lib/enums"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { hasPermission, Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { adjustApprovedHours } from "@/lib/review"
import { composeJustification, signedJustification } from "@/lib/review-platform/justification"
import { getReviewDetail } from "@/lib/review-platform/queries"
import { reviewViewerFor } from "@/lib/review-platform/viewer"
import { sanitizeOptional } from "@/lib/sanitize"
import { adjustHoursSchema } from "@/lib/schemas/review"
import { parseDbTimestamp } from "@/lib/time"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Re-deflating an approval's journal entries without taking the decision back: the approval is re-paid at the new total, its justification is composed again from the new numbers, and the row follows. The maker is not messaged.
 */
export const POST = withWritePermission(
	Permission.REVIEW_HOURS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		const parsed = await parseBody(req, adjustHoursSchema)
		if (parsed.error) return parsed.error

		const outcome = await adjustApprovedHours(
			id,
			gate.user,
			parsed.data.entries.map(entry => ({
				comments: sanitizeOptional(entry.comments),
				hoursApproved: entry.hoursApproved,
				id: entry.id,
			})),
			{ canExceedClaim: hasPermission(gate.roles, Permission.MANAGE_CREDIT) },
		)

		// The approval's account quotes the hours and each entry's deflation note, so it is written again from them. Only a website approval has one; the reviewer's hand edits to it are replaced, and T2 is where to change the text from here.
		const review = await db.orm.public.SubmissionReview.where({ invalidated: false, submissionId: id })
			.orderBy(row => row.createdAt.desc())
			.first()
		let justification: string | undefined
		if (review?.justification) {
			const viewer = reviewViewerFor(gate)
			const detail = await getReviewDetail(id, viewer)
			if (detail) {
				const text = composeJustification({
					approvedAt: parseDbTimestamp(review.createdAt),
					approvedHours: outcome.approvedHours,
					claimedHours: detail.breakdown.journalHoursClaimed + detail.breakdown.hackatimeHours,
					context: detail.justification,
					entries: detail.entries,
					hackatimeHours: detail.breakdown.hackatimeHours,
					reviewer: viewer.displayName,
					technicalFeatures: review.technicalFeatures ?? "",
				})
				justification = signedJustification(text, viewer.displayName)
				await db.orm.public.SubmissionReview.where({ id: review.id }).update({ justification })
			}
		}

		// Same status, note and reviewer as the approval, so the row only picks up the new hours and account.
		after(() =>
			mirrorReviewDecision(
				outcome.themeProjectId,
				outcome.phase,
				reviewStatusForResult(ReviewResult.APPROVED),
				review?.feedback || null,
				gate.user.email,
				null,
				review?.reason ?? null,
				justification,
			),
		)

		return ok({ approvedHours: outcome.approvedHours, unrecovered: outcome.unrecovered })
	},
)
