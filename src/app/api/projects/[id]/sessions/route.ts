import type { NextRequest } from "next/server"
import { PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import { recomputeWeek } from "@/lib/analytics"
import { fail, ok, parseBody, parseQuery, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { scheduledWeekFor } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { requireSession } from "@/lib/guards"
import { verifyOwnTimelapses } from "@/lib/lapse"
import { cursorArgs, pageResult, paginationQuery } from "@/lib/pagination"
import prisma from "@/lib/prisma"
import {
  assertWeekStarted,
  getSubmissionAccess,
  isPhaseDecided,
  isWeekOpen,
  SUBMISSIONS_CLOSED_MESSAGE,
  WEEK_CLOSED_MESSAGE,
} from "@/lib/program"
import { assertNoOwedReel } from "@/lib/reel-gate"
import { warmupPhaseOf } from "@/lib/warmup"
import { sanitize, sanitizeHtml } from "@/lib/sanitize"
import { sessionCreateSchema } from "@/lib/schemas/session"
import { recomputeStreak } from "@/lib/streak"
import { stampSessionTiming } from "@/lib/submissions"
import { isOwnedKey, publicUrlFor } from "@/lib/uploads/r2"

type Params = { params: Promise<{ id: string }> }

export const GET = withRoute(async (req: NextRequest, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const query = parseQuery(req, paginationQuery)
  if (query.error) return query.error

  const project = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
    select: { id: true },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")

  const rows = await prisma.workSession.findMany({
    where: { themeProjectId: id, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...cursorArgs(query.data.cursor, query.data.limit),
    include: { media: true, timelapses: true },
  })

  const page = pageResult(rows, query.data.limit)
  return ok({
    items: page.items.map((s) => ({
      ...s,
      media: s.media.map((m) => ({ ...m, url: publicUrlFor(m.objectKey) })),
    })),
    nextCursor: page.nextCursor,
  })
})

export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, sessionCreateSchema)
  if (parsed.error) return parsed.error
  const data = parsed.data

  const project = await prisma.themeProject.findFirst({
    where: { id, userId: gate.user.id, deletedAt: null },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")

  const access = await getSubmissionAccess(gate.user.id, id)
  if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

  // A new entry completes a checkpoint, so a deleted reel still owed holds it.
  await assertNoOwedReel(gate.user.id)

  if (project.theme === Theme.WARMUP && data.phase !== warmupPhaseOf(project)) {
    return fail("VALIDATION_FAILED", "Entries on a warm-up project go on the phase it is handed in as")
  }

  const week = scheduledWeekFor(project.theme, data.phase)
  await assertWeekStarted(week)
  if (!(await isWeekOpen(gate.user.id, id, week))) {
    return fail("WEEK_CLOSED", WEEK_CLOSED_MESSAGE)
  }

  const phaseStatus = data.phase === "DESIGN" ? project.designStatus : project.buildStatus
  if (phaseStatus === PhaseStatus.in_review) {
    return fail("PHASE_LOCKED", "This phase is in review — unsubmit before logging more work")
  }
  // Same rule as editing an entry: once a week is decided, its entries are the
  // record the decision was made against. Without this, hours could be logged
  // after approval and paid out on the next un-approve/re-approve cycle.
  if (isPhaseDecided(phaseStatus)) {
    return fail("PHASE_LOCKED", "This phase has been submitted and decided, so new entries cannot be added")
  }

  // Evidence has to be the claimant's own. Keys are not secrets — the feed
  // hands out a full video URL for every reel — so without this someone could
  // attach a stranger's timelapse as proof of hours they did not work, which is
  // the one thing the timelapse rule exists to make hard.
  //
  // Rejected rather than quietly dropped: a participant who thinks they
  // attached a clip and finds it missing at review has been failed silently.
  const foreign = data.media.map((m) => m.objectKey).filter((key) => !isOwnedKey(gate.user.id, key))
  if (foreign.length > 0) {
    return fail("VALIDATION_FAILED", "Those uploads are not yours")
  }

  // Timelapses are the same rule asked of Lapse: each must be the caller's
  // own, published, and done processing. And one recording backs one session —
  // otherwise the same footage could be offered as proof twice. That check is
  // read-then-create, so it happens inside the transaction under a lock on the
  // recording; two parallel submits of the same clip otherwise both pass it.
  const lapseIds = [...new Set(data.timelapses.map((t) => t.lapseId))]
  const timelapses = await verifyOwnTimelapses(gate.user.id, lapseIds)

  const timing = await stampSessionTiming(new Date())

  // One transaction: a session and the streak it feeds have to land together,
  // or a rolled-back write leaves an inflated streak with nothing behind it.
  const session = await prisma.$transaction(async (tx) => {
    if (lapseIds.length > 0) {
      // Sorted so two requests naming the same recordings cannot deadlock on
      // each other's locks.
      for (const lapseId of [...lapseIds].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lapse:${lapseId}`}, 0))`
      }
      const taken = await tx.sessionTimelapse.findFirst({
        where: {
          provider: "lapse",
          externalId: { in: lapseIds },
          workSession: { deletedAt: null },
        },
        select: { externalId: true },
      })
      if (taken) {
        const title = timelapses.find((t) => t.id === taken.externalId)?.title ?? "That timelapse"
        throw new HttpError("CONFLICT", `"${title}" already backs another journal entry`)
      }
    }

    const created = await tx.workSession.create({
      data: {
        themeProjectId: id,
        phase: data.phase,
        title: sanitize(data.title),
        content: data.content ? sanitizeHtml(data.content) : null,
        hoursClaimed: data.hoursClaimed,
        hoursSource: data.hoursSource,
        effectiveDate: timing.effectiveDate,
        weekNumber: timing.weekNumber,
        media: {
          create: data.media.map((m, i) => ({
            type: m.type,
            objectKey: m.objectKey,
            contentType: m.contentType ?? null,
            byteSize: m.byteSize ?? null,
            sortOrder: i,
          })),
        },
        timelapses: {
          create: timelapses.map((t) => ({
            provider: "lapse",
            externalId: t.id,
            playbackUrl: t.playbackUrl,
            thumbnailUrl: t.thumbnailUrl,
            // Lapse's duration is wall-clock time recorded, which is exactly
            // what coverage is measured in.
            coveredSeconds: t.durationSeconds,
          })),
        },
      },
      include: { media: true, timelapses: true },
    })
    await recomputeStreak(tx, gate.user.id)
    return created
  })

  await logAudit({
    action: AuditAction.USER_CREATE_SESSION,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "WorkSession",
    targetId: session.id,
    metadata: {
      themeProjectId: id,
      phase: data.phase,
      hoursClaimed: data.hoursClaimed,
      hoursSource: data.hoursSource,
    },
  })

  await recomputeWeek(gate.user.id, session.weekNumber)

  return ok({ session }, { status: 201 })
})
