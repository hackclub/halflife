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
import { ENTRY_TIER, getTierOrThrow, isTierId, tierForHours } from "@/lib/config/tiers"
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
		select: { themeProject: { select: { userId: true } } },
		where: { id: submissionId },
	})
	if (!owner) throw new HttpError("NOT_FOUND", "Submission not found")
	if (owner.themeProject.userId === reviewerId)
		throw new HttpError("FORBIDDEN", "You cannot review your own submission")

	const settings = await getProgramSettings()
	const expiresAt = new Date(Date.now() + settings.reviewClaimTtlMinutes * 60_000)

	// Opportunistically clear a dead reviewer's lock so a queue isn't blocked for up to a full sweep interval.
	await prisma.reviewClaim.deleteMany({
		where: { OR: [{ expiresAt: { lt: new Date() } }, { reviewerId }], submissionId },
	})

	try {
		await prisma.reviewClaim.create({ data: { expiresAt, reviewerId, submissionId } })
		return { expiresAt, ok: true }
	} catch {
		const held = await prisma.reviewClaim.findUnique({
			include: { reviewer: { select: { displayName: true, name: true } } },
			where: { submissionId },
		})
		if (!held) throw new HttpError("CONFLICT", "Could not claim this submission")
		return {
			expiresAt: held.expiresAt,
			heldBy: held.reviewerId,
			// The claim conflict is shown on the queue, so it names them the way the queue does.
			heldByName: displayName(held.reviewer),
			ok: false,
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

/**
 * How long a maker is given to act on a return: a week, not the three days an admin grants by hand.
 *
 * A returned phase is a request for changes, so its maker has to open the project again, fix it and hand it in – and by the time a review lands late in a week that work may no longer fit before the close. The window is measured from the return rather than the week's own close, so an extension only bites when the scheduled close is sooner, and it never shortens a longer extension an admin already put on record.
 */
export const RETURN_EXTENSION_MS = 7 * 24 * 60 * 60 * 1000

/** A returned phase's extension: at least a week from now, kept at whichever is later than what is already on record. */
export function returnExtensionUntil(current: Date | null | undefined, now: Date = new Date()): Date {
	return new Date(Math.max(now.getTime() + RETURN_EXTENSION_MS, current?.getTime() ?? 0))
}

export interface FinalizeInput {
	/** Shown to the participant. */
	feedback: string
	/**
	 * Whether a return grants its maker a week to act on it. Left on for a live decision; turned off by a backlog replay (`reconcileAriDecisions`), which applies a months-old return now and must not reopen weeks long after the fact.
	 */
	grantExtension?: boolean
	grantUsdOverride?: number | null
	/** Replaces the computed hours total outright. */
	hoursOverride?: number | null
	/** Internal note, never shown to the submitter; kept on the review and in the audit row. */
	reason?: string | null
	result: ReviewResult
	reviewerEmail: string | null
	/** Null when the decision was made by Ari, not by a Half Life user. */
	reviewerId: string | null
	reviewerName: string | null
	submissionId: string
	/** Required on a design approval. */
	tier?: number | null
}

export interface FinalizeOutcome {
	approvedHours: number | null
	/** Coins this decision minted, by pot. Null when not approving. */
	coins: CoinSplit | null
	grantUsd: number | null
	phase: Phase
	printerQualified: boolean
	result: ReviewResult
	themeProjectId: string
	tier: number | null
}

/**
 * Record a review decision and move everything that depends on it.
 *
 * The whole thing is one transaction because a partial application – status moved but credit not written, or credit written twice – is the failure that costs real money.
 */
export async function finalizeReview(input: FinalizeInput): Promise<FinalizeOutcome> {
	const submission = await prisma.phaseSubmission.findUnique({
		include: {
			claim: true,
			themeProject: {
				include: { user: { select: { id: true, printerGoalId: true } } },
			},
		},
		where: { id: input.submissionId },
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
		approving
		&& phase === Phase.BUILD
		&& project.theme !== Theme.WARMUP
		&& project.designStatus !== PhaseStatus.approved
	)
		throw new HttpError("DESIGN_NOT_APPROVED", "Approve the design phase for this theme before approving the build")

	let tier = project.tier
	if (approving && phase === Phase.DESIGN) {
		// The tier's dollars are parts money, so the decision lands here – before the participant starts building – not at build approval.
		const chosen = input.tier ?? project.tier
		if (!isTierId(chosen)) throw new HttpError("VALIDATION_FAILED", "Assign a funding tier when approving a design")
		tier = chosen
	}

	// Frozen before the snapshot read, so sessions created after it are not stamped as reviewed below.
	const snapshotAt = new Date()
	const breakdown = await getHoursBreakdown(project.id, phase, { live: approving })
	// A reviewer (human or Ari) who supplied the hours explicitly has already covered the underpayment risk that a stale Hackatime reading creates, so staleness must not block a decision that does not depend on the live value.
	if (approving && input.hoursOverride == null && breakdown.hackatimeStale)
		// Refusing here is the point: stasis's client returns 0 on a Hackatime timeout and that zero flows into the grant row, silently underpaying someone with no trace.
		throw new HttpError(
			"HACKATIME_STALE",
			"Hackatime data could not be refreshed. Retry, or set an explicit hours override.",
		)

	const approvedHours = approving ? (input.hoursOverride ?? breakdown.computedTotal) : null

	// A declined grant defaults to nothing: the maker asked for no parts money, so approving the design must not mint one behind their back. An explicit reviewer override still wins – setting a number there is a deliberate choice, not an accident.
	const grantUsd =
		approving && phase === Phase.DESIGN && tier
			? (input.grantUsdOverride ?? (submission.fundingDeclined ? 0 : getTierOrThrow(tier).grantUsd))
			: project.grantUsd

	// A tier's grant buys that tier's funded block of hours, so it is not paid on fewer hours than it funds. The
	// submit gate refuses a hand-in below the floor (lib/submissions), so this only bites when the decision approves
	// less time than was logged. Then the tier is what has to move, not the grant: a hundred dollars of parts for a
	// five-hour week is money for work that was not done. An explicit grant override is an admin decision about the
	// amount, so it is left alone.
	if (approving && phase === Phase.DESIGN && tier && (grantUsd ?? 0) > 0 && input.grantUsdOverride == null) {
		const funded = getTierOrThrow(tier).fundingHours
		const approved = approvedHours ?? 0
		if (approved < funded) {
			const affordable = tierForHours(approved)
			throw new HttpError(
				"VALIDATION_FAILED",
				affordable
					? `Tier ${tier} funds ${funded} hours and this decision approves ${approved}h. Tier ${affordable.id} is the tier those hours earn.`
					: `Tier ${tier} funds ${funded} hours and this decision approves ${approved}h, which is under every tier. Approve at least ${ENTRY_TIER.fundingHours} hours, or return the design for more work.`,
			)
		}
	}

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

	const outcome = await prisma.$transaction(async tx => {
		// reconcileGrant reads a running sum and writes a delta against it, so it needs the same serialization the shop does.
		await lockUserCredit(tx, project.userId)

		// Re-read inside the transaction: the review page may have been open for a while, and the participant may have withdrawn in the meantime.
		const fresh = await tx.phaseSubmission.findUnique({
			select: { resolvedAt: true },
			where: { id: input.submissionId },
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
				select: { designStatus: true, theme: true },
				where: { id: project.id },
			})
			if (design?.theme !== Theme.WARMUP && design?.designStatus !== PhaseStatus.approved)
				throw new HttpError("DESIGN_NOT_APPROVED", "Approve the design phase for this theme before approving the build")
		}

		if (approving)
			// Accept every unreviewed session at its claimed hours, so the per-session numbers stay consistent with the frozen total.
			// Only sessions in the snapshot: one created after it was never counted in the frozen total.
			await tx.workSession.updateMany({
				data: { reviewedAt: new Date(), reviewedById: input.reviewerId },
				where: {
					createdAt: { lt: snapshotAt },
					deletedAt: null,
					hoursApproved: null,
					phase,
					themeProjectId: project.id,
				},
			})

		await tx.submissionReview.create({
			data: {
				feedback: input.feedback,
				frozenApprovedHours: approvedHours,
				frozenBankedCoins: coins?.banked ?? null,
				frozenBankHours: goal.paceHours,
				frozenEntryCount: breakdown.journalEntryCount,
				frozenFundingHours: tierDef?.fundingHours ?? null,
				frozenGrantUsd: grantUsd,
				frozenHackatimeHours: breakdown.hackatimeHours,
				// Freeze what the reviewer was looking at. The tier table is expected to change mid-program, so without these there is no way to reconstruct why anyone was paid what they were paid.
				frozenJournalHours: breakdown.journalHours,
				frozenPrinterGoalId: goal.id,
				frozenSpendableCoins: coins?.spendable ?? null,
				frozenTier: tier,
				frozenTimelapseSeconds: breakdown.timelapseSeconds,
				grantUsdOverride: input.grantUsdOverride ?? null,
				hoursOverride: input.hoursOverride ?? null,
				pass: ReviewPass.FINAL,
				reason: input.reason ?? null,
				result: input.result,
				// Who decided, as contact details rather than only an account link: Ari's reviewers hold no Half Life account, so `reviewerId` is null for every Ari decision and the email is the only attribution the leaderboard has. Console reviewers carry both.
				reviewerEmail: input.reviewerEmail,
				reviewerId: input.reviewerId,
				reviewerName: input.reviewerName,
				submissionId: input.submissionId,
				tierOverride: input.tier ?? null,
			},
		})

		await tx.phaseSubmission.update({
			data: { resolvedAt: new Date(), resolvedResult: input.result },
			where: { id: input.submissionId },
		})

		const projectUpdate: Prisma.ThemeProjectUpdateInput = {
			...(phase === Phase.DESIGN
				? {
						designReviewComments: input.feedback,
						designReviewedAt: new Date(),
						designReviewedById: input.reviewerId,
						designStatus: nextStatus,
						...(approving
							? {
									designApprovedHours: approvedHours,
									designApprovedHoursAt: new Date(),
									designBankedCoins: coins?.banked ?? null,
									designSpendableCoins: coins?.spendable ?? null,
									grantEmittedAt: new Date(),
									grantUsd,
									tier,
								}
							: {}),
					}
				: {
						buildReviewComments: input.feedback,
						buildReviewedAt: new Date(),
						buildReviewedById: input.reviewerId,
						buildStatus: nextStatus,
						...(approving
							? {
									approvedHours,
									approvedHoursAt: new Date(),
									// Spendable only: the banked half is reconciled through the ledger's BUILD_BANKED_HOURS rows, not this display field.
									buildCoins: coins?.spendable ?? null,
								}
							: {}),
					}),
			// A return is the one state a maker is expected to act on, so it carries the time to act: a week from the return, on the project rather than the account, so only this project's week reopens. A backlog replay turns this off with the notice it also skips.
			...(input.result === ReviewResult.RETURNED && input.grantExtension !== false
				? { submissionExtensionUntil: returnExtensionUntil(project.submissionExtensionUntil) }
				: {}),
		}

		await tx.themeProject.update({ data: projectUpdate, where: { id: project.id } })

		// Credit is reconciled to a target rather than appended, so approving the same build five times converges instead of compounding.
		if (phase === Phase.DESIGN) {
			// The legacy locked half and the spendable half are separate kinds, so an un-approval can zero each one independently and neither has to work out which share of a combined number was its own. New approvals always target zero for the locked half – every coin is spendable now – which also migrates an old approval to the single pot the next time it is re-decided, with no change to its total.
			await reconcileGrant(tx, {
				bucket: CoinBucket.BANKED,
				createdById: input.reviewerId,
				kind: LedgerKind.DESIGN_BANKED_HOURS,
				note:
					approving && tierDef
						? `${approvedHours}h approved: ${tierDef.fundingHours}h funded at $${tierDef.grantUsd}, ${coins?.spendable ?? 0} coins spendable`
						: "Design approval withdrawn",
				target: approving ? (coins?.banked ?? 0) : 0,
				themeProjectId: project.id,
				userId: project.userId,
			})
			await reconcileGrant(tx, {
				createdById: input.reviewerId,
				kind: LedgerKind.DESIGN_EXCESS_HOURS,
				note:
					approving && tierDef
						? `Hours beyond Tier ${tier}'s ${tierDef.fundingHours}h funded, spendable on anything`
						: "Design approval withdrawn",
				target: approving ? (coins?.spendable ?? 0) : 0,
				themeProjectId: project.id,
				userId: project.userId,
			})
		}

		if (phase === Phase.BUILD) {
			// Two kinds for the same reason as a design approval: reconcileGrant sums by kind, so folding the legacy locked half into the spendable kind would reconcile each against the other's running total. New approvals target zero for the locked half.
			await reconcileGrant(tx, {
				bucket: CoinBucket.BANKED,
				createdById: input.reviewerId,
				kind: LedgerKind.BUILD_BANKED_HOURS,
				note: approving ? `${approvedHours}h of build work, all spendable` : "Build approval withdrawn",
				target: approving ? (coins?.banked ?? 0) : 0,
				themeProjectId: project.id,
				userId: project.userId,
			})
			await reconcileGrant(tx, {
				createdById: input.reviewerId,
				kind: LedgerKind.BUILD_HOURS,
				note: approving ? `${approvedHours}h of build work, spendable on anything` : "Build approval withdrawn",
				target: approving ? (coins?.spendable ?? 0) : 0,
				themeProjectId: project.id,
				userId: project.userId,
			})
			await reconcileGrant(tx, {
				createdById: input.reviewerId,
				kind: LedgerKind.THEME_COMPLETION_BONUS,
				note: `${getThemeDef(project.theme).label} shipped`,
				target: approving ? THEME_COMPLETION_BONUS : 0,
				themeProjectId: project.id,
				userId: project.userId,
			})
		}

		await tx.reviewClaim.deleteMany({ where: { submissionId: input.submissionId } })

		const award = approving ? await ensurePrinterAward(tx, project.userId) : null

		return {
			approvedHours,
			coins,
			grantUsd,
			phase,
			printerQualified: Boolean(award),
			result: input.result,
			themeProjectId: project.id,
			tier,
		}
	})

	await logAudit({
		action:
			input.result === ReviewResult.APPROVED
				? AuditAction.REVIEW_APPROVE
				: input.result === ReviewResult.RETURNED
					? AuditAction.REVIEW_RETURN
					: AuditAction.REVIEW_REJECT,
		actorEmail: input.reviewerEmail,
		actorId: input.reviewerId,
		metadata: {
			after: {
				approvedHours: outcome.approvedHours,
				coins: outcome.coins,
				grantUsd: outcome.grantUsd,
				status: nextStatus,
				tier: outcome.tier,
			},
			before: {
				approvedHours: project.approvedHours,
				grantUsd: project.grantUsd,
				status: phase === Phase.DESIGN ? project.designStatus : project.buildStatus,
				tier: project.tier,
			},
			phase,
			submissionId: input.submissionId,
		},
		targetId: project.id,
		targetType: "ThemeProject",
	})

	return outcome
}

/**
 * Reverse an approval.
 *
 * Because credit is reconciled to a target, undoing is the same call with `target: 0` – there is no separate reversal code path, so there is no separate reversal code path to get wrong.
 *
 * `grantExtension` is opt-in because the admin reversal it serves asks the maker to act (the override route notifies them), whereas Ari's own revert calls this on its way back to `in_review` – a state the maker never holds, and one where re-opening their week would be time nobody asked for.
 */
export async function unapprovePhase(
	themeProjectId: string,
	phase: Phase,
	adminId: string | null,
	adminEmail: string | null,
	reason: string,
	options: { grantExtension?: boolean } = {},
): Promise<void> {
	const project = await prisma.themeProject.findUnique({ where: { id: themeProjectId } })
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
	if (status !== PhaseStatus.approved) throw new HttpError("CONFLICT", "That phase is not approved")

	await prisma.$transaction(async tx => {
		await lockUserCredit(tx, project.userId)

		// Re-read under the lock: the fast check above ran against a read taken before it, and a decision or re-approval can have committed since.
		const fresh = await tx.themeProject.findUnique({
			select: { buildStatus: true, designStatus: true },
			where: { id: themeProjectId },
		})
		if ((phase === Phase.DESIGN ? fresh?.designStatus : fresh?.buildStatus) !== PhaseStatus.approved)
			throw new HttpError("CONFLICT", "That phase is no longer approved")

		// A grant send holds no credit lock while HCB is called, so a design un-approval must not race it: the money would be sent for an approval that no longer stands, and the sent row would block a later send. `sendGrant` marks the row errored before it throws, which is what lets this same check pass on the retry after the window.
		if (phase === Phase.DESIGN) {
			const inFlight = await tx.hcbGrantTopUp.findFirst({
				select: { id: true },
				where: {
					createdAt: { gt: new Date(Date.now() - ABANDONED_ATTEMPT_MS) },
					error: null,
					phase: Phase.DESIGN,
					sentAt: null,
					themeProjectId,
					userId: project.userId,
				},
			})
			if (inFlight)
				throw new HttpError(
					"CONFLICT",
					"A grant send is in flight for this design – wait for it to finish before un-approving",
				)
		}

		await tx.submissionReview.updateMany({
			data: { invalidated: true, invalidatedAt: new Date() },
			where: { invalidated: false, submission: { phase, themeProjectId } },
		})

		await tx.themeProject.update({
			data: {
				...(phase === Phase.DESIGN
					? {
							designApprovedHours: null,
							designApprovedHoursAt: null,
							designBankedCoins: null,
							designReviewComments: reason,
							designSpendableCoins: null,
							designStatus: PhaseStatus.update_requested,
							grantEmittedAt: null,
							grantUsd: null,
							tier: null,
						}
					: {
							approvedHours: null,
							approvedHoursAt: null,
							buildCoins: null,
							buildReviewComments: reason,
							buildStatus: PhaseStatus.update_requested,
						}),
				...(options.grantExtension
					? { submissionExtensionUntil: returnExtensionUntil(project.submissionExtensionUntil) }
					: {}),
			},
			where: { id: themeProjectId },
		})

		if (phase === Phase.DESIGN) {
			// Includes the banked half. Forced savings are still savings someone was credited for work that is no longer approved, so they unwind too – otherwise un-approving a design leaves free printer money behind.
			await reconcileGrant(tx, {
				bucket: CoinBucket.BANKED,
				createdById: adminId,
				kind: LedgerKind.DESIGN_BANKED_HOURS,
				note: `Design un-approved: ${reason}`,
				target: 0,
				themeProjectId,
				userId: project.userId,
			})
			await reconcileGrant(tx, {
				createdById: adminId,
				kind: LedgerKind.DESIGN_EXCESS_HOURS,
				note: `Design un-approved: ${reason}`,
				target: 0,
				themeProjectId,
				userId: project.userId,
			})
		}

		if (phase === Phase.BUILD) {
			// The banked half unwinds too, for the same reason the design's does: forced savings are still savings credited for work no longer approved.
			await reconcileGrant(tx, {
				bucket: CoinBucket.BANKED,
				createdById: adminId,
				kind: LedgerKind.BUILD_BANKED_HOURS,
				note: `Build un-approved: ${reason}`,
				target: 0,
				themeProjectId,
				userId: project.userId,
			})
			await reconcileGrant(tx, {
				createdById: adminId,
				kind: LedgerKind.BUILD_HOURS,
				note: `Build un-approved: ${reason}`,
				target: 0,
				themeProjectId,
				userId: project.userId,
			})
			await reconcileGrant(tx, {
				createdById: adminId,
				kind: LedgerKind.THEME_COMPLETION_BONUS,
				note: `Build un-approved: ${reason}`,
				target: 0,
				themeProjectId,
				userId: project.userId,
			})
		}
	})

	await logAudit({
		action: AuditAction.ADMIN_UNAPPROVE_PHASE,
		actorEmail: adminEmail,
		actorId: adminId,
		metadata: { before: { status: PhaseStatus.approved }, phase, reason },
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})
}

/** Bring a rejected phase back into play. Rejection is not terminal forever. `grantExtension` is opt-in for the same reason as `unapprovePhase`: Ari's revert is transient and does not ask the maker for anything. */
export async function reopenPhase(
	themeProjectId: string,
	phase: Phase,
	adminId: string | null,
	adminEmail: string | null,
	reason: string,
	options: { grantExtension?: boolean } = {},
): Promise<void> {
	const project = await prisma.themeProject.findUnique({ where: { id: themeProjectId } })
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
	if (status !== PhaseStatus.rejected) throw new HttpError("CONFLICT", "That phase is not rejected")

	// Conditional on the status that was read: an admin double-click, or a reopen racing a resubmission, must not overwrite a newer state.
	const reopened = await prisma.themeProject.updateMany({
		data: {
			...(phase === Phase.DESIGN
				? { designReviewComments: reason, designStatus: PhaseStatus.update_requested }
				: { buildReviewComments: reason, buildStatus: PhaseStatus.update_requested }),
			...(options.grantExtension
				? { submissionExtensionUntil: returnExtensionUntil(project.submissionExtensionUntil) }
				: {}),
		},
		where: {
			id: themeProjectId,
			...(phase === Phase.DESIGN ? { designStatus: PhaseStatus.rejected } : { buildStatus: PhaseStatus.rejected }),
		},
	})
	if (reopened.count !== 1) throw new HttpError("CONFLICT", "That phase moved while it was being reopened")

	await logAudit({
		action: AuditAction.ADMIN_REOPEN_PHASE,
		actorEmail: adminEmail,
		actorId: adminId,
		metadata: { phase, reason },
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})
}
