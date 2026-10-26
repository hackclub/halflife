import "server-only"
import { and } from "@prisma/orm-postgres/orm-client"
import { mirrorReviewDecision, reviewStatusFor } from "@/lib/airtable/sync"
import { sendSubmissionToAri } from "@/lib/ari"
import { AuditAction, logAudit } from "@/lib/audit"
import { Phase, PhaseStatus, ReviewDisputeOutcome } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import db from "@/lib/prisma8"
import { trackSideEffect } from "@/lib/side-effects"
import { formatDbTimestamp } from "@/lib/time"

/**
 * A maker's second look, resolved by a reviewer.
 *
 * The dispute itself changes no state (see `ReviewDispute`): it records the maker's words and opens a thread. These two actions are how a reviewer closes it – leave the decision standing, or agree it was wrong and send the hand-in back for a fresh review.
 */

/** Close a dispute with the decision left standing. Changes no state beyond the dispute. */
export async function closeDispute(disputeId: string, reviewerId: string, reviewerEmail: string | null): Promise<void> {
	const closed = await db.orm.public.ReviewDispute.where({ id: disputeId })
		.where(dispute => dispute.resolvedAt.isNull())
		.updateAndCount({
			outcome: ReviewDisputeOutcome.stood,
			resolvedAt: formatDbTimestamp(new Date()),
			resolvedById: reviewerId,
		})
	if (closed === 0) throw new HttpError("CONFLICT", "That dispute is already resolved")

	await logAudit({
		action: AuditAction.ADMIN_RESOLVE_DISPUTE,
		actorEmail: reviewerEmail,
		actorId: reviewerId,
		metadata: { outcome: ReviewDisputeOutcome.stood },
		targetId: disputeId,
		targetType: "ReviewDispute",
	})
}

/**
 * Agree with a dispute and send the hand-in back for a fresh review.
 *
 * This is Ari's requeue done from this side: the phase returns to review, the reviews behind the disputed decision are invalidated, and the hand-in is re-sent to Ari as a new ship version so a reviewer decides it there. Only the state change and its audit row are awaited; the Airtable mirror and the send are best-effort after it, because the phase is already back in review and a send that fails is replayed by `ari-retry` (the reopened submission carries a null `ariSubmissionId`, which is exactly what `selectPendingShips` looks for).
 *
 * Refused once the phase has moved on: a decision that has since been re-reviewed or a maker who has resubmitted leaves nothing coherent to send back.
 */
export async function sendDisputedPhaseBack(
	disputeId: string,
	reviewerId: string,
	reviewerEmail: string | null,
): Promise<void> {
	const dispute = await db.orm.public.ReviewDispute.whereUnique({ id: disputeId })
		.select("id", "resolvedAt")
		.include("submission", submission => submission.select("id", "phase", "themeProjectId"))
		.first()
	if (!dispute?.submission) throw new HttpError("NOT_FOUND", "Dispute not found")
	if (dispute.resolvedAt) throw new HttpError("CONFLICT", "That dispute is already resolved")

	const { submission } = dispute
	const { phase, themeProjectId } = submission

	await db.transaction(async tx => {
		const project = await tx.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
			.select("buildStatus", "designStatus")
			.first()
		if (!project) throw new HttpError("NOT_FOUND", "Project not found")

		const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
		if (status !== PhaseStatus.update_requested && status !== PhaseStatus.rejected)
			throw new HttpError("CONFLICT", "This phase has moved on since the decision that was disputed")

		// The disputed decision must still be the one standing on the phase: once the maker resubmits, this dispute is about history and has nothing to send back.
		const latest = await tx.orm.public.PhaseSubmission.where({ phase, themeProjectId })
			.orderBy(row => row.createdAt.desc())
			.select("id")
			.first()
		if (!latest || latest.id !== submission.id)
			throw new HttpError("CONFLICT", "The maker has resubmitted since, so there is nothing to send back")

		await tx.orm.public.SubmissionReview.where({ invalidated: false })
			.where(review =>
				review.submission.some(candidate =>
					and(candidate.phase.eq(phase), candidate.themeProjectId.eq(themeProjectId)),
				),
			)
			.updateAll({ invalidated: true, invalidatedAt: formatDbTimestamp(new Date()) })
		await tx.orm.public.PhaseSubmission.where({ id: submission.id }).update({
			ariDecision: null,
			ariShipError: null,
			ariStatus: "review",
			ariSubmissionId: null,
			resolvedAt: null,
			resolvedResult: null,
		})
		await tx.orm.public.ThemeProject.where({ id: themeProjectId }).update(
			phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : { buildStatus: PhaseStatus.in_review },
		)

		const nowText = formatDbTimestamp(new Date())
		const closed = await tx.orm.public.ReviewDispute.where({ id: disputeId })
			.where(d => d.resolvedAt.isNull())
			.updateAndCount({ outcome: ReviewDisputeOutcome.upheld, resolvedAt: nowText, resolvedById: reviewerId })
		if (closed === 0) throw new HttpError("CONFLICT", "That dispute is already resolved")
	})

	await logAudit({
		action: AuditAction.ADMIN_RESOLVE_DISPUTE,
		actorEmail: reviewerEmail,
		actorId: reviewerId,
		metadata: { outcome: ReviewDisputeOutcome.upheld, phase },
		targetId: disputeId,
		targetType: "ReviewDispute",
	})

	// The row follows the phase back to review; Loops triggers on decisions, so Pending Review sends nothing.
	await mirrorReviewDecision(themeProjectId, phase, reviewStatusFor(PhaseStatus.in_review), null, null)
	await trackSideEffect(
		"ari",
		{
			actorEmail: reviewerEmail,
			actorId: reviewerId,
			metadata: { disputeId, phase },
			targetId: themeProjectId,
			targetType: "ThemeProject",
		},
		() => sendSubmissionToAri(themeProjectId, phase),
	)
}
