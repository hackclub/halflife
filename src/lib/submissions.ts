import "server-only"
import type { ThemeProject } from "@/app/generated/prisma/client"
import { Phase, PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import { scheduledWeekFor } from "@/lib/config/program"
import { lockUserCredit } from "@/lib/currency"
import { HttpError } from "@/lib/errors"
import { syncHcaProfile } from "@/lib/hca-profile"
import { getHoursBreakdown } from "@/lib/hours"
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
import { warmupPhaseOf } from "@/lib/warmup"
import { isOwnedKey } from "@/lib/uploads/r2"

export function statusFor(project: ThemeProject, phase: Phase): PhaseStatus {
	return phase === Phase.DESIGN ? project.designStatus : project.buildStatus
}

export interface ReadinessCheck {
	key: string
	label: string
	ok: boolean
	detail?: string
}

/**
 * The readiness checklist shown before submitting. This is UI: the submit route
 * recomputes eligibility server-side, because a checklist rendered five minutes
 * ago is not an authorisation.
 */
export async function getSubmitReadiness(project: ThemeProject, phase: Phase): Promise<ReadinessCheck[]> {
	const breakdown = await getHoursBreakdown(project.id, phase)
	const checks: ReadinessCheck[] = [
		{
			key: "title",
			label: "Project has a title",
			ok: project.title.trim().length > 0,
		},
		{
			key: "description",
			label: "Project has a description",
			ok: (project.description ?? "").trim().length > 0,
		},
		{
			key: "hours",
			label: "At least one logged work session",
			ok: breakdown.journalEntryCount > 0 || breakdown.hackatimeHours > 0,
			detail: `${breakdown.computedTotal}h logged`,
		},
	]

	if (phase === Phase.BUILD) {
		checks.push({
			key: "design",
			label: "Design phase submitted",
			ok: project.designStatus !== PhaseStatus.draft,
			detail: project.designStatus === PhaseStatus.draft ? "Submit your design before submitting the build" : undefined,
		})
	}
	return checks
}

/**
 * Whether a phase can be submitted right now.
 *
 * Build may be submitted once design has been submitted at least once — not
 * once design has been *approved*. With five concurrent themes sharing one
 * review queue, gating on approval turns a reviewer-capacity problem into a
 * participant-blocked problem: someone would sit idle through their build week
 * waiting on a queue. The finalize path does require design approved before a
 * build can be approved, so the ordering invariant holds where money is
 * involved and not where it only costs people time.
 */
export function canSubmitPhase(
	project: ThemeProject,
	phase: Phase,
): { ok: true } | { ok: false; code: "ALREADY_SUBMITTED" | "PHASE_LOCKED"; message: string } {
	// A warm-up is one submission, as the phase it was made for: a design
	// asking for funding, or a finished build. Never the other, never both.
	if (project.theme === Theme.WARMUP && phase !== warmupPhaseOf(project)) {
		return {
			ok: false,
			code: "PHASE_LOCKED",
			message:
				warmupPhaseOf(project) === Phase.DESIGN
					? "This warm-up project is handed in as a design"
					: "This warm-up project is handed in as a finished build",
		}
	}

	const status = statusFor(project, phase)
	if (status === PhaseStatus.in_review) {
		return { ok: false, code: "ALREADY_SUBMITTED", message: "This phase is already in review" }
	}
	if (status === PhaseStatus.approved) {
		return { ok: false, code: "PHASE_LOCKED", message: "This phase is already approved" }
	}
	if (status === PhaseStatus.rejected) {
		return {
			ok: false,
			code: "PHASE_LOCKED",
			message: "This phase was rejected. Ask an admin to reopen it.",
		}
	}
	// A warm-up project is one phase by nature — it was handed in through the
	// pre-season form, not designed and then built — so the design-first rule
	// does not apply to it.
	if (phase === Phase.BUILD && project.theme !== Theme.WARMUP && project.designStatus === PhaseStatus.draft) {
		return {
			ok: false,
			code: "PHASE_LOCKED",
			message: "Submit your design for this theme before submitting the build",
		}
	}
	return { ok: true }
}

export async function submitPhase(
	userId: string,
	themeProjectId: string,
	phase: Phase,
	notes: string | null,
	attachmentKeys: string[] = [],
) {
	const project = await prisma.themeProject.findFirst({
		where: { id: themeProjectId, userId, deletedAt: null },
	})
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	const access = await getSubmissionAccess(userId, themeProjectId)
	if (!access.open) throw new HttpError("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
	await assertWeekStarted(scheduledWeekFor(project.theme, phase))

	const eligible = canSubmitPhase(project, phase)
	if (!eligible.ok) throw new HttpError(eligible.code, eligible.message)

	// The readiness checklist calls a description required, and the Ari SDK
	// refuses a ship without one. Week one's onboarding lets the maker leave it
	// blank (the project form for other weeks does not), so a blank description
	// used to pass submit and then fail the Ari send silently in the `after`
	// hook — the maker saw success and no reviewer ever saw the project. Enforce
	// it here, beside the hours check, so the refusal reaches the person who can
	// fix it. `buildShipInput` keeps a fallback too, so hand-ins already stuck in
	// this state can still be replayed by `ari-retry`.
	if (!project.description?.trim()) {
		throw new HttpError("UNPROCESSABLE", "Add a project description before submitting this phase")
	}

	// Handing a week in is a checkpoint too; a deleted reel still owed holds it.
	await assertNoOwedReel(userId)

	// A submission must not be able to file someone else's evidence as its own.
	// Refuse rather than filter: silently dropping a stranger's key hands back a
	// success with the evidence missing, which the maker only finds out at review.
	const foreign = attachmentKeys.filter((key) => !isOwnedKey(userId, key))
	if (foreign.length > 0) throw new HttpError("VALIDATION_FAILED", "Those uploads are not yours")

	const breakdown = await getHoursBreakdown(themeProjectId, phase)
	if (breakdown.journalEntryCount === 0 && breakdown.hackatimeHours === 0) {
		throw new HttpError("UNPROCESSABLE", "Log at least one work session before submitting this phase")
	}

	// Identity verification is gated here rather than at signup, so people can
	// explore and log work before they have finished verifying.
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { verificationStatus: true, fraudFlagged: true },
	})
	if (user?.fraudFlagged) {
		throw new HttpError("FORBIDDEN", "Your account is under review. Reach out in Slack.")
	}
	// The stored status is from the last sign-in. Someone who finished verifying
	// since then is verified now, so HCA is asked again before anyone is turned
	// away — and only then, so a verified maker's submit costs no extra call.
	let verificationStatus = user?.verificationStatus ?? null
	if (process.env.SKIP_YSWS_VERIFICATION_CHECK !== "true" && verificationStatus !== "verified") {
		verificationStatus = (await syncHcaProfile(userId)) ?? verificationStatus
	}
	if (process.env.SKIP_YSWS_VERIFICATION_CHECK !== "true" && verificationStatus !== "verified") {
		throw new HttpError(
			"NOT_VERIFIED",
			"Identity verification is required before submitting. Verify at identity.hackclub.com.",
		)
	}

	// The repo checks, run here rather than trusted from the sheet: what the
	// maker was shown a minute ago is not an authorisation. They exist so a
	// maker fixes what would get the week rejected before it is handed in, so a
	// blocking failure refuses with its own reason. GitHub being unreachable
	// never blocks.
	const repoChecks = await checkRepo(project.githubRepo, project.theme)
	if (!repoChecks.canSubmit) {
		const first = repoChecks.checks.find((c) => c.blocking && c.status === "fail")
		throw new HttpError(
			"UNPROCESSABLE",
			first ? `${first.label}. ${first.detail ?? ""}`.trim() : "The repo is missing something this week needs",
			{ repoChecks },
		)
	}

	const settings = await getProgramSettings()
	const now = new Date()
	const submittedInWeek = weekNumberForDate(settings.eventStartDate, now, settings.programTimezone)
	const scheduledWeek = scheduledWeekFor(project.theme, phase)

	return prisma.$transaction(async (tx) => {
		// Claim the phase first, conditionally on it still being one that can be
		// submitted. Two concurrent submits both read the same outside state, so
		// without this both would create an open submission and both flip the
		// status; the row lock makes the loser's update match nothing.
		const claimed = await tx.themeProject.updateMany({
			where: {
				id: themeProjectId,
				userId,
				deletedAt: null,
				...(phase === Phase.DESIGN
					? { designStatus: { in: [PhaseStatus.draft, PhaseStatus.update_requested] } }
					: { buildStatus: { in: [PhaseStatus.draft, PhaseStatus.update_requested] } }),
			},
			data: phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : { buildStatus: PhaseStatus.in_review },
		})
		if (claimed.count !== 1) {
			throw new HttpError("ALREADY_SUBMITTED", "This phase is already in review")
		}

		return tx.phaseSubmission.create({
			data: {
				themeProjectId,
				phase,
				notes,
				attachmentKeys,
				submittedInWeek,
				scheduledWeek,
				// Analytics only. Nothing gates on lateness — a late joiner has to be
				// able to finish.
				onTime: submittedInWeek > 0 && submittedInWeek <= scheduledWeek,
			},
		})
	})
}

