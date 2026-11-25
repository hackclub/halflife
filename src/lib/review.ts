import "server-only"
import { and, or } from "@prisma/orm-postgres/orm-client"
import { AuditAction, logAudit } from "@/lib/audit"
import { DEFAULT_GOAL_ID, printerById } from "@/lib/config/printers"
import { THEME_COMPLETION_BONUS, themeLabel } from "@/lib/config/program"
import { ENTRY_TIER, getTierOrThrow, isTierId, steppedTierForHours } from "@/lib/config/tiers"
import { lockUserCredit, reconcileGrant } from "@/lib/currency"
import { displayName } from "@/lib/display-name"
import {
	CoinBucket,
	HcbGrantCardStatus,
	LedgerKind,
	Phase,
	PhaseStatus,
	ReviewPass,
	ReviewResult,
	Theme,
} from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { ABANDONED_ATTEMPT_MS } from "@/lib/grants"
import { buildCoinsFor, type CoinSplit, designCoinsFor, getHoursBreakdown } from "@/lib/hours"
import type { JsonObject } from "@/lib/json"
import { assertPayoutAllowed } from "@/lib/moderation"
import { phaseStatusUpdate, statusFor } from "@/lib/phase"
import { ensurePrinterAward } from "@/lib/printer"
import db, { isUniqueViolation } from "@/lib/prisma8"
import { getProgramSettings } from "@/lib/program"
import { type PublishedDecision, publishReviewDecision } from "@/lib/review-publish"
import { DAY_MS, formatDbTimestamp, parseDbTimestamp, parseNullableTimestamp } from "@/lib/time"
import { isRecord } from "@/lib/unknown"

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
	const owner = await db.orm.public.PhaseSubmission.whereUnique({ id: submissionId })
		.include("themeProject", project => project.select("userId"))
		.first()
	if (!owner?.themeProject) throw new HttpError("NOT_FOUND", "Submission not found")
	if (owner.themeProject.userId === reviewerId)
		throw new HttpError("FORBIDDEN", "You cannot review your own submission")

	const settings = await getProgramSettings()
	const expiresAt = new Date(Date.now() + settings.reviewClaimTtlMinutes * 60_000)
	const expiresAtText = formatDbTimestamp(expiresAt)
	const nowText = formatDbTimestamp(new Date())

	// Opportunistically clear a dead reviewer's lock so a queue isn't blocked for up to a full sweep interval.
	await db.orm.public.ReviewClaim.where({ submissionId })
		.where(claim => or(claim.expiresAt.lt(nowText), claim.reviewerId.eq(reviewerId)))
		.deleteAndCount()

	try {
		await db.orm.public.ReviewClaim.create({ expiresAt: expiresAtText, reviewerId, submissionId })
		return { expiresAt, ok: true }
	} catch (err) {
		// Only the unique violation means someone else holds it. Anything else is a real failure, and reporting it as a held claim would send the reviewer to a name that is not there.
		if (!isUniqueViolation(err)) throw err
		const held = await db.orm.public.ReviewClaim.where({ submissionId })
			.include("reviewer", reviewer => reviewer.select("displayName", "name"))
			.first()
		if (!held?.reviewer) throw new HttpError("CONFLICT", "Could not claim this submission")
		return {
			expiresAt: parseDbTimestamp(held.expiresAt),
			heldBy: held.reviewerId,
			// The claim conflict is shown on the queue, so it names them the way the queue does.
			heldByName: displayName(held.reviewer),
			ok: false,
		}
	}
}

export async function releaseClaim(submissionId: string, reviewerId: string): Promise<void> {
	const claim = await db.orm.public.ReviewClaim.where({ submissionId }).select("reviewerId").first()
	if (!claim) return
	if (claim.reviewerId !== reviewerId) throw new HttpError("FORBIDDEN", "That claim belongs to another reviewer")
	await db.orm.public.ReviewClaim.where({ submissionId }).deleteAndCount()
}

export function sweepExpiredClaims(): Promise<number> {
	return db.orm.public.ReviewClaim.where(claim => claim.expiresAt.lt(formatDbTimestamp(new Date()))).deleteAndCount()
}

// ─── Decisions ───────────────────────────────────────────────────────────────

/**
 * How long a maker is given to act on a return: a week, not the three days an admin grants by hand.
 *
 * A returned phase is a request for changes, so its maker has to open the project again, fix it and hand it in – and by the time a review lands late in a week that work may no longer fit before the close. The window is measured from the return rather than the week's own close, so an extension only bites when the scheduled close is sooner, and it never shortens a longer extension an admin already put on record.
 */
export const RETURN_EXTENSION_MS = 7 * DAY_MS

/** A returned phase's extension: at least a week from now, kept at whichever is later than what is already on record. */
export function returnExtensionUntil(current: Date | null | undefined, now: Date = new Date()): Date {
	return new Date(Math.max(now.getTime() + RETURN_EXTENSION_MS, current?.getTime() ?? 0))
}

/**
 * The column update that puts a week's extension on a project, from the project's own current value.
 *
 * The three paths that return work – a reviewer's return, an admin's un-approval and a reopen – all write the same later-of-the-two date, so a second return during the extension does not shorten it.
 */
function extensionUpdate(project: { submissionExtensionUntil: string | null }): { submissionExtensionUntil: string } {
	return {
		submissionExtensionUntil: formatDbTimestamp(
			returnExtensionUntil(parseNullableTimestamp(project.submissionExtensionUntil)),
		),
	}
}

