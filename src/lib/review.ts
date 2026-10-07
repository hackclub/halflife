import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import {
	CoinBucket,
	LedgerKind,
	Phase,
	PhaseStatus,
	ReviewPass,
	ReviewResult,
	Theme,
} from "@/app/generated/prisma/enums"
import { AuditAction, logAudit } from "@/lib/audit"
import { DEFAULT_GOAL_ID, printerById } from "@/lib/config/printers"
import { getThemeDef, THEME_COMPLETION_BONUS } from "@/lib/config/program"
import { getTierOrThrow, isTierId } from "@/lib/config/tiers"
import { lockUserCredit, reconcileGrant } from "@/lib/currency"
import { displayName } from "@/lib/display-name"
import { HttpError } from "@/lib/errors"
import { ABANDONED_ATTEMPT_MS } from "@/lib/grants"
import { buildCoinsFor, type CoinSplit, designCoinsFor, getHoursBreakdown } from "@/lib/hours"
import { ensurePrinterAward } from "@/lib/printer"
import prisma from "@/lib/prisma"
import { getProgramSettings } from "@/lib/program"

// ─── Claim locks ─────────────────────────────────────────────────────────────

export type ClaimResult =
	| { ok: true; expiresAt: Date }
	| { ok: false; heldBy: string; heldByName: string | null; expiresAt: Date }

/**
 * Take an exclusive lock on a submission.
 *
 * `submissionId` is unique, so this is a single insert that either succeeds or collides. Never implement claiming as read-then-write: two reviewers opening the queue at the same moment both read "unclaimed" and both proceed.
 */
export async function claimSubmission(submissionId: string, reviewerId: string): Promise<ClaimResult> {
	const owner = await prisma.phaseSubmission.findUnique({
		where: { id: submissionId },
		select: { themeProject: { select: { userId: true } } },
	})
	if (!owner) throw new HttpError("NOT_FOUND", "Submission not found")
	if (owner.themeProject.userId === reviewerId)
		throw new HttpError("FORBIDDEN", "You cannot review your own submission")

	const settings = await getProgramSettings()
	const expiresAt = new Date(Date.now() + settings.reviewClaimTtlMinutes * 60_000)

	// Opportunistically clear a dead reviewer's lock so a queue isn't blocked for up to a full sweep interval.
	await prisma.reviewClaim.deleteMany({
		where: { submissionId, OR: [{ expiresAt: { lt: new Date() } }, { reviewerId }] },
	})

	try {
		await prisma.reviewClaim.create({ data: { submissionId, reviewerId, expiresAt } })
		return { ok: true, expiresAt }
	} catch {
		const held = await prisma.reviewClaim.findUnique({
			where: { submissionId },
			include: { reviewer: { select: { name: true, displayName: true } } },
		})
		if (!held) throw new HttpError("CONFLICT", "Could not claim this submission")
		return {
			ok: false,
			heldBy: held.reviewerId,
			// The claim conflict is shown on the queue, so it names them the way the queue does.
			heldByName: displayName(held.reviewer),
			expiresAt: held.expiresAt,
		}
	}
}

export async function releaseClaim(submissionId: string, reviewerId: string): Promise<void> {
	const claim = await prisma.reviewClaim.findUnique({ where: { submissionId } })
	if (!claim) return
	if (claim.reviewerId !== reviewerId) throw new HttpError("FORBIDDEN", "That claim belongs to another reviewer")
	await prisma.reviewClaim.delete({ where: { submissionId } })
}

export async function sweepExpiredClaims(): Promise<number> {
	const { count } = await prisma.reviewClaim.deleteMany({
		where: { expiresAt: { lt: new Date() } },
	})
	return count
}

// ─── Decisions ───────────────────────────────────────────────────────────────

export interface FinalizeInput {
	submissionId: string
	/** Null when the decision was made by Ari, not by a Half Life user. */
	reviewerId: string | null
	reviewerName: string | null
	reviewerEmail: string | null
	result: ReviewResult
	/** Shown to the participant. */
	feedback: string
	/** Internal note, never shown to the submitter; kept on the review and in the audit row. */
	reason?: string | null
	/** Required on a design approval. */
	tier?: number | null
	/** Replaces the computed hours total outright. */
	hoursOverride?: number | null
	grantUsdOverride?: number | null
}

export interface FinalizeOutcome {
	themeProjectId: string
	phase: Phase
	result: ReviewResult
	approvedHours: number | null
	tier: number | null
	grantUsd: number | null
	/** Coins this decision minted, by pot. Null when not approving. */
	coins: CoinSplit | null
	printerQualified: boolean
}

