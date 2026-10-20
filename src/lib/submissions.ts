import "server-only"
import type { PhaseSubmission, ProgramSettings, ThemeProject } from "@/app/generated/prisma/client"
import { Phase, PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import { partsFundingFor } from "@/lib/bom"
import { submitFloorFor } from "@/lib/config/printers"
import { MIN_PROJECT_DESCRIPTION_CHARS, scheduledWeekFor } from "@/lib/config/program"
import { ENTRY_TIER, getTierOrThrow } from "@/lib/config/tiers"
import { lockUserCredit } from "@/lib/currency"
import { HttpError } from "@/lib/errors"
import { getHoursBreakdown } from "@/lib/hours"
import { round2 } from "@/lib/money"
import prisma from "@/lib/prisma"
import {
	assertWeekStarted,
	effectiveDateFor,
	getProgramSettings,
	getSubmissionAccess,
	SUBMISSIONS_CLOSED_MESSAGE,
	weekNumberForDate,
} from "@/lib/program"
import { assertNoOwedReel } from "@/lib/reel-gate"
import { checkRepo } from "@/lib/repo-checks"
import { isOwnedKey } from "@/lib/uploads/r2"
import { warmupPhaseOf } from "@/lib/warmup"

export function statusFor(project: ThemeProject, phase: Phase): PhaseStatus {
	return phase === Phase.DESIGN ? project.designStatus : project.buildStatus
}

/**
 * Whether a phase can be submitted right now.
 *
 * Build may be submitted once design has been submitted at least once – not once design has been *approved*. With five concurrent themes sharing one review queue, gating on approval turns a reviewer-capacity problem into a participant-blocked problem: someone would sit idle through their build week waiting on a queue. The finalize path does require design approved before a build can be approved, so the ordering invariant holds where money is involved and not where it only costs people time.
 */
export function canSubmitPhase(
	project: ThemeProject,
	phase: Phase,
): { ok: true } | { ok: false; code: "ALREADY_SUBMITTED" | "PHASE_LOCKED"; message: string } {
	// A warm-up is one submission, as the phase it was made for: a design asking for funding, or a finished build. Never the other, never both.
	if (project.theme === Theme.WARMUP && phase !== warmupPhaseOf(project))
		return {
			code: "PHASE_LOCKED",
			message:
				warmupPhaseOf(project) === Phase.DESIGN
					? "This warm-up project is submitted as a design"
					: "This warm-up project is submitted as a finished build",
			ok: false,
		}

	const status = statusFor(project, phase)
	if (status === PhaseStatus.in_review)
		return { code: "ALREADY_SUBMITTED", message: "This phase is already in review", ok: false }

	if (status === PhaseStatus.approved)
		return { code: "PHASE_LOCKED", message: "This phase is already approved", ok: false }

	if (status === PhaseStatus.rejected)
		return {
			code: "PHASE_LOCKED",
			message: "This phase was rejected. Ask an admin to reopen it.",
			ok: false,
		}

	// A warm-up project is one phase by nature – it was handed in through the pre-season form, not designed and then built – so the design-first rule does not apply to it.
	if (phase === Phase.BUILD && project.theme !== Theme.WARMUP && project.designStatus === PhaseStatus.draft)
		return {
			code: "PHASE_LOCKED",
			message: "Submit your design for this theme before submitting the build",
			ok: false,
		}

	return { ok: true }
}

/**
 * The same decision `getSubmissionAccess` makes, taken from columns read on the transaction client. `getProgramSettings` caches the settings row for the request, so only a read on `tx` sees a submissions toggle that commits between the route's pre-check and the write.
 */
function accessOpenOnClient(
	settings: Pick<ProgramSettings, "submissionsOpen" | "submissionsCloseAt"> | null,
	userExtension: Date | null | undefined,
	projectExtension: Date | null | undefined,
	now: Date,
): boolean {
	if (!settings) return false
	if (settings.submissionsOpen && (!settings.submissionsCloseAt || settings.submissionsCloseAt > now)) return true
	if (userExtension && userExtension > now) return true
	if (projectExtension && projectExtension > now) return true
	return false
}

export async function submitPhase(
	userId: string,
	themeProjectId: string,
	phase: Phase,
	notes: string | null,
	attachmentKeys: string[] = [],
	partialFundingAccepted = false,
	fundingDeclined = false,
): Promise<PhaseSubmission> {
	const project = await prisma.themeProject.findFirst({
		where: { deletedAt: null, id: themeProjectId, userId },
	})
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	const access = await getSubmissionAccess(userId, themeProjectId)
	if (!access.open) throw new HttpError("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
	await assertWeekStarted(scheduledWeekFor(project.theme, phase))

	const eligible = canSubmitPhase(project, phase)
	if (!eligible.ok) throw new HttpError(eligible.code, eligible.message)

	// The Ari SDK refuses a ship without a description. Week one's onboarding lets the maker leave it blank (the project form for other weeks does not), so a blank description used to pass submit and then fail the Ari send silently in the `after` hook – the maker saw success and no reviewer ever saw the project. Enforce it here, beside the hours check, so the refusal reaches the person who can fix it. `buildShipInput` keeps a fallback too, so hand-ins already stuck in this state can still be replayed by `ari-retry`.
	//
	// The floor is the same 100 characters the project page and submit sheet show: a description that only repeats the title gives a reviewer nothing to decide against.
	const descriptionLength = project.description?.trim().length ?? 0
	if (descriptionLength < MIN_PROJECT_DESCRIPTION_CHARS)
		throw new HttpError(
			"UNPROCESSABLE",
			`Write at least ${MIN_PROJECT_DESCRIPTION_CHARS} characters about your project before submitting this phase (you have ${descriptionLength})`,
		)

	if (!project.coverImageKey)
		throw new HttpError(
			"UNPROCESSABLE",
			"Upload a photo or screenshot of the project as its cover before submitting this phase",
		)

	// Handing a week in is a checkpoint too; a deleted reel still owed holds it.
	await assertNoOwedReel(userId)

	// A submission must not be able to file someone else's evidence as its own. Refuse rather than filter: silently dropping a stranger's key hands back a success with the evidence missing, which the maker only finds out at review.
	const foreign = attachmentKeys.filter(key => !isOwnedKey(userId, key))
	if (foreign.length > 0) throw new HttpError("VALIDATION_FAILED", "Those uploads are not yours")

	const breakdown = await getHoursBreakdown(themeProjectId, phase)
	if (breakdown.journalEntryCount === 0 && breakdown.hackatimeHours === 0)
		throw new HttpError("UNPROCESSABLE", "Log at least one work session before submitting this phase")

	// A tier's funded block is the floor a design week is handed in on, and until now that floor lived only in the
	// submit sheet. It is the gate the tier promises: a tier-3 request funds twenty hours and a hundred dollars of
	// parts, so it cannot be handed in on an hour of work. The client refuses a tier below its floor; this is the
	// same rule held by the server, so a request that bypasses the sheet cannot buy a grant with less work than the
	// grant is for.
	if (phase === Phase.DESIGN) {
		const tierId = project.tier ?? project.requestedTier ?? ENTRY_TIER.id
		const floor = submitFloorFor(getTierOrThrow(tierId).fundingHours)
		if (breakdown.effectiveHours < floor)
			throw new HttpError(
				"UNPROCESSABLE",
				`Tier ${tierId} needs ${floor}h of design time to hand in and you have logged ${round2(breakdown.effectiveHours)}h. Pick a tier you have earned.`,
			)
	}

	// An account under review is stopped here. Identity verification is not: it is asked of the shop instead (see lib/shop), so a maker can explore, journal and hand work in without having verified, and meets it only when they try to spend.
	const user = await prisma.user.findUnique({
		select: { fraudFlagged: true },
		where: { id: userId },
	})
	if (user?.fraudFlagged) throw new HttpError("FORBIDDEN", "Your account is under review. Reach out in Slack.")

	// The repo checks, run here rather than trusted from the sheet: what the maker was shown a minute ago is not an authorisation. They exist so a maker fixes what would get the week rejected before it is handed in, so a blocking failure refuses with its own reason. GitHub being unreachable never blocks.
	const repoChecks = await checkRepo(project.githubRepo, project.theme)
	if (!repoChecks.canSubmit) {
		const first = repoChecks.checks.find(c => c.blocking && c.status === "fail")
		throw new HttpError(
			"UNPROCESSABLE",
			first ? `${first.label}. ${first.detail ?? ""}`.trim() : "The repo is missing something this week needs",
			{ repoChecks },
		)
	}

	// A cart past the tier's funding is not a refusal, it is a grant that covers part of it – which is something the maker has to agree to rather than something this route infers. The numbers come from the database and never from the sheet: a list edited in another tab, or a tier request changed since the page was opened, decide what the maker is agreeing to.
	const funding = await partsFundingFor(project, phase)
	if (funding.needsAgreement && !partialFundingAccepted)
		throw new HttpError(
			"UNPROCESSABLE",
			`Your parts list is $${funding.totalUsd.toFixed(2)} and this tier funds $${funding.capUsd}, so $${funding.shortfallUsd.toFixed(2)} of it is yours to pay. Confirm you understand that before submitting.`,
			{ details: funding },
		)

	// Parts money is a design-week question, so declining it on any other phase is refused rather than recorded: a flag the reviewer cannot act on would only confuse the decision.
	if (fundingDeclined && phase !== Phase.DESIGN)
		throw new HttpError("VALIDATION_FAILED", "Parts funding is only decided on the design week")

	// Only a design submission carries parts money, and only one that is actually over records the agreement: the same arithmetic that let it through is what writes the row, so a stale tick on a cart that no longer needs it leaves nothing behind. Declining wins over agreeing: a maker who wants nothing funded has nothing to agree to.
	const agreedPartial = funding.needsAgreement && partialFundingAccepted && !fundingDeclined

	const settings = await getProgramSettings()
	const now = new Date()
	const submittedInWeek = weekNumberForDate(settings.eventStartDate, now, settings.programTimezone)
	const scheduledWeek = scheduledWeekFor(project.theme, phase)

	return prisma.$transaction(async tx => {
		// The gate is re-read on the transaction client: `getProgramSettings` caches the settings row for this request, so the pre-check above cannot see a submissions toggle, and a week can start or close between it and this write. Either would otherwise file a submission into a closed week.
		const [accessSettings, accessUser, accessProject] = await Promise.all([
			tx.programSettings.findUnique({ where: { id: "singleton" } }),
			tx.user.findUnique({ select: { submissionExtensionUntil: true }, where: { id: userId } }),
			tx.themeProject.findUnique({ select: { submissionExtensionUntil: true }, where: { id: themeProjectId } }),
		])
		const stillOpen = accessOpenOnClient(
			accessSettings,
			accessUser?.submissionExtensionUntil,
			accessProject?.submissionExtensionUntil,
			new Date(),
		)
		if (!stillOpen) throw new HttpError("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
		await assertWeekStarted(scheduledWeekFor(project.theme, phase))

		// Claim the phase first, conditionally on it still being one that can be submitted. Two concurrent submits both read the same outside state, so without this both would create an open submission and both flip the status; the row lock makes the loser's update match nothing.
		const claimed = await tx.themeProject.updateMany({
			data: phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : { buildStatus: PhaseStatus.in_review },
			where: {
				deletedAt: null,
				id: themeProjectId,
				userId,
				...(phase === Phase.DESIGN
					? { designStatus: { in: [PhaseStatus.draft, PhaseStatus.update_requested] } }
					: { buildStatus: { in: [PhaseStatus.draft, PhaseStatus.update_requested] } }),
			},
		})
		if (claimed.count !== 1) throw new HttpError("ALREADY_SUBMITTED", "This phase is already in review")

		return tx.phaseSubmission.create({
			data: {
				attachmentKeys,
				fundingCapUsd: agreedPartial ? funding.capUsd : null,
				fundingDeclined: phase === Phase.DESIGN && fundingDeclined,
				notes,
				// Analytics only. Nothing gates on lateness – a late joiner has to be able to finish.
				onTime: submittedInWeek > 0 && submittedInWeek <= scheduledWeek,
				partialFundingAccepted: agreedPartial,
				phase,
				requestedBomUsd: agreedPartial ? funding.totalUsd : null,
				scheduledWeek,
				submittedInWeek,
				themeProjectId,
			},
		})
	})
}

export async function unsubmitPhase(userId: string, themeProjectId: string, phase: Phase): Promise<void> {
	const project = await prisma.themeProject.findFirst({
		where: { deletedAt: null, id: themeProjectId, userId },
	})
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	if (statusFor(project, phase) !== PhaseStatus.in_review)
		throw new HttpError("NOT_SUBMITTED", "This phase is not awaiting review")

	return prisma.$transaction(async tx => {
		// Serialize against the review path. finalizeReview takes this same per-user credit lock before it re-reads the submission, so holding it here means a decision cannot land between our read and our delete.
		await lockUserCredit(tx, project.userId)

		// Everything below is re-read under the lock; the checks above are the fast fail for the ordinary case.
		const current = await tx.themeProject.findUniqueOrThrow({
			select: { buildStatus: true, designStatus: true },
			where: { id: themeProjectId },
		})
		if ((phase === Phase.DESIGN ? current.designStatus : current.buildStatus) !== PhaseStatus.in_review)
			throw new HttpError("NOT_SUBMITTED", "This phase is not awaiting review")

		const open = await tx.phaseSubmission.findFirst({
			include: { claim: true },
			orderBy: { createdAt: "desc" },
			where: { phase, resolvedAt: null, themeProjectId },
		})
		if (!open) throw new HttpError("NOT_SUBMITTED", "No open submission found")

		// Withdrawing work a reviewer is actively reading wastes their time and races the decision they are about to write.
		if (open.claim && open.claim.expiresAt > new Date())
			throw new HttpError("CLAIMED_BY_OTHER", "A reviewer is looking at this right now")

		// Conditional on still being unresolved: a decision that committed before the lock was ours has made this row its record, and withdrawing it would cascade the review away and put a decided phase back to draft.
		const withdrawn = await tx.phaseSubmission.deleteMany({ where: { id: open.id, resolvedAt: null } })
		if (withdrawn.count !== 1) throw new HttpError("ALREADY_RESOLVED", "This submission has already been decided")

		const flipped = await tx.themeProject.updateMany({
			data: phase === Phase.DESIGN ? { designStatus: PhaseStatus.draft } : { buildStatus: PhaseStatus.draft },
			where: {
				id: themeProjectId,
				...(phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : { buildStatus: PhaseStatus.in_review }),
			},
		})
		if (flipped.count !== 1) throw new HttpError("CONFLICT", "This project moved while it was being withdrawn")
	})
}

/** Stamp a session with the day and program week it belongs to. */
export async function stampSessionTiming(date: Date): Promise<{ effectiveDate: string; weekNumber: number }> {
	const settings = await getProgramSettings()
	return {
		effectiveDate: effectiveDateFor(date, settings.programTimezone),
		weekNumber: weekNumberForDate(settings.eventStartDate, date, settings.programTimezone),
	}
}