export interface FinalizeInput {
	/** Ari's `review.justification.deflation_reason`: why fewer hours were approved than claimed. */
	deflationReason?: string | null
	/**
	 * Whether a reviewer's numbers may exceed what the maker asked for: more hours than the phase logged, or a tier above the one requested.
	 *
	 * Off by default because Ari's approved hours are the review platform's own decision and are meant to replace Half Life's computed total outright. The console's decision route turns it on for a reviewer without `MANAGE_CREDIT`, so a REVIEW_SUBMISSIONS holder cannot mint coins or parts money for another account by writing a number above the claim.
	 */
	enforceClaimCeiling?: boolean
	/** Shown to the participant. */
	feedback: string
	/**
	 * Whether a return grants its maker a week to act on it. Left on for a live decision; turned off by a backlog replay (`reconcileAriDecisions`), which applies a months-old return now and must not reopen weeks long after the fact.
	 */
	grantExtension?: boolean
	grantUsdOverride?: number | null
	/** Replaces the computed hours total outright. */
	hoursOverride?: number | null
	/** An approval's signed account in Fabricate's format, from the review screen (see lib/review-platform/justification). Null for Ari's decisions and for anything but an approval. */
	justification?: string | null
	/** Internal note, never shown to the submitter; kept on the review and in the audit row. */
	reason?: string | null
	result: ReviewResult
	reviewerEmail: string | null
	/** Null when the decision was made by Ari, not by a Half Life user. */
	reviewerId: string | null
	reviewerName: string | null
	submissionId: string
	/**
	 * Ari's `review.justification.technical_features`: the reviewer's own account of what the project has that accounts for the hours. Kept on the review so the Airtable mirror and its backfills can put it in `Justification - Specific Technical Features` without replaying the webhook.
	 */
	technicalFeatures?: string | null
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
	const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: input.submissionId })
		.include("claim")
		.include("themeProject", proj => proj.include("user", user => user.select("id", "printerGoalId")))
		.first()
	if (!submission?.themeProject?.user) throw new HttpError("NOT_FOUND", "Submission not found")

	// Nobody reviews their own work. Every account gets its own five themed projects at signup, reviewers included, so without this a REVIEWER could approve their own design, set their own tier, and mint their own credit – which is exactly what the role is not supposed to be able to do. Admins are not exempt: the point is a second pair of eyes, not a trust level.
	if (submission.themeProject.userId === input.reviewerId)
		throw new HttpError("FORBIDDEN", "You cannot review your own submission")

	if (submission.resolvedAt) throw new HttpError("ALREADY_RESOLVED", "This submission has already been decided")
	if (
		submission.claim
		&& submission.claim.reviewerId !== input.reviewerId
		&& parseDbTimestamp(submission.claim.expiresAt) > new Date()
	)
		throw new HttpError("CLAIMED_BY_OTHER", "Another reviewer holds the claim on this submission")

	const project = submission.themeProject
	const projectUser = project.user
	if (!projectUser) throw new HttpError("NOT_FOUND", "Submission not found")
	const { phase } = submission
	// A submission row is not the authority on whether a phase is awaiting review: a revert leaves the row open while the phase goes back to its maker , so a stale row stays decidable forever. Deciding it would approve work nobody handed in – or, as a rejection, claw back an approval that has already paid out, which is what unapprovePhase exists for and what this path must not do without OVERRIDE_DECISIONS.
	if (statusFor(project, phase) !== PhaseStatus.in_review)
		throw new HttpError("PHASE_LOCKED", "This phase is not awaiting a review")
	const approving = input.result === ReviewResult.APPROVED

	// A build cannot be approved before its design is. Submitting out of order is fine – see canSubmitPhase – but paying out of order is not. A warm-up project has no design to wait for: its one phase is whatever the form collected.
	if (
		approving
		&& phase === Phase.BUILD
		&& project.theme !== Theme.WARMUP
		&& project.designStatus !== PhaseStatus.approved
	)
		throw new HttpError("DESIGN_NOT_APPROVED", "Approve this project's design before approving the build")

	let { tier } = project
	if (approving && phase === Phase.DESIGN) {
		// The tier's dollars are parts money, so the decision lands here – before the participant starts building – not at build approval. A reviewer who did not name one leaves the maker's request standing; `tier` can hold a value written before any decision (imported rows do), so it is the last resort rather than the first.
		const chosen = input.tier ?? project.requestedTier ?? project.tier
		if (!isTierId(chosen)) throw new HttpError("VALIDATION_FAILED", "Assign a funding tier when approving a design")
		// A tier is parts money, and raising it raises the grant without touching the hours. A reviewer may lower or keep the maker's request, but only `MANAGE_CREDIT` may go above it. With no request on file the cap is Tier 1 – the entry tier, priced for a first project – rather than nothing at all, which is the hole this closes: the check is skipped only when there is no ceiling to apply, and there is always one. A project that already carries a tier (imported rows) keeps that as its ceiling, so a re-approval does not strand it below what it was given.
		const ceiling = project.requestedTier ?? project.tier ?? ENTRY_TIER.id
		if (input.enforceClaimCeiling && chosen > ceiling)
			throw new HttpError(
				"FORBIDDEN",
				"Raising the tier above what the maker requested requires the MANAGE_CREDIT permission",
			)
		tier = chosen
	}

	// Frozen before the snapshot read, so sessions created after it are not stamped as reviewed below.
	const snapshotAt = new Date()

	// The live Hackatime read is the one part of this that cannot happen inside the transaction: it is network I/O with a ten second timeout and two retries, so an interactive transaction would sit on a connection – and hold this maker's credit lock – for all of it. What it does is refresh the cache the decision then reads under the lock, so the number that ends up frozen is the fresh one.
	const live = await getHoursBreakdown(project.id, phase, { live: approving })
	// A reviewer (human or Ari) who supplied the hours explicitly has already covered the underpayment risk that a stale Hackatime reading creates, so staleness must not block a decision that does not depend on the live value.
	if (approving && (input.hoursOverride === null || input.hoursOverride === undefined) && live.hackatimeStale)
		// Refusing here is the point: stasis's client returns 0 on a Hackatime timeout and that zero flows into the grant row, silently underpaying someone with no trace.
		throw new HttpError(
			"HACKATIME_STALE",
			"Hackatime data could not be refreshed. Retry, or set an explicit hours override.",
		)

	// A declined grant defaults to nothing: the maker asked for no parts money, so approving the design must not mint one behind their back. An explicit reviewer override still wins – setting a number there is a deliberate choice, not an accident.
	let grantUsd =
		approving && phase === Phase.DESIGN && tier
			? (input.grantUsdOverride ?? (submission.fundingDeclined ? 0 : getTierOrThrow(tier).grantUsd))
			: project.grantUsd

	// The machine this participant is saving for is frozen alongside the tier for the pacing displays: it no longer sizes the payout, but the goal tracker still reads it to say what this week's work means for the goal. Someone who never chose one is paced against the default.
	const goal = printerById(projectUser.printerGoalId ?? DEFAULT_GOAL_ID)

	let tierDef = tier ? getTierOrThrow(tier) : null

	const nextStatus: PhaseStatus =
		input.result === ReviewResult.APPROVED
			? PhaseStatus.approved
			: input.result === ReviewResult.RETURNED
				? PhaseStatus.update_requested
				: PhaseStatus.rejected

	const outcome = await db.transaction(async tx => {
		// reconcileGrant reads a running sum and writes a delta against it, so it needs the same serialization the shop does.
		await lockUserCredit(tx, project.userId)

		// An approval is the payout those submissions earn, so a banned, suspended or flagged account is not paid – by Ari just as much as by a reviewer. Read inside the transaction, under the same lock every other payout takes, so a penalty written in the meantime is seen.
		if (approving) await assertPayoutAllowed(tx, project.userId)

		// Re-read inside the transaction: the review page may have been open for a while, and the participant may have withdrawn in the meantime.
		const fresh = await tx.orm.public.PhaseSubmission.whereUnique({ id: input.submissionId })
			.select("resolvedAt")
			.include("themeProject", owner => owner.select("buildStatus", "designStatus"))
			.first()
		if (!fresh) throw new HttpError("NOT_SUBMITTED", "This submission has been withdrawn")
		if (fresh.resolvedAt) throw new HttpError("ALREADY_RESOLVED", "Already decided")
		// Under the lock, where a revert, an un-approval or a reopen that commits between the read above and this write cannot slip past.
		if (!fresh.themeProject || statusFor(fresh.themeProject, phase) !== PhaseStatus.in_review)
			throw new HttpError("PHASE_LOCKED", "This phase is not awaiting a review")

		// Re-check the claim under the transaction too. The check before it ran against a read taken when the page opened, so another reviewer can have claimed the submission since; without this the decision would proceed and delete their live claim on the way out.
		const claim = await tx.orm.public.ReviewClaim.where({ submissionId: input.submissionId }).first()
		if (claim && claim.reviewerId !== input.reviewerId && parseDbTimestamp(claim.expiresAt) > new Date())
			throw new HttpError("CLAIMED_BY_OTHER", "Another reviewer holds the claim on this submission")

		// Re-check the design ordering under the same per-user lock the un-approve path takes. The check before the transaction ran against a read taken before the live Hackatime fetch; an admin can un-approve the design in that window, and a build approval must not pay out of order. Taking the lock first means this read sees either the un-approval (and refuses) or blocks it until this decision has committed.
		if (approving && phase === Phase.BUILD) {
			const design = await tx.orm.public.ThemeProject.whereUnique({ id: project.id })
				.select("designStatus", "theme")
				.first()
			if (design?.theme !== Theme.WARMUP && design?.designStatus !== PhaseStatus.approved)
				throw new HttpError("DESIGN_NOT_APPROVED", "Approve this project's design before approving the build")
		}

		// The hours, read under the lock rather than before it. The hours-approval route takes this same lock before it rewrites a session or a link, so a batch that rewrote them while this decision was waiting for Hackatime is already in this read, and one still waiting cannot commit until this decision has. The total the decision freezes is the total the rows hold at the moment it is made.
		const breakdown = await getHoursBreakdown(project.id, phase, { client: tx })
		// Hours are coins: one approved hour mints five of them, and the design tier's funded block is measured against the same number. A reviewer may cut the claimed total, but paying above what was logged is a credit decision – otherwise REVIEW_SUBMISSIONS quietly carries the authority MANAGE_CREDIT withholds, up to MAX_APPROVED_HOURS per phase plus the grant that tier buys.
		if (
			approving
			&& input.enforceClaimCeiling
			&& input.hoursOverride !== null
			&& input.hoursOverride !== undefined
			&& input.hoursOverride > breakdown.computedTotal
		)
			throw new HttpError("FORBIDDEN", "Approving more hours than were logged requires the MANAGE_CREDIT permission")
		const approvedHours = approving ? (input.hoursOverride ?? breakdown.computedTotal) : null

		// A tier's grant buys that tier's funded block of hours, so approved hours below the block step the tier down to the one they earn rather than paying a grant they cannot fund. Under every tier there is no parts grant at all. An explicit grant override is the reviewer's own number and is left alone, and the tier never steps up.
		if (
			approving
			&& phase === Phase.DESIGN
			&& tier
			&& (grantUsd ?? 0) > 0
			&& (input.grantUsdOverride === null || input.grantUsdOverride === undefined)
			&& (approvedHours ?? 0) < getTierOrThrow(tier).fundingHours
		) {
			const next = steppedTierForHours(tier, approvedHours ?? 0)
			if (next === null) grantUsd = 0
			else {
				const { grantUsd: nextGrant } = getTierOrThrow(next)
				tier = next
				grantUsd = nextGrant
			}
			tierDef = tier ? getTierOrThrow(tier) : null
		}

		// Both phases mint coins, by different rules. A design pays out only above the hours its grant bought – a declined grant (or a zero override) buys none, so every hour pays. A build has no funded block, so every hour pays. Either way every coin is spendable on anything.
		const fundedHours = (grantUsd ?? 0) > 0 && tier ? getTierOrThrow(tier).fundingHours : 0
		const coins: CoinSplit | null =
			approving && approvedHours !== null
				? phase === Phase.DESIGN
					? tier
						? designCoinsFor(tier, approvedHours, { fundedHours })
						: null
					: buildCoinsFor(approvedHours)
				: null

		if (approving)
			// Accept every unreviewed session at its claimed hours, so the per-session numbers stay consistent with the frozen total. Only sessions in the snapshot: one created after it was never counted in the frozen total.
			await tx.orm.public.WorkSession.where({
				deletedAt: null,
				phase,
				themeProjectId: project.id,
			})
				.where(session => session.hoursApproved.isNull())
				.where(session => session.createdAt.lt(formatDbTimestamp(snapshotAt)))
				.updateAll({ reviewedAt: formatDbTimestamp(new Date()), reviewedById: input.reviewerId })

		await tx.orm.public.SubmissionReview.create({
			deflationReason: input.deflationReason?.trim() || null,
			feedback: input.feedback,
			frozenApprovedHours: approvedHours,
			frozenBankedCoins: coins?.banked ?? null,
			frozenBankHours: goal.paceHours,
			frozenEntryCount: breakdown.journalEntryCount,
			// The funded block the payout was measured against, which is what makes the frozen coins reproducible. A declined grant buys no parts, so it leaves an empty block and every approved hour paid.
			frozenFundingHours: tierDef ? fundedHours : null,
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
			justification: approving ? (input.justification ?? null) : null,
			pass: ReviewPass.FINAL,
			reason: input.reason ?? null,
			result: input.result,
			// Who decided, as contact details rather than only an account link: Ari's reviewers hold no Half Life account, so `reviewerId` is null for every Ari decision and the email is the only attribution the leaderboard has. Console reviewers carry both.
			reviewerEmail: input.reviewerEmail,
			reviewerId: input.reviewerId,
			reviewerName: input.reviewerName,
			submissionId: input.submissionId,
			technicalFeatures: input.technicalFeatures ?? null,
			tierOverride: input.tier ?? null,
		})

		await tx.orm.public.PhaseSubmission.where({ id: input.submissionId }).update({
			resolvedAt: formatDbTimestamp(new Date()),
			resolvedResult: input.result,
		})

		const nowText = formatDbTimestamp(new Date())
		const projectUpdate: {
			designReviewComments?: string
			designReviewedAt?: string
			designReviewedById?: string | null
			designStatus?: PhaseStatus
			designApprovedHours?: number | null
			designApprovedHoursAt?: string
			designBankedCoins?: number | null
			designSpendableCoins?: number | null
			grantEmittedAt?: string
			grantUsd?: number | null
			tier?: number | null
			buildReviewComments?: string
			buildReviewedAt?: string
			buildReviewedById?: string | null
			buildStatus?: PhaseStatus
			approvedHours?: number | null
			approvedHoursAt?: string
			buildCoins?: number | null
			submissionExtensionUntil?: string
		} = {
			...(phase === Phase.DESIGN
				? {
						designReviewComments: input.feedback,
						designReviewedAt: nowText,
						designReviewedById: input.reviewerId,
						designStatus: nextStatus,
						...(approving
							? {
									designApprovedHours: approvedHours,
									designApprovedHoursAt: nowText,
									designBankedCoins: coins?.banked ?? null,
									designSpendableCoins: coins?.spendable ?? null,
									grantEmittedAt: nowText,
									grantUsd,
									tier,
								}
							: {}),
					}
				: {
						buildReviewComments: input.feedback,
						buildReviewedAt: nowText,
						buildReviewedById: input.reviewerId,
						buildStatus: nextStatus,
						...(approving
							? {
									approvedHours,
									approvedHoursAt: nowText,
									// Spendable only: the banked half is reconciled through the ledger's BUILD_BANKED_HOURS rows, not this display field.
									buildCoins: coins?.spendable ?? null,
								}
							: {}),
					}),
			// A return is the one state a maker is expected to act on, so it carries the time to act: a week from the return, on the project rather than the account, so only this project's week reopens. A backlog replay turns this off with the notice it also skips.
			...(input.result === ReviewResult.RETURNED && input.grantExtension !== false ? extensionUpdate(project) : {}),
		}

		await tx.orm.public.ThemeProject.where({ id: project.id }).update(projectUpdate)

		// Credit is reconciled to a target rather than appended, so approving the same build five times converges instead of compounding.
		if (phase === Phase.DESIGN) {
			// The legacy locked half and the spendable half are separate kinds, so an un-approval can zero each one independently and neither has to work out which share of a combined number was its own. New approvals always target zero for the locked half – every coin is spendable now – which also migrates an old approval to the single pot the next time it is re-decided, with no change to its total.
			await reconcileGrant(tx, {
				bucket: CoinBucket.BANKED,
				createdById: input.reviewerId,
				kind: LedgerKind.DESIGN_BANKED_HOURS,
				note:
					approving && tierDef
						? fundedHours === 0
							? `${approvedHours}h approved with no parts grant: every hour pays, ${coins?.spendable ?? 0} coins spendable`
							: `${approvedHours}h approved: ${fundedHours}h funded at $${tierDef.grantUsd}, ${coins?.spendable ?? 0} coins spendable`
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
						? fundedHours === 0
							? "Every approved hour, spendable on anything (no parts grant)"
							: `Hours beyond Tier ${tier}'s ${fundedHours}h funded, spendable on anything`
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
				// The maker reads this note in their coin history, so it names the week the way they see it.
				note: `${themeLabel(project.theme)} shipped`,
				// Season themes only: warm-up projects are pre-season practice, not a shipped theme, and paying the completion bonus on them mints 25 coins per warm-up hand-in.
				target: approving && project.theme !== Theme.WARMUP ? THEME_COMPLETION_BONUS : 0,
				themeProjectId: project.id,
				userId: project.userId,
			})
		}

		await tx.orm.public.ReviewClaim.where({ submissionId: input.submissionId }).deleteAndCount()

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
				status: statusFor(project, phase),
				tier: project.tier,
			},
			phase,
			submissionId: input.submissionId,
		},
		targetId: project.id,
		targetType: "ThemeProject",
	})

	// A design approval is what a kept build approval was waiting for. The design has committed, so this runs after it and cannot undo it.
	if (approving && phase === Phase.DESIGN)
		await applyDeferredBuildApproval(project.id).catch(err =>
			console.error(`[review] deferred build approval for ${project.id} failed:`, err),
		)

	return outcome
}