/**
 * Record a review decision and move everything that depends on it.
 *
 * The whole thing is one transaction because a partial application – status moved but credit not written, or credit written twice – is the failure that costs real money.
 */
export async function finalizeReview(input: FinalizeInput): Promise<FinalizeOutcome> {
	const submission = await prisma.phaseSubmission.findUnique({
		where: { id: input.submissionId },
		include: {
			themeProject: {
				include: { user: { select: { id: true, printerGoalId: true } } },
			},
			claim: true,
		},
	})
	if (!submission) throw new HttpError("NOT_FOUND", "Submission not found")

	// Nobody reviews their own work. Every account gets its own five themed projects at signup, reviewers included, so without this a REVIEWER could approve their own design, set their own tier, and mint their own credit – which is exactly what the role is not supposed to be able to do. Admins are not exempt: the point is a second pair of eyes, not a trust level.
	if (submission.themeProject.userId === input.reviewerId)
		throw new HttpError("FORBIDDEN", "You cannot review your own submission")

	if (submission.resolvedAt) throw new HttpError("ALREADY_RESOLVED", "This submission has already been decided")
	if (submission.claim && submission.claim.reviewerId !== input.reviewerId && submission.claim.expiresAt > new Date())
		throw new HttpError("CLAIMED_BY_OTHER", "Another reviewer holds the claim on this submission")

	const project = submission.themeProject
	const phase = submission.phase
	const approving = input.result === ReviewResult.APPROVED

	// A build cannot be approved before its design is. Submitting out of order is fine – see canSubmitPhase – but paying out of order is not. A warm-up project has no design to wait for: its one phase is whatever the form collected.
	if (
		approving &&
		phase === Phase.BUILD &&
		project.theme !== Theme.WARMUP &&
		project.designStatus !== PhaseStatus.approved
	) {
		throw new HttpError("DESIGN_NOT_APPROVED", "Approve the design phase for this theme before approving the build")
	}

	let tier = project.tier
	if (approving && phase === Phase.DESIGN) {
		// The tier's dollars are parts money, so the decision lands here – before the participant starts building – not at build approval.
		const chosen = input.tier ?? project.tier
		if (!isTierId(chosen)) throw new HttpError("VALIDATION_FAILED", "Assign a funding tier when approving a design")
		tier = chosen
	}

	const breakdown = await getHoursBreakdown(project.id, phase, { live: approving })
	// A reviewer (human or Ari) who supplied the hours explicitly has already covered the underpayment risk that a stale Hackatime reading creates, so staleness must not block a decision that does not depend on the live value.
	if (approving && input.hoursOverride == null && breakdown.hackatimeStale) {
		// Refusing here is the point: stasis's client returns 0 on a Hackatime timeout and that zero flows into the grant row, silently underpaying someone with no trace.
		throw new HttpError(
			"HACKATIME_STALE",
			"Hackatime data could not be refreshed. Retry, or set an explicit hours override.",
		)
	}

	const approvedHours = approving ? (input.hoursOverride ?? breakdown.computedTotal) : null

	const grantUsd =
		approving && phase === Phase.DESIGN && tier
			? (input.grantUsdOverride ?? getTierOrThrow(tier).grantUsd)
			: project.grantUsd

	// The machine this participant is saving for is frozen alongside the tier for the pacing displays: it no longer sizes the payout, but the goal tracker still reads it to say what this week's work means for the goal. Someone who never chose one is paced against the default.
	const goal = printerById(project.user.printerGoalId ?? DEFAULT_GOAL_ID)

	// Both phases mint coins, by different rules. A design pays out only above its tier's funded hours; a build has no funded block, so every hour pays. Either way every coin is spendable on anything.
	const coins: CoinSplit | null =
		approving && approvedHours !== null
			? phase === Phase.DESIGN
				? tier
					? designCoinsFor(tier, approvedHours)
					: null
				: buildCoinsFor(approvedHours)
			: null

	const tierDef = tier ? getTierOrThrow(tier) : null

	const nextStatus: PhaseStatus =
		input.result === ReviewResult.APPROVED
			? PhaseStatus.approved
			: input.result === ReviewResult.RETURNED
				? PhaseStatus.update_requested
				: PhaseStatus.rejected

	const outcome = await prisma.$transaction(async (tx) => {
		// reconcileGrant reads a running sum and writes a delta against it, so it needs the same serialization the shop does.
		await lockUserCredit(tx, project.userId)

		// Re-read inside the transaction: the review page may have been open for a while, and the participant may have withdrawn in the meantime.
		const fresh = await tx.phaseSubmission.findUnique({
			where: { id: input.submissionId },
			select: { resolvedAt: true },
		})
		if (!fresh) throw new HttpError("NOT_SUBMITTED", "This submission has been withdrawn")
		if (fresh.resolvedAt) throw new HttpError("ALREADY_RESOLVED", "Already decided")

		// Re-check the claim under the transaction too. The check before it ran against a read taken when the page opened, so another reviewer can have claimed the submission since; without this the decision would proceed and delete their live claim on the way out.
		const claim = await tx.reviewClaim.findUnique({ where: { submissionId: input.submissionId } })
		if (claim && claim.reviewerId !== input.reviewerId && claim.expiresAt > new Date())
			throw new HttpError("CLAIMED_BY_OTHER", "Another reviewer holds the claim on this submission")

		// Re-check the design ordering under the same per-user lock the un-approve path takes. The check before the transaction ran against a read taken before the live Hackatime fetch; an admin can un-approve the design in that window, and a build approval must not pay out of order. Taking the lock first means this read sees either the un-approval (and refuses) or blocks it until this decision has committed.
		if (approving && phase === Phase.BUILD) {
			const design = await tx.themeProject.findUnique({
				where: { id: project.id },
				select: { designStatus: true, theme: true },
			})
			if (design?.theme !== Theme.WARMUP && design?.designStatus !== PhaseStatus.approved)
				throw new HttpError("DESIGN_NOT_APPROVED", "Approve the design phase for this theme before approving the build")
		}

		if (approving) {
			// Accept every unreviewed session at its claimed hours, so the per-session numbers stay consistent with the frozen total.
			await tx.workSession.updateMany({
				where: { themeProjectId: project.id, phase, deletedAt: null, hoursApproved: null },
				data: { reviewedAt: new Date(), reviewedById: input.reviewerId },
			})
		}

		await tx.submissionReview.create({
			data: {
				submissionId: input.submissionId,
				reviewerId: input.reviewerId,
				pass: ReviewPass.FINAL,
				result: input.result,
				feedback: input.feedback,
				reason: input.reason ?? null,
				hoursOverride: input.hoursOverride ?? null,
				tierOverride: input.tier ?? null,
				grantUsdOverride: input.grantUsdOverride ?? null,
				// Freeze what the reviewer was looking at. The tier table is expected to change mid-program, so without these there is no way to reconstruct why anyone was paid what they were paid.
				frozenJournalHours: breakdown.journalHours,
				frozenHackatimeHours: breakdown.hackatimeHours,
				frozenTimelapseSeconds: breakdown.timelapseSeconds,
				frozenEntryCount: breakdown.journalEntryCount,
				frozenApprovedHours: approvedHours,
				frozenTier: tier,
				frozenGrantUsd: grantUsd,
				frozenBankedCoins: coins?.banked ?? null,
				frozenSpendableCoins: coins?.spendable ?? null,
				frozenFundingHours: tierDef?.fundingHours ?? null,
				frozenBankHours: goal.paceHours,
				frozenPrinterGoalId: goal.id,
			},
		})

		await tx.phaseSubmission.update({
			where: { id: input.submissionId },
			data: { resolvedAt: new Date(), resolvedResult: input.result },
		})

		const projectUpdate: Prisma.ThemeProjectUpdateInput =
			phase === Phase.DESIGN
				? {
						designStatus: nextStatus,
						designReviewComments: input.feedback,
						designReviewedAt: new Date(),
						designReviewedById: input.reviewerId,
						...(approving
							? {
									tier,
									grantUsd,
									grantEmittedAt: new Date(),
									designApprovedHours: approvedHours,
									designApprovedHoursAt: new Date(),
									designBankedCoins: coins?.banked ?? null,
									designSpendableCoins: coins?.spendable ?? null,
								}
							: {}),
					}
				: {
						buildStatus: nextStatus,
						buildReviewComments: input.feedback,
						buildReviewedAt: new Date(),
						buildReviewedById: input.reviewerId,
						...(approving
							? {
									approvedHours,
									approvedHoursAt: new Date(),
									// Spendable only: the banked half is reconciled through the ledger's BUILD_BANKED_HOURS rows, not this display field.
									buildCoins: coins?.spendable ?? null,
								}
							: {}),
					}

		await tx.themeProject.update({ where: { id: project.id }, data: projectUpdate })

		// Credit is reconciled to a target rather than appended, so approving the same build five times converges instead of compounding.
		if (phase === Phase.DESIGN) {
			// The legacy locked half and the spendable half are separate kinds, so an un-approval can zero each one independently and neither has to work out which share of a combined number was its own. New approvals always target zero for the locked half – every coin is spendable now – which also migrates an old approval to the single pot the next time it is re-decided, with no change to its total.
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId: project.id,
				kind: LedgerKind.DESIGN_BANKED_HOURS,
				bucket: CoinBucket.BANKED,
				target: approving ? (coins?.banked ?? 0) : 0,
				note:
					approving && tierDef
						? `${approvedHours}h approved: ${tierDef.fundingHours}h funded at $${tierDef.grantUsd}, ${coins?.spendable ?? 0} coins spendable`
						: "Design approval withdrawn",
				createdById: input.reviewerId,
			})
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId: project.id,
				kind: LedgerKind.DESIGN_EXCESS_HOURS,
				target: approving ? (coins?.spendable ?? 0) : 0,
				note:
					approving && tierDef
						? `Hours beyond Tier ${tier}'s ${tierDef.fundingHours}h funded, spendable on anything`
						: "Design approval withdrawn",
				createdById: input.reviewerId,
			})
		}

		if (phase === Phase.BUILD) {
			// Two kinds for the same reason as a design approval: reconcileGrant sums by kind, so folding the legacy locked half into the spendable kind would reconcile each against the other's running total. New approvals target zero for the locked half.
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId: project.id,
				kind: LedgerKind.BUILD_BANKED_HOURS,
				bucket: CoinBucket.BANKED,
				target: approving ? (coins?.banked ?? 0) : 0,
				note: approving ? `${approvedHours}h of build work, all spendable` : "Build approval withdrawn",
				createdById: input.reviewerId,
			})
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId: project.id,
				kind: LedgerKind.BUILD_HOURS,
				target: approving ? (coins?.spendable ?? 0) : 0,
				note: approving ? `${approvedHours}h of build work, spendable on anything` : "Build approval withdrawn",
				createdById: input.reviewerId,
			})
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId: project.id,
				kind: LedgerKind.THEME_COMPLETION_BONUS,
				target: approving ? THEME_COMPLETION_BONUS : 0,
				note: `${getThemeDef(project.theme).label} shipped`,
				createdById: input.reviewerId,
			})
		}

		await tx.reviewClaim.deleteMany({ where: { submissionId: input.submissionId } })

		const award = approving ? await ensurePrinterAward(tx, project.userId) : null

		return {
			themeProjectId: project.id,
			phase,
			result: input.result,
			approvedHours,
			tier,
			grantUsd,
			coins,
			printerQualified: !!award,
		}
	})

	await logAudit({
		action:
			input.result === ReviewResult.APPROVED
				? AuditAction.REVIEW_APPROVE
				: input.result === ReviewResult.RETURNED
					? AuditAction.REVIEW_RETURN
					: AuditAction.REVIEW_REJECT,
		actorId: input.reviewerId,
		actorEmail: input.reviewerEmail,
		targetType: "ThemeProject",
		targetId: project.id,
		metadata: {
			phase,
			submissionId: input.submissionId,
			before: {
				status: phase === Phase.DESIGN ? project.designStatus : project.buildStatus,
				tier: project.tier,
				grantUsd: project.grantUsd,
				approvedHours: project.approvedHours,
			},
			after: {
				status: nextStatus,
				tier: outcome.tier,
				grantUsd: outcome.grantUsd,
				approvedHours: outcome.approvedHours,
				coins: outcome.coins,
			},
		},
	})

	return outcome
}

