import prisma from "@/lib/prisma"
import { ok, fail, parseBody, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { sessionUpdateSchema } from "@/lib/schemas/session"
import { sanitize, sanitizeHtml } from "@/lib/sanitize"
import { recomputeStreak } from "@/lib/streak"
import { getSubmissionAccess, isWeekOpen, SUBMISSIONS_CLOSED_MESSAGE, WEEK_CLOSED_MESSAGE } from "@/lib/program"
import { scheduledWeekFor } from "@/lib/config/program"
import { PhaseStatus, type Phase, type Theme } from "@/app/generated/prisma/enums"
import { AuditAction, logAudit } from "@/lib/audit"
import { recomputeWeek } from "@/lib/analytics"

type Params = { params: Promise<{ id: string; sessionId: string }> }

async function loadOwned(userId: string, projectId: string, sessionId: string) {
  return prisma.workSession.findFirst({
    where: {
      id: sessionId,
      themeProjectId: projectId,
      deletedAt: null,
      themeProject: { userId, deletedAt: null },
    },
    include: { themeProject: { select: { theme: true, designStatus: true, buildStatus: true } } },
  })
}

/** A passed week's entries are the record it is judged on, so they stay put. */
function weekOpenFor(userId: string, projectId: string, session: { phase: Phase; themeProject: { theme: Theme } }) {
  return isWeekOpen(userId, projectId, scheduledWeekFor(session.themeProject.theme, session.phase))
}

export const PATCH = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id, sessionId } = await params

  const parsed = await parseBody(req, sessionUpdateSchema)
  if (parsed.error) return parsed.error
  const data = parsed.data

  const session = await loadOwned(gate.user.id, id, sessionId)
  if (!session) return fail("NOT_FOUND", "Session not found")

  const access = await getSubmissionAccess(gate.user.id, id)
  if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)
  if (!(await weekOpenFor(gate.user.id, id, session))) return fail("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)

  // A submitted week's entries are what it was judged on, or is being judged
  // on: in review, a reviewer is reading them; decided, they are the record
  // the decision was made against. Only a week that is still open or has been
  // sent back for changes can have its entries corrected.
  const phaseStatus = session.phase === "DESIGN" ? session.themeProject.designStatus : session.themeProject.buildStatus
  if (phaseStatus === PhaseStatus.in_review) {
    return fail("PHASE_LOCKED", "This week is in review — unsubmit it before editing its entries")
  }
  if (phaseStatus === PhaseStatus.approved || phaseStatus === PhaseStatus.rejected) {
    return fail("PHASE_LOCKED", "This week has been submitted and decided, so its entries are final")
  }

  // Once a reviewer has set hours on an entry, the participant editing it
  // would silently invalidate the number the review was based on.
  if (session.hoursApproved !== null) {
    return fail("PHASE_LOCKED", "This entry has been reviewed and can no longer be edited")
  }

  const updated = await prisma.workSession.update({
    where: { id: sessionId },
    data: {
      ...(data.title !== undefined ? { title: sanitize(data.title) } : {}),
      ...(data.content !== undefined ? { content: data.content ? sanitizeHtml(data.content) : null } : {}),
      ...(data.hoursClaimed !== undefined ? { hoursClaimed: data.hoursClaimed } : {}),
      ...(data.hoursSource !== undefined ? { hoursSource: data.hoursSource } : {}),
    },
  })

  await logAudit({
    action: AuditAction.USER_UPDATE_SESSION,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "WorkSession",
    targetId: sessionId,
    metadata: {
      before: { hoursClaimed: session.hoursClaimed, title: session.title },
      after: { hoursClaimed: updated.hoursClaimed, title: updated.title },
    },
  })

  if (data.hoursClaimed !== undefined) await recomputeWeek(gate.user.id, session.weekNumber)

  return ok({ session: updated })
})

export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id, sessionId } = await params

  const session = await loadOwned(gate.user.id, id, sessionId)
  if (!session) return fail("NOT_FOUND", "Session not found")
  if (session.hoursApproved !== null) {
    return fail("PHASE_LOCKED", "This entry has been reviewed and can no longer be deleted")
  }
  if (!(await weekOpenFor(gate.user.id, id, session))) return fail("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)

  // Deleting the only session on a day removes that day from the run, so the
  // streak has to be recomputed with it. PATCH does not, because it cannot
  // change `effectiveDate` — the set of journalled days is the same after it.
  await prisma.$transaction(async (tx) => {
    await tx.workSession.update({
      where: { id: sessionId },
      data: { deletedAt: new Date() },
    })
    await recomputeStreak(tx, gate.user.id)
  })

  await logAudit({
    action: AuditAction.USER_DELETE_SESSION,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "WorkSession",
    targetId: sessionId,
    metadata: { themeProjectId: id, hoursClaimed: session.hoursClaimed },
  })

  await recomputeWeek(gate.user.id, session.weekNumber)

  return ok({ ok: true })
})