/** Whether a build approval was refused only because its design is not approved yet. */
export function isDesignNotApproved(err: unknown): boolean {
	return err instanceof HttpError && err.code === "DESIGN_NOT_APPROVED"
}

/** What a kept decision holds: the decision as finalized, and what publishing it needs. */
interface DeferredDecision {
	input: FinalizeInput
	published: PublishedDecision
}

/** Checks the shape a kept decision was written in. Its fields are only as sound as the writer that stored them. */
function isDeferredDecision(value: unknown): value is DeferredDecision {
	return isRecord(value) && isRecord(value.input) && isRecord(value.published)
}

/**
 * Keep a build approval the reviewer made before its design was approved, to be applied once the design is.
 *
 * Only the state checks a decision makes now are repeated here; the rest is checked when it is applied. Replaces an earlier kept decision for the same hand-in.
 */
export async function deferBuildApproval(input: FinalizeInput, published: PublishedDecision): Promise<void> {
	const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: input.submissionId })
		.include("themeProject", proj => proj.include("user", user => user.select("id")))
		.first()
	const project = submission?.themeProject
	if (!submission || !project?.user) throw new HttpError("NOT_FOUND", "Submission not found")
	if (submission.phase !== Phase.BUILD)
		throw new HttpError("VALIDATION_FAILED", "Only a build approval can wait for its design")
	if (project.userId === input.reviewerId) throw new HttpError("FORBIDDEN", "You cannot review your own submission")
	if (submission.resolvedAt) throw new HttpError("ALREADY_RESOLVED", "This submission has already been decided")
	if (statusFor(project, Phase.BUILD) !== PhaseStatus.in_review)
		throw new HttpError("PHASE_LOCKED", "This phase is not awaiting a review")

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every field is plain JSON (strings, numbers, booleans, null), and the reader checks the shape again
	const decision = structuredClone({ input, published }) as unknown as JsonObject
	await db.transaction(async tx => {
		await tx.orm.public.DeferredBuildApproval.where({ submissionId: input.submissionId }).deleteAndCount()
		await tx.orm.public.DeferredBuildApproval.create({
			decision,
			submissionId: input.submissionId,
		})
	})
	await logAudit({
		action: AuditAction.REVIEW_APPROVE,
		actorEmail: input.reviewerEmail,
		actorId: input.reviewerId,
		metadata: { deferred: true, phase: Phase.BUILD },
		targetId: project.id,
		targetType: "ThemeProject",
	})
}