/**
 * Reverse an approval.
 *
 * Because credit is reconciled to a target, undoing is the same call with `target: 0` – there is no separate reversal code path, so there is no separate reversal code path to get wrong.
 */
export async function unapprovePhase(
	themeProjectId: string,
	phase: Phase,
	adminId: string | null,
	adminEmail: string | null,
	reason: string,
): Promise<void> {
	const project = await prisma.themeProject.findUnique({ where: { id: themeProjectId } })
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
	if (status !== PhaseStatus.approved) throw new HttpError("CONFLICT", "That phase is not approved")

	await prisma.$transaction(async (tx) => {
		await lockUserCredit(tx, project.userId)

		// Re-read under the lock: the fast check above ran against a read taken before it, and a decision or re-approval can have committed since.
		const fresh = await tx.themeProject.findUnique({
			where: { id: themeProjectId },
			select: { designStatus: true, buildStatus: true },
		})
		if ((phase === Phase.DESIGN ? fresh?.designStatus : fresh?.buildStatus) !== PhaseStatus.approved)
			throw new HttpError("CONFLICT", "That phase is no longer approved")

		// A grant send holds no credit lock while HCB is called, so a design un-approval must not race it: the money would be sent for an approval that no longer stands, and the sent row would block a later send. `sendGrant` marks the row errored before it throws, which is what lets this same check pass on the retry after the window.
		if (phase === Phase.DESIGN) {
			const inFlight = await tx.hcbGrantTopUp.findFirst({
				where: {
					userId: project.userId,
					themeProjectId,
					phase: Phase.DESIGN,
					sentAt: null,
					error: null,
					createdAt: { gt: new Date(Date.now() - ABANDONED_ATTEMPT_MS) },
				},
				select: { id: true },
			})
			if (inFlight) {
				throw new HttpError(
					"CONFLICT",
					"A grant send is in flight for this design – wait for it to finish before un-approving",
				)
			}
		}

		await tx.submissionReview.updateMany({
			where: { submission: { themeProjectId, phase }, invalidated: false },
			data: { invalidated: true, invalidatedAt: new Date() },
		})

		await tx.themeProject.update({
			where: { id: themeProjectId },
			data:
				phase === Phase.DESIGN
					? {
							designStatus: PhaseStatus.update_requested,
							designReviewComments: reason,
							tier: null,
							grantUsd: null,
							grantEmittedAt: null,
							designApprovedHours: null,
							designApprovedHoursAt: null,
							designBankedCoins: null,
							designSpendableCoins: null,
						}
					: {
							buildStatus: PhaseStatus.update_requested,
							buildReviewComments: reason,
							approvedHours: null,
							approvedHoursAt: null,
							buildCoins: null,
						},
		})

		if (phase === Phase.DESIGN) {
			// Includes the banked half. Forced savings are still savings someone was credited for work that is no longer approved, so they unwind too – otherwise un-approving a design leaves free printer money behind.
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId,
				kind: LedgerKind.DESIGN_BANKED_HOURS,
				bucket: CoinBucket.BANKED,
				target: 0,
				note: `Design un-approved: ${reason}`,
				createdById: adminId,
			})
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId,
				kind: LedgerKind.DESIGN_EXCESS_HOURS,
				target: 0,
				note: `Design un-approved: ${reason}`,
				createdById: adminId,
			})
		}

		if (phase === Phase.BUILD) {
			// The banked half unwinds too, for the same reason the design's does: forced savings are still savings credited for work no longer approved.
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId,
				kind: LedgerKind.BUILD_BANKED_HOURS,
				bucket: CoinBucket.BANKED,
				target: 0,
				note: `Build un-approved: ${reason}`,
				createdById: adminId,
			})
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId,
				kind: LedgerKind.BUILD_HOURS,
				target: 0,
				note: `Build un-approved: ${reason}`,
				createdById: adminId,
			})
			await reconcileGrant(tx, {
				userId: project.userId,
				themeProjectId,
				kind: LedgerKind.THEME_COMPLETION_BONUS,
				target: 0,
				note: `Build un-approved: ${reason}`,
				createdById: adminId,
			})
		}
	})

	await logAudit({
		action: AuditAction.ADMIN_UNAPPROVE_PHASE,
		actorId: adminId,
		actorEmail: adminEmail,
		targetType: "ThemeProject",
		targetId: themeProjectId,
		metadata: { phase, reason, before: { status: PhaseStatus.approved } },
	})
}

