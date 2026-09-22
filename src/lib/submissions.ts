import "server-only"
import prisma from "@/lib/prisma"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import type { ThemeProject } from "@/app/generated/prisma/client"
import { checkRepo } from "@/lib/repo-checks"
import { HttpError } from "@/lib/errors"
import { getHoursBreakdown } from "@/lib/hours"
import { isOwnedKey } from "@/lib/uploads/r2"
import {
  effectiveDateFor,
  getProgramSettings,
  getSubmissionAccess,
  SUBMISSIONS_CLOSED_MESSAGE,
  weekNumberForDate,
} from "@/lib/program"
import { scheduledWeekFor } from "@/lib/config/program"

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
export async function getSubmitReadiness(
  project: ThemeProject,
  phase: Phase,
): Promise<ReadinessCheck[]> {
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
      detail:
        project.designStatus === PhaseStatus.draft
          ? "Submit your design before submitting the build"
          : undefined,
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
  if (phase === Phase.BUILD && project.designStatus === PhaseStatus.draft) {
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

  const eligible = canSubmitPhase(project, phase)
  if (!eligible.ok) throw new HttpError(eligible.code, eligible.message)

  // A submission must not be able to file someone else's evidence as its own.
  const ownKeys = attachmentKeys.filter((key) => isOwnedKey(userId, key))

  const breakdown = await getHoursBreakdown(themeProjectId, phase)
  if (breakdown.journalEntryCount === 0 && breakdown.hackatimeHours === 0) {
    throw new HttpError(
      "UNPROCESSABLE",
      "Log at least one work session before submitting this phase",
    )
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
  if (
    process.env.SKIP_YSWS_VERIFICATION_CHECK !== "true" &&
    user?.verificationStatus !== "verified"
  ) {
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
  const submittedInWeek = weekNumberForDate(settings.eventStartDate, now)
  const scheduledWeek = scheduledWeekFor(project.theme, phase)

  return prisma.$transaction(async (tx) => {
    const submission = await tx.phaseSubmission.create({
      data: {
        themeProjectId,
        phase,
        notes,
        attachmentKeys: ownKeys,
        submittedInWeek,
        scheduledWeek,
        // Analytics only. Nothing gates on lateness — a late joiner has to be
        // able to finish.
        onTime: submittedInWeek > 0 && submittedInWeek <= scheduledWeek,
      },
    })
    await tx.themeProject.update({
      where: { id: themeProjectId },
      data:
        phase === Phase.DESIGN
          ? { designStatus: PhaseStatus.in_review }
          : { buildStatus: PhaseStatus.in_review },
    })
    return submission
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

  const open = await prisma.phaseSubmission.findFirst({
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

  return prisma.$transaction(async (tx) => {
    await tx.phaseSubmission.delete({ where: { id: open.id } })
    await tx.themeProject.update({
      where: { id: themeProjectId },
      data:
        phase === Phase.DESIGN
          ? { designStatus: PhaseStatus.draft }
          : { buildStatus: PhaseStatus.draft },
    })
  })
}

/** Stamp a session with the day and program week it belongs to. */
export async function stampSessionTiming(
  date: Date,
): Promise<{ effectiveDate: string; weekNumber: number }> {
  const settings = await getProgramSettings()
  return {
    effectiveDate: effectiveDateFor(date, settings.programTimezone),
    weekNumber: weekNumberForDate(settings.eventStartDate, date),
  }
}