/**
 * Apply the build approval kept for a project, if there is one, now that its design is approved.
 *
 * A kept decision is removed once it applies, or once a refusal says it never will (the hand-in is gone or decided). A claim another reviewer holds keeps it for the next design approval, and so does a failure that is not a refusal.
 */
async function applyDeferredBuildApproval(themeProjectId: string): Promise<void> {
	const build = await db.orm.public.PhaseSubmission.where({ phase: Phase.BUILD, resolvedAt: null, themeProjectId })
		.orderBy(sub => sub.createdAt.desc())
		.include("deferredApproval")
		.first()
	const kept = build?.deferredApproval
	if (!build || !kept) return
	if (!isDeferredDecision(kept.decision)) {
		console.error(`[review] deferred build approval ${kept.id} is not readable; removing it`)
		await db.orm.public.DeferredBuildApproval.where({ id: kept.id }).deleteAndCount()
		return
	}
	const { input, published } = kept.decision
	let outcome: FinalizeOutcome
	try {
		outcome = await finalizeReview({ ...input, submissionId: build.id })
	} catch (err) {
		if (err instanceof HttpError && err.code === "CLAIMED_BY_OTHER") return
		if (err instanceof HttpError) await db.orm.public.DeferredBuildApproval.where({ id: kept.id }).deleteAndCount()
		throw err
	}
	await db.orm.public.DeferredBuildApproval.where({ id: kept.id }).deleteAndCount()
	await publishReviewDecision(outcome, published)
}

