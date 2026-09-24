import "server-only"
import prisma from "@/lib/prisma"
import { Phase } from "@/app/generated/prisma/enums"
import { getHoursBreakdown } from "@/lib/hours"
import { getThemeDef } from "@/lib/config/program"
import { publicUrlFor } from "@/lib/uploads/r2"
import { projectThumbnail } from "@/lib/thumbnail"

export interface QueueItem {
  id: string
  themeProjectId: string
  phase: Phase
  themeLabel: string
  projectTitle: string
  participant: { id: string; name: string | null; email: string }
  submittedAt: Date
  submittedInWeek: number | null
  onTime: boolean
  claimedBy: { id: string; name: string | null } | null
  claimExpiresAt: Date | null
  /** Whether the claim is still in force. Computed here rather than in a
   *  component, so rendering stays a pure function of its inputs. */
  claimLive: boolean
  tier: number | null
}

export async function getReviewQueue(opts: {
  /** The signed-in reviewer. Their own submissions are excluded from the queue. */
  reviewerId: string
  phase?: Phase
  cursor?: string
  limit: number
}): Promise<{ items: QueueItem[]; nextCursor: string | null; counts: { design: number; build: number } }> {
  const where = {
    resolvedAt: null,
    ...(opts.phase ? { phase: opts.phase } : {}),
    // Nobody reviews their own work, so it should never show up as something
    // to act on. The decision path refuses it too — this is so the queue
    // counts are honest, not the enforcement.
    themeProject: { deletedAt: null, userId: { not: opts.reviewerId } },
  }

  const [rows, designCount, buildCount] = await Promise.all([
    prisma.phaseSubmission.findMany({
      where,
      // Oldest first: a review queue that surfaces the newest work leaves the
      // people who submitted first waiting longest.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: opts.limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      include: {
        themeProject: {
          select: {
            id: true,
            theme: true,
            title: true,
            tier: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        claim: { include: { reviewer: { select: { id: true, name: true } } } },
      },
    }),
    prisma.phaseSubmission.count({ where: { ...where, phase: Phase.DESIGN } }),
    prisma.phaseSubmission.count({ where: { ...where, phase: Phase.BUILD } }),
  ])

  const hasMore = rows.length > opts.limit
  const page = hasMore ? rows.slice(0, opts.limit) : rows
  const last = page[page.length - 1]
  const now = Date.now()

  return {
    items: page.map((row) => ({
      id: row.id,
      themeProjectId: row.themeProject.id,
      phase: row.phase,
      themeLabel: getThemeDef(row.themeProject.theme).label,
      projectTitle: row.themeProject.title,
      participant: row.themeProject.user,
      submittedAt: row.createdAt,
      submittedInWeek: row.submittedInWeek,
      onTime: row.onTime,
      claimedBy: row.claim ? { id: row.claim.reviewer.id, name: row.claim.reviewer.name } : null,
      claimExpiresAt: row.claim?.expiresAt ?? null,
      claimLive: !!row.claim && row.claim.expiresAt.getTime() > now,
      tier: row.themeProject.tier,
    })),
    nextCursor: hasMore && last ? last.id : null,
    counts: { design: designCount, build: buildCount },
  }
}

export async function getSubmissionDetail(submissionId: string, reviewerId?: string) {
  const submission = await prisma.phaseSubmission.findUnique({
    where: { id: submissionId },
    include: {
      themeProject: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              slackId: true,
              verificationStatus: true,
              fraudFlagged: true,
            },
          },
        },
      },
      claim: { include: { reviewer: { select: { id: true, name: true } } } },
      reviews: {
        orderBy: { createdAt: "desc" },
        include: { reviewer: { select: { id: true, name: true } } },
      },
    },
  })
  if (!submission) return null
  // Your own work is not reviewable by you, so it is not visible here either.
  // Null rather than a 403: the review surface should not confirm that this is
  // a submission you merely lack rights over.
  if (reviewerId && submission.themeProject.userId === reviewerId) return null

  const [breakdown, sessions, links, priorReviews] = await Promise.all([
    getHoursBreakdown(submission.themeProjectId, submission.phase, { live: false }),
    prisma.workSession.findMany({
      where: {
        themeProjectId: submission.themeProjectId,
        phase: submission.phase,
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
      include: { media: true, timelapses: true },
    }),
    prisma.hackatimeLink.findMany({
      where: { themeProjectId: submission.themeProjectId, phase: submission.phase },
    }),
    prisma.submissionReview.findMany({
      where: { submission: { themeProjectId: submission.themeProjectId } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        reviewer: { select: { name: true } },
        submission: { select: { phase: true } },
      },
    }),
  ])

  return {
    submission,
    claimLive: !!submission.claim && submission.claim.expiresAt.getTime() > Date.now(),
    themeLabel: getThemeDef(submission.themeProject.theme).label,
    coverImageUrl: projectThumbnail(publicUrlFor(submission.themeProject.coverImageKey), sessions),
    breakdown,
    sessions: sessions.map((s) => ({
      ...s,
      media: s.media.map((m) => ({ ...m, url: publicUrlFor(m.objectKey) })),
    })),
    links,
    priorReviews,
  }
}