export async function unsubmitPhase(userId: string, themeProjectId: string, phase: Phase) {
	const project = await prisma.themeProject.findFirst({
		where: { id: themeProjectId, userId, deletedAt: null },
	})
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	if (statusFor(project, phase) !== PhaseStatus.in_review) {
		throw new HttpError("NOT_SUBMITTED", "This phase is not awaiting review")
	}

	return prisma.$transaction(async (tx) => {
		// Serialize against the review path. finalizeReview takes this same
		// per-user credit lock before it re-reads the submission, so holding it
		// here means a decision cannot land between our read and our delete.
		await lockUserCredit(tx, project.userId)

		// Everything below is re-read under the lock; the checks above are the
		// fast fail for the ordinary case.
		const current = await tx.themeProject.findUniqueOrThrow({
			where: { id: themeProjectId },
			select: { designStatus: true, buildStatus: true },
		})
		if ((phase === Phase.DESIGN ? current.designStatus : current.buildStatus) !== PhaseStatus.in_review) {
			throw new HttpError("NOT_SUBMITTED", "This phase is not awaiting review")
		}

		const open = await tx.phaseSubmission.findFirst({
			where: { themeProjectId, phase, resolvedAt: null },
			orderBy: { createdAt: "desc" },
			include: { claim: true },
		})
		if (!open) throw new HttpError("NOT_SUBMITTED", "No open submission found")

		// Withdrawing work a reviewer is actively reading wastes their time and
		// races the decision they are about to write.
		if (open.claim && open.claim.expiresAt > new Date()) {
			throw new HttpError("CLAIMED_BY_OTHER", "A reviewer is looking at this right now")
		}

		// Conditional on still being unresolved: a decision that committed before
		// the lock was ours has made this row its record, and withdrawing it would
		// cascade the review away and put a decided phase back to draft.
		const withdrawn = await tx.phaseSubmission.deleteMany({ where: { id: open.id, resolvedAt: null } })
		if (withdrawn.count !== 1) {
			throw new HttpError("ALREADY_RESOLVED", "This submission has already been decided")
		}

		const flipped = await tx.themeProject.updateMany({
			where: {
				id: themeProjectId,
				...(phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : { buildStatus: PhaseStatus.in_review }),
			},
			data: phase === Phase.DESIGN ? { designStatus: PhaseStatus.draft } : { buildStatus: PhaseStatus.draft },
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