/**
 * Reverse an approval.
 *
 * Because credit is reconciled to a target, undoing is the same call with `target: 0` – there is no separate reversal code path, so there is no separate reversal code path to get wrong.
 *
 * The reversal takes what the maker still has, and only that. A grant they have already spent cannot be taken back, and a negative balance is a state the shop, the admin adjustment route and every display refuse to create – so the pot stops at zero, the row's own note says how much could not be taken, and the audit row says the same. The alternative, refusing the un-approval, would leave a wrongly approved design standing with its grant and its tier, which is the thing this exists to undo.
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
	const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId }).first()
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	const status = statusFor(project, phase)
	if (status !== PhaseStatus.approved) throw new HttpError("CONFLICT", "That phase is not approved")

	const { unrecovered } = await db.transaction(async tx => {
		await lockUserCredit(tx, project.userId)

		// Re-read under the lock: the fast check above ran against a read taken before it, and a decision or re-approval can have committed since.
		const fresh = await tx.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
			.select("buildStatus", "designStatus")
			.first()
		if (!fresh || statusFor(fresh, phase) !== PhaseStatus.approved)
			throw new HttpError("CONFLICT", "That phase is no longer approved")

		// A build is only approved, and only paid, on top of an approved design. Un-approving the design under a build that is still in review or approved would leave that build for an un-approved design, so the build has to be taken back first.
		if (
			phase === Phase.DESIGN
			&& (fresh.buildStatus === PhaseStatus.approved || fresh.buildStatus === PhaseStatus.in_review)
		)
			throw new HttpError("CONFLICT", "Take the build back before un-approving the design")

		// A grant send holds no credit lock while HCB is called, so a design un-approval must not race it: the money would be sent for an approval that no longer stands, and the sent row would block a later send. `sendGrant` marks the row errored before it throws, which is what lets this same check pass on the retry after the window.
		if (phase === Phase.DESIGN) {
			const inFlight = await tx.orm.public.HcbGrantTopUp.where({
				error: null,
				phase: Phase.DESIGN,
				sentAt: null,
				themeProjectId,
				userId: project.userId,
			})
				.where(topUp => topUp.createdAt.gt(formatDbTimestamp(new Date(Date.now() - ABANDONED_ATTEMPT_MS))))
				.select("id")
				.first()
			if (inFlight)
				throw new HttpError(
					"CONFLICT",
					"A grant send is in flight for this design. Wait for it to finish before un-approving",
				)

			// A card grant is money that has already moved. Un-approving the design would leave the maker funded for work
			// that no longer stands, so the refund has to be a deliberate cancellation first.
			const cardGrant = await tx.orm.public.HcbGrantCard.where({
				phase: Phase.DESIGN,
				themeProjectId,
			})
				.where(card => card.status.in([HcbGrantCardStatus.ISSUED, HcbGrantCardStatus.AMBIGUOUS]))
				.select("id")
				.first()
			if (cardGrant)
				throw new HttpError(
					"CONFLICT",
					"A card grant has already been issued for this design. Cancel it on the Grant cards page before un-approving",
				)

			// A sent top-up is money that has moved, and a live CSV row is a card the org may already have created from
			// the file. Either would leave the maker funded for a design that no longer stands.
			// Either mark, for the same reason the card batch reads both: a payment HCB answered for is money that moved, even if marking it sent failed afterwards.
			const paidTopUp = await tx.orm.public.HcbGrantTopUp.where({ phase: Phase.DESIGN, themeProjectId })
				.where(topUp => or(topUp.sentAt.isNotNull(), topUp.transactionId.isNotNull()))
				.select("id")
				.first()
			if (paidTopUp)
				throw new HttpError(
					"CONFLICT",
					"A top-up has already been sent for this design. Un-approving it would leave the maker paid for work that no longer stands",
				)

			const liveExport = await tx.orm.public.HcbCardGrantExportRow.where({ themeProjectId })
				.where(row => row.supersededAt.isNull())
				.select("id")
				.first()
			if (liveExport)
				throw new HttpError(
					"CONFLICT",
					"This design is in a live HCB CSV export. Supersede that row on the Grant cards page before un-approving",
				)
		}

		await tx.orm.public.SubmissionReview.where({ invalidated: false })
			.where(review =>
				review.submission.some(submission =>
					and(submission.phase.eq(phase), submission.themeProjectId.eq(themeProjectId)),
				),
			)
			.updateAll({ invalidated: true, invalidatedAt: formatDbTimestamp(new Date()) })

		await tx.orm.public.ThemeProject.where({ id: themeProjectId }).update({
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
			...(options.grantExtension ? extensionUpdate(project) : {}),
		})

		// Each reversal reports what it could not take back, so the audit row can say how much of the grant the maker had already spent. The number is in the ledger row's own note as well.
		let unrecoveredCoins = 0

		if (phase === Phase.DESIGN) {
			// Includes the banked half. Forced savings are still savings someone was credited for work that is no longer approved, so they unwind too – otherwise un-approving a design leaves free printer money behind.
			unrecoveredCoins += (
				await reconcileGrant(tx, {
					bucket: CoinBucket.BANKED,
					createdById: adminId,
					kind: LedgerKind.DESIGN_BANKED_HOURS,
					note: `Design un-approved: ${reason}`,
					target: 0,
					themeProjectId,
					userId: project.userId,
				})
			).unrecovered
			unrecoveredCoins += (
				await reconcileGrant(tx, {
					createdById: adminId,
					kind: LedgerKind.DESIGN_EXCESS_HOURS,
					note: `Design un-approved: ${reason}`,
					target: 0,
					themeProjectId,
					userId: project.userId,
				})
			).unrecovered
		}

		if (phase === Phase.BUILD) {
			// The banked half unwinds too, for the same reason the design's does: forced savings are still savings credited for work no longer approved.
			unrecoveredCoins += (
				await reconcileGrant(tx, {
					bucket: CoinBucket.BANKED,
					createdById: adminId,
					kind: LedgerKind.BUILD_BANKED_HOURS,
					note: `Build un-approved: ${reason}`,
					target: 0,
					themeProjectId,
					userId: project.userId,
				})
			).unrecovered
			unrecoveredCoins += (
				await reconcileGrant(tx, {
					createdById: adminId,
					kind: LedgerKind.BUILD_HOURS,
					note: `Build un-approved: ${reason}`,
					target: 0,
					themeProjectId,
					userId: project.userId,
				})
			).unrecovered
			unrecoveredCoins += (
				await reconcileGrant(tx, {
					createdById: adminId,
					kind: LedgerKind.THEME_COMPLETION_BONUS,
					note: `Build un-approved: ${reason}`,
					target: 0,
					themeProjectId,
					userId: project.userId,
				})
			).unrecovered
		}

		return { unrecovered: unrecoveredCoins }
	})

	await logAudit({
		action: AuditAction.ADMIN_UNAPPROVE_PHASE,
		actorEmail: adminEmail,
		actorId: adminId,
		metadata: {
			before: { status: PhaseStatus.approved },
			phase,
			reason,
			// What the reversal could not take back, because the maker had already spent it. Zero in the ordinary case; a number here is the programme carrying a grant that was withdrawn too late.
			unrecoveredCoins: unrecovered,
		},
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
	const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId }).first()
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	const status = statusFor(project, phase)
	if (status !== PhaseStatus.rejected) throw new HttpError("CONFLICT", "That phase is not rejected")

	// Conditional on the status that was read: an admin double-click, or a reopen racing a resubmission, must not overwrite a newer state.
	const reopened = await db.orm.public.ThemeProject.where({ id: themeProjectId })
		.where(row =>
			phase === Phase.DESIGN ? row.designStatus.eq(PhaseStatus.rejected) : row.buildStatus.eq(PhaseStatus.rejected),
		)
		.updateAndCount({
			...(phase === Phase.DESIGN
				? { designReviewComments: reason, designStatus: PhaseStatus.update_requested }
				: { buildReviewComments: reason, buildStatus: PhaseStatus.update_requested }),
			...(options.grantExtension ? extensionUpdate(project) : {}),
		})
	if (reopened !== 1) throw new HttpError("CONFLICT", "That phase moved while it was being reopened")

	await logAudit({
		action: AuditAction.ADMIN_REOPEN_PHASE,
		actorEmail: adminEmail,
		actorId: adminId,
		metadata: { phase, reason },
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})
}

const STATUS_FOR_RESULT: { readonly [_ in ReviewResult]: PhaseStatus } = Object.freeze({
	[ReviewResult.APPROVED]: PhaseStatus.approved,
	[ReviewResult.REJECTED]: PhaseStatus.rejected,
	[ReviewResult.RETURNED]: PhaseStatus.update_requested,
})

/**
 * Put a ship a reviewer just decided back into review, claimed by them, so they can change the decision.
 *
 * Ari's requeue on a reviewer's own say-so: an approval or rejection is unwound by `unapprovePhase`/`reopenPhase` (with their guards on money that has already moved), then the decision is invalidated and the phase goes back to `in_review`. Only the reviewer's own standing decision on the latest hand-in, while the phase still holds it, and not once T2 has sent it on. The maker has already been told; deciding again tells them again.
 */