/** Bring a rejected phase back into play. Rejection is not terminal forever. */
export async function reopenPhase(
	themeProjectId: string,
	phase: Phase,
	adminId: string | null,
	adminEmail: string | null,
	reason: string,
): Promise<void> {
	const project = await prisma.themeProject.findUnique({ where: { id: themeProjectId } })
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
	if (status !== PhaseStatus.rejected) throw new HttpError("CONFLICT", "That phase is not rejected")

	// Conditional on the status that was read: an admin double-click, or a reopen racing a resubmission, must not overwrite a newer state.
	const reopened = await prisma.themeProject.updateMany({
		where: {
			id: themeProjectId,
			...(phase === Phase.DESIGN ? { designStatus: PhaseStatus.rejected } : { buildStatus: PhaseStatus.rejected }),
		},
		data:
			phase === Phase.DESIGN
				? { designStatus: PhaseStatus.update_requested, designReviewComments: reason }
				: { buildStatus: PhaseStatus.update_requested, buildReviewComments: reason },
	})
	if (reopened.count !== 1) throw new HttpError("CONFLICT", "That phase moved while it was being reopened")

	await logAudit({
		action: AuditAction.ADMIN_REOPEN_PHASE,
		actorId: adminId,
		actorEmail: adminEmail,
		targetType: "ThemeProject",
		targetId: themeProjectId,
		metadata: { phase, reason },
	})
}
