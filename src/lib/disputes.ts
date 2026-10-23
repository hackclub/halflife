import "server-only"
import { Phase, PhaseStatus, ReviewDisputeOutcome } from "@/app/generated/prisma/enums"
import { mirrorReviewDecision, reviewStatusFor } from "@/lib/airtable/sync"
import { sendSubmissionToAri } from "@/lib/ari"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import prisma from "@/lib/prisma"
import { trackSideEffect } from "@/lib/side-effects"

/**
 * A maker's second look, resolved by a reviewer.
 *
 * The dispute itself changes no state (see `ReviewDispute`): it records the maker's words and opens a thread. These two actions are how a reviewer closes it – leave the decision standing, or agree it was wrong and send the hand-in back for a fresh review.
 */

/** Close a dispute with the decision left standing. Changes no state beyond the dispute. */
async function closeDispute(disputeId: string, reviewerId: string, reviewerEmail: string | null): Promise<void> {
	const closed = await prisma.reviewDispute.updateMany({
		data: { outcome: ReviewDisputeOutcome.stood, resolvedAt: new Date(), resolvedById: reviewerId },
		where: { id: disputeId, resolvedAt: null },
	})
	if (closed.count === 0) throw new HttpError("CONFLICT", "That dispute is already resolved")

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
async function sendDisputedPhaseBack(
	disputeId: string,
	reviewerId: string,
	reviewerEmail: string | null,
): Promise<void> {
	const dispute = await prisma.reviewDispute.findUnique({
		select: {
			id: true,
			resolvedAt: true,
			submission: { select: { id: true, phase: true, themeProjectId: true } },
		},
		where: { id: disputeId },
	})
	if (!dispute) throw new HttpError("NOT_FOUND", "Dispute not found")
	if (dispute.resolvedAt) throw new HttpError("CONFLICT", "That dispute is already resolved")

	const { phase, themeProjectId } = dispute.submission

	await prisma.$transaction(async tx => {
		const project = await tx.themeProject.findUnique({
			select: { buildStatus: true, designStatus: true },
			where: { id: themeProjectId },
		})
		if (!project) throw new HttpError("NOT_FOUND", "Project not found")

		const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
		if (status !== PhaseStatus.update_requested && status !== PhaseStatus.rejected)
			throw new HttpError("CONFLICT", "This phase has moved on since the decision that was disputed")

		// The disputed decision must still be the one standing on the phase: once the maker resubmits, this dispute is about history and has nothing to send back.
		const latest = await tx.phaseSubmission.findFirst({
			orderBy: { createdAt: "desc" },
			select: { id: true },
			where: { phase, themeProjectId },
		})
		if (!latest || latest.id !== dispute.submission.id)
			throw new HttpError("CONFLICT", "The maker has resubmitted since, so there is nothing to send back")

		await tx.submissionReview.updateMany({
			data: { invalidated: true, invalidatedAt: new Date() },
			where: { invalidated: false, submission: { phase, themeProjectId } },
		})
		await tx.phaseSubmission.update({
			data: {
				ariDecision: null,
				ariShipError: null,
				ariStatus: "review",
				ariSubmissionId: null,
				resolvedAt: null,
				resolvedResult: null,
			},
			where: { id: dispute.submission.id },
		})
		await tx.themeProject.update({
			data: phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : { buildStatus: PhaseStatus.in_review },
			where: { id: themeProjectId },
		})

		const closed = await tx.reviewDispute.updateMany({
			data: { outcome: ReviewDisputeOutcome.upheld, resolvedAt: new Date(), resolvedById: reviewerId },
			where: { id: disputeId, resolvedAt: null },
		})
		if (closed.count === 0) throw new HttpError("CONFLICT", "That dispute is already resolved")
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

export { closeDispute, sendDisputedPhaseBack }