export async function takeBackDecision(
	submissionId: string,
	reviewer: { email: string | null; id: string },
): Promise<{ feedback: string; phase: Phase; themeProjectId: string }> {
	const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: submissionId })
		.include("reviews", reviews => reviews.where({ invalidated: false }).orderBy(review => review.createdAt.desc()))
		.include("themeProject", project => project.select("buildStatus", "designStatus", "id"))
		.first()
	if (!submission?.themeProject) throw new HttpError("NOT_FOUND", "Submission not found")
	const { phase, themeProjectId } = submission
	const [standing] = submission.reviews
	if (!submission.resolvedAt || !submission.resolvedResult || !standing)
		throw new HttpError("CONFLICT", "This ship has no decision to take back")
	if (standing.reviewerId !== reviewer.id)
		throw new HttpError("FORBIDDEN", "Only the reviewer who decided can take it back")
	if (standing.unifiedApprovedAt) throw new HttpError("CONFLICT", "This approval has already been sent on at T2")
	const expected = STATUS_FOR_RESULT[submission.resolvedResult]
	if (statusFor(submission.themeProject, phase) !== expected)
		throw new HttpError("CONFLICT", "The project has moved on since this decision")
	const latest = await db.orm.public.PhaseSubmission.where({ phase, themeProjectId })
		.orderBy(row => row.createdAt.desc())
		.select("id")
		.first()
	if (latest?.id !== submissionId) throw new HttpError("CONFLICT", "The maker has handed in again since this decision")

	const reason = "Taken back by its reviewer"
	if (expected === PhaseStatus.approved)
		await unapprovePhase(themeProjectId, phase, reviewer.id, reviewer.email, reason)
	else if (expected === PhaseStatus.rejected)
		await reopenPhase(themeProjectId, phase, reviewer.id, reviewer.email, reason)

	const nowText = formatDbTimestamp(new Date())
	await db.transaction(async tx => {
		// Conditional on the state the steps above leave, so a resubmission or an override in between is not overwritten.
		const moved = await tx.orm.public.ThemeProject.where({ id: themeProjectId })
			.where(row =>
				phase === Phase.DESIGN
					? row.designStatus.eq(PhaseStatus.update_requested)
					: row.buildStatus.eq(PhaseStatus.update_requested),
			)
			.updateAndCount(phaseStatusUpdate(phase, PhaseStatus.in_review))
		if (moved !== 1) throw new HttpError("CONFLICT", "The project moved while the decision was being taken back")
		await tx.orm.public.SubmissionReview.where({ invalidated: false, submissionId }).updateAll({
			invalidated: true,
			invalidatedAt: nowText,
		})
		await tx.orm.public.PhaseSubmission.where({ id: submissionId }).update({ resolvedAt: null, resolvedResult: null })
	})

	await logAudit({
		action: AuditAction.ADMIN_REOPEN_PHASE,
		actorEmail: reviewer.email,
		actorId: reviewer.id,
		metadata: { phase, reason, submissionId, takenBack: submission.resolvedResult },
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})

	await claimSubmission(submissionId, reviewer.id)
	return { feedback: standing.feedback, phase, themeProjectId }
}

