import "server-only"
import prisma from "@/lib/prisma"
import { Phase, PhaseStatus, PostStatus, type ReviewResult } from "@/app/generated/prisma/enums"
import { bomLockReason, listBom, type BomLine } from "@/lib/bom"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * Everything the project page shows that the trail's store does not carry:
 * the timeline with its media, the parts list and the cover.
 *
 * The store knows a session happened and how long it was, which is all the
 * trail needs. The project page is the full record — the timelapses behind
 * each entry, the reels themselves, when each week was handed in and what the
 * reviewer said — so it reads the rows directly rather than widening a
 * snapshot every other page has to download.
 */

export interface TimelineLapse {
  id: string
  thumbnailUrl: string | null
  /** Where to watch it: Lapse's own page, or the uploaded file. */
  href: string | null
  coveredSeconds: number | null
}

export type TimelineItem =
  | {
      kind: "session"
      id: string
      at: number
      phase: Phase
      hours: number
      /** What a reviewer accepted, when it differs from the claim. */
      approvedHours: number | null
      body: string
      lapses: TimelineLapse[]
    }
  | {
      kind: "reel"
      id: string
      at: number
      caption: string
      videoUrl: string | null
      thumbnailUrl: string | null
      /** Posted but not in the feed yet, or taken out of it. */
      status: PostStatus
    }
  | {
      kind: "submitted"
      id: string
      at: number
      phase: Phase
    }
  | {
      kind: "reviewed"
      id: string
      at: number
      phase: Phase
      result: ReviewResult
      comments: string | null
    }

export interface ProjectPageData {
  coverImageUrl: string | null
  timeline: TimelineItem[]
  bom: BomLine[]
  /** The order's tax and shipping total — a fixed line of the BOM, zero until set. */
  bomTaxShippingUsd: number
  /** Why the parts list cannot change, or null when it can. */
  bomLocked: string | null
  /** Why the project's own fields cannot change, or null when they can. */
  editLocked: string | null
}

export async function getProjectPage(userId: string, id: string): Promise<ProjectPageData | null> {
  const project = await prisma.themeProject.findFirst({
    where: { id, userId, deletedAt: null },
    select: {
      id: true,
      coverImageKey: true,
      bomTaxShippingUsd: true,
      designStatus: true,
      buildStatus: true,
      designReviewComments: true,
      buildReviewComments: true,
      workSessions: {
        where: { deletedAt: null },
        select: {
          id: true,
          phase: true,
          title: true,
          content: true,
          hoursClaimed: true,
          hoursApproved: true,
          createdAt: true,
          timelapses: {
            select: {
              id: true,
              provider: true,
              externalId: true,
              objectKey: true,
              playbackUrl: true,
              thumbnailUrl: true,
              coveredSeconds: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
      posts: {
        // Their own reels, including one a moderator took out of the feed —
        // the author still sees those, as the feed's own rule has it.
        where: { deletedAt: null, userId, status: { not: PostStatus.REMOVED } },
        select: {
          id: true,
          caption: true,
          objectKey: true,
          thumbnailKey: true,
          status: true,
          createdAt: true,
          publishedAt: true,
        },
      },
      submissions: {
        select: { id: true, phase: true, createdAt: true, resolvedAt: true, resolvedResult: true },
      },
    },
  })
  if (!project) return null

  const timeline: TimelineItem[] = []

  for (const s of project.workSessions) {
    timeline.push({
      kind: "session",
      id: s.id,
      at: s.createdAt.getTime(),
      phase: s.phase,
      hours: s.hoursClaimed,
      approvedHours:
        s.hoursApproved !== null && s.hoursApproved !== s.hoursClaimed ? s.hoursApproved : null,
      body: s.content ?? s.title,
      lapses: s.timelapses.map((t) => ({
        id: t.id,
        thumbnailUrl: t.thumbnailUrl,
        href:
          t.provider === "lapse" && t.externalId
            ? lapseTimelapseUrl(t.externalId)
            : (t.playbackUrl ?? publicUrlFor(t.objectKey)),
        coveredSeconds: t.coveredSeconds,
      })),
    })
  }

  for (const p of project.posts) {
    timeline.push({
      kind: "reel",
      id: p.id,
      at: (p.publishedAt ?? p.createdAt).getTime(),
      caption: p.caption,
      videoUrl: publicUrlFor(p.objectKey),
      thumbnailUrl: publicUrlFor(p.thumbnailKey),
      status: p.status,
    })
  }

  // A resolved submission is two moments — handed in, then decided — and the
  // gap between them is part of the story. Only the latest decision per phase
  // has comments on the project row, so older ones are shown without them.
  const latestResolved = new Map<Phase, string>()
  for (const sub of [...project.submissions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    timeline.push({ kind: "submitted", id: `${sub.id}-in`, at: sub.createdAt.getTime(), phase: sub.phase })
    if (sub.resolvedAt && sub.resolvedResult) latestResolved.set(sub.phase, sub.id)
  }
  for (const sub of project.submissions) {
    if (!sub.resolvedAt || !sub.resolvedResult) continue
    const latest = latestResolved.get(sub.phase) === sub.id
    timeline.push({
      kind: "reviewed",
      id: `${sub.id}-out`,
      at: sub.resolvedAt.getTime(),
      phase: sub.phase,
      result: sub.resolvedResult,
      comments: latest
        ? sub.phase === Phase.DESIGN
          ? project.designReviewComments
          : project.buildReviewComments
        : null,
    })
  }

  timeline.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))

  const inReview =
    project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review

  return {
    coverImageUrl: publicUrlFor(project.coverImageKey),
    timeline,
    bom: await listBom(project.id),
    bomTaxShippingUsd: project.bomTaxShippingUsd ?? 0,
    bomLocked: bomLockReason(project),
    editLocked: inReview ? "Unsubmit before editing — a phase is in review" : null,
  }
}