export interface HoursAdjustment {
	comments: string | null
	hoursApproved: number
	id: string
}

/**
 * Change what journal entries count as on an approval that already stands, and re-pay it at the new total.
 *
 * The decision stays and the maker is not messaged; only the frozen hours, the coins and the ledger move, reconciled to the new target the same way an approval is, so nothing is paid twice. Open to the approval's own reviewer until T2 sends it on, and not to an approval whose total was set by an hours override, which deflation does not reach. A design whose grant buys more hours than the new total is refused, as `finalizeReview` refuses it.
 */
export async function adjustApprovedHours(
	submissionId: string,
	reviewer: { email: string | null; id: string },
	adjustments: readonly HoursAdjustment[],
	options: { canExceedClaim: boolean },
): Promise<{ approvedHours: number; phase: Phase; themeProjectId: string; unrecovered: number }> {
	const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: submissionId })
		.include("reviews", reviews => reviews.where({ invalidated: false }).orderBy(review => review.createdAt.desc()))
		.include("themeProject", owner => owner.select("buildStatus", "designStatus", "id", "userId"))
		.first()
	const project = submission?.themeProject
	if (!submission || !project) throw new HttpError("NOT_FOUND", "Submission not found")
	if (project.userId === reviewer.id) throw new HttpError("FORBIDDEN", "You cannot approve hours on your own work")
	const { phase, themeProjectId } = submission
	const [standing] = submission.reviews
	if (submission.resolvedResult !== ReviewResult.APPROVED || standing?.result !== ReviewResult.APPROVED)
		throw new HttpError("CONFLICT", "Only an approval's hours can be adjusted")
	if (standing.reviewerId !== reviewer.id)
		throw new HttpError("FORBIDDEN", "Only the reviewer who approved can adjust its hours")
	if (standing.unifiedApprovedAt) throw new HttpError("CONFLICT", "This approval has already been sent on at T2")
	if (standing.hoursOverride !== null)
		throw new HttpError(
			"CONFLICT",
			"This approval set its hours by override, so deflation doesn't change it. Take the decision back instead",
		)
	const latest = await db.orm.public.PhaseSubmission.where({ phase, themeProjectId })
		.orderBy(row => row.createdAt.desc())
		.select("id")
		.first()
	if (latest?.id !== submissionId) throw new HttpError("CONFLICT", "The maker has handed in again since this approval")

	const ids = adjustments.map(adjustment => adjustment.id)
	const nowText = formatDbTimestamp(new Date())
	const result = await db.transaction(async tx => {
		await lockUserCredit(tx, project.userId)

		// Under the lock: an un-approval, a take-back or T2 that committed since the read above must win.
		const fresh = await tx.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
			.select("buildStatus", "designStatus")
			.first()
		if (!fresh || statusFor(fresh, phase) !== PhaseStatus.approved)
			throw new HttpError("CONFLICT", "This phase is no longer approved")
		const review = await tx.orm.public.SubmissionReview.whereUnique({ id: standing.id }).first()
		if (!review || review.invalidated || review.unifiedApprovedAt)
			throw new HttpError("CONFLICT", "This approval has changed since the page loaded")

		const sessions = await tx.orm.public.WorkSession.where({ deletedAt: null, phase, themeProjectId })
			.where(session => session.id.in(ids))
			.select("hoursApproved", "hoursClaimed", "id")
			.all()
		if (sessions.length !== new Set(ids).size) throw new HttpError("NOT_FOUND", "One of those entries no longer exists")
		// The same ceiling the hours route draws: cutting or restating is a reviewer's call, paying above the claim is MANAGE_CREDIT's.
		if (!options.canExceedClaim) {
			const ceilings = new Map(sessions.map(row => [row.id, Math.max(row.hoursClaimed, row.hoursApproved ?? 0)]))
			if (adjustments.some(adjustment => adjustment.hoursApproved > (ceilings.get(adjustment.id) ?? 0)))
				throw new HttpError("FORBIDDEN", "Approving more hours than were logged requires the MANAGE_CREDIT permission")
		}
		for (const adjustment of adjustments)
			await tx.orm.public.WorkSession.where({ id: adjustment.id }).update({
				hoursApproved: adjustment.hoursApproved,
				reviewComments: adjustment.comments,
				reviewedAt: nowText,
				reviewedById: reviewer.id,
			})

		const breakdown = await getHoursBreakdown(themeProjectId, phase, { client: tx })
		const approvedHours = breakdown.computedTotal
		let coins: CoinSplit
		if (phase === Phase.DESIGN) {
			const tier = review.frozenTier
			if (!tier || !isTierId(tier)) throw new HttpError("CONFLICT", "This approval has no tier to pay against")
			// The block the approval was measured against. Without it there is no way to tell which hours the grant already bought, and guessing pays them twice.
			if (review.frozenFundingHours === null)
				throw new HttpError("CONFLICT", "This approval doesn't record its funded hours. Take the decision back instead")
			const fundedHours = review.frozenFundingHours
			if (fundedHours > 0 && approvedHours < fundedHours)
				throw new HttpError(
					"VALIDATION_FAILED",
					`Tier ${tier}'s grant funds ${fundedHours} hours and this would approve ${approvedHours}h. Take the decision back to change the tier`,
				)
			coins = designCoinsFor(tier, approvedHours, { fundedHours })
		} else coins = buildCoinsFor(approvedHours)

		await tx.orm.public.SubmissionReview.where({ id: review.id }).update({
			frozenApprovedHours: approvedHours,
			frozenBankedCoins: coins.banked,
			frozenEntryCount: breakdown.journalEntryCount,
			frozenHackatimeHours: breakdown.hackatimeHours,
			frozenJournalHours: breakdown.journalHours,
			frozenSpendableCoins: coins.spendable,
			frozenTimelapseSeconds: breakdown.timelapseSeconds,
		})
		await tx.orm.public.ThemeProject.where({ id: themeProjectId }).update(
			phase === Phase.DESIGN
				? {
						designApprovedHours: approvedHours,
						designBankedCoins: coins.banked,
						designSpendableCoins: coins.spendable,
					}
				: { approvedHours, buildCoins: coins.spendable },
		)

		const note = `Hours adjusted after approval: ${approvedHours}h`
		const [bankedKind, spendableKind] =
			phase === Phase.DESIGN
				? [LedgerKind.DESIGN_BANKED_HOURS, LedgerKind.DESIGN_EXCESS_HOURS]
				: [LedgerKind.BUILD_BANKED_HOURS, LedgerKind.BUILD_HOURS]
		const banked = await reconcileGrant(tx, {
			bucket: CoinBucket.BANKED,
			createdById: reviewer.id,
			kind: bankedKind,
			note,
			target: coins.banked,
			themeProjectId,
			userId: project.userId,
		})
		const spendable = await reconcileGrant(tx, {
			createdById: reviewer.id,
			kind: spendableKind,
			note,
			target: coins.spendable,
			themeProjectId,
			userId: project.userId,
		})
		await ensurePrinterAward(tx, project.userId)

		return {
			approvedHours,
			before: review.frozenApprovedHours,
			unrecovered: banked.unrecovered + spendable.unrecovered,
		}
	})

	await logAudit({
		action: AuditAction.REVIEW_APPROVE_HOURS,
		actorEmail: reviewer.email,
		actorId: reviewer.id,
		metadata: {
			adjustedAfterApproval: true,
			after: result.approvedHours,
			before: result.before,
			entries: ids,
			phase,
			submissionId,
			unrecoveredCoins: result.unrecovered,
		},
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})

	return { approvedHours: result.approvedHours, phase, themeProjectId, unrecovered: result.unrecovered }
}
