import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import { Phase, PhaseStatus, PostStatus, type ReviewResult } from "@/app/generated/prisma/enums"
import { type BomLine, bomLockReason, listBom } from "@/lib/bom"
import { THEMES, WARMUP_WEEK_ID } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import { lapseTimelapseUrl } from "@/lib/lapse"
import prisma from "@/lib/prisma"
import { deleteBlockReason } from "@/lib/project-delete"
import { getRepoSyncState, type RepoSyncState } from "@/lib/repo-sync"
import { type ProjectThumbnail, projectThumbnail } from "@/lib/thumbnail"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * Everything the project page shows that the trail's store does not carry: the timeline with its media, the parts list and the cover.
 *
 * The store knows a session happened and how long it was, which is all the trail needs. The project page is the full record – the timelapses behind each entry, the reels themselves, when each week was handed in and what the reviewer said – so it reads the rows directly rather than widening a snapshot every other page has to download.
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

/** One phase's review state, for the block above the repo checks. */
export interface PhaseReview {
	phase: Phase
	status: PhaseStatus
	/** The reviewer's note on the latest decision, if any. */
	comments: string | null
	/** When the latest submission for this phase was handed in, epoch ms. */
	submittedAt: number | null
	/** When it was decided, epoch ms. */
	reviewedAt: number | null
	/** When the maker asked for a second look, if they have. */
	disputedAt: number | null
	/** Whether staff have closed that dispute. */
	disputeResolved: boolean
	/** Why the maker's open hand-in never reached Ari, when it did not. Null once it has, or when there is no open hand-in. */
	shipError: string | null
}

export interface ProjectPageData {
	/** The thumbnail the maker chose, if any. */
	coverImageUrl: string | null
	/** What stands in until they choose one: a journal image, then a reel frame. */
	fallbackThumbnail: ProjectThumbnail | null
	timeline: TimelineItem[]
	bom: BomLine[]
	/** The order's tax and shipping total – a fixed line of the BOM, zero until set. */
	bomTaxShippingUsd: number
	/** Why the parts list cannot change, or null when it can. */
	bomLocked: string | null
	/** Why the project's own fields cannot change, or null when they can. */
	editLocked: string | null
	/** The phase handed in and waiting for a reviewer, which can be taken back. */
	inReview: Phase | null
	/** Why the project cannot be deleted, or null when it can. */
	deleteBlocked: string | null
	/** The phases that have left draft, for the review-state block. */
	phases: PhaseReview[]
	/** Whether devlogs and the parts list are mirrored into the repo, and where. */
	repoSync: RepoSyncState
}

const SESSION_SELECT = {
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
} satisfies Prisma.WorkSessionSelect

const POST_SELECT = {
	id: true,
	caption: true,
	objectKey: true,
	thumbnailKey: true,
	status: true,
	createdAt: true,
	publishedAt: true,
} satisfies Prisma.PostSelect

function sessionItem(s: Prisma.WorkSessionGetPayload<{ select: typeof SESSION_SELECT }>): TimelineItem {
	return {
		kind: "session",
		id: s.id,
		at: s.createdAt.getTime(),
		phase: s.phase,
		hours: s.hoursClaimed,
		approvedHours: s.hoursApproved !== null && s.hoursApproved !== s.hoursClaimed ? s.hoursApproved : null,
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
	}
}

function reelItem(p: Prisma.PostGetPayload<{ select: typeof POST_SELECT }>): TimelineItem {
	return {
		kind: "reel",
		id: p.id,
		at: (p.publishedAt ?? p.createdAt).getTime(),
		caption: p.caption,
		videoUrl: publicUrlFor(p.objectKey),
		thumbnailUrl: publicUrlFor(p.thumbnailKey),
		status: p.status,
	}
}

export async function getProjectPage(userId: string, id: string): Promise<ProjectPageData | null> {
	const project = await prisma.themeProject.findFirst({
		where: { id, userId, deletedAt: null },
		select: {
			id: true,
			grantEmittedAt: true,
			coverImageKey: true,
			bomTaxShippingUsd: true,
			designStatus: true,
			buildStatus: true,
			designReviewComments: true,
			buildReviewComments: true,
			designReviewedAt: true,
			buildReviewedAt: true,
			workSessions: { where: { deletedAt: null }, select: SESSION_SELECT },
			posts: {
				// Their own reels, including one a moderator took out of the feed – the author still sees those, as the feed's own rule has it.
				where: { deletedAt: null, userId, status: { not: PostStatus.REMOVED } },
				select: POST_SELECT,
			},
			submissions: {
				select: {
					id: true,
					phase: true,
					createdAt: true,
					resolvedAt: true,
					resolvedResult: true,
					ariShipError: true,
					dispute: { select: { createdAt: true, resolvedAt: true } },
				},
			},
		},
	})
	if (!project) return null

	const timeline: TimelineItem[] = [...project.workSessions.map(sessionItem), ...project.posts.map(reelItem)]

	// A resolved submission is two moments – handed in, then decided – and the gap between them is part of the story. Only the latest decision per phase has comments on the project row, so older ones are shown without them.
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
		project.designStatus === PhaseStatus.in_review
			? Phase.DESIGN
			: project.buildStatus === PhaseStatus.in_review
				? Phase.BUILD
				: null

	// Both phases, in order, but only the ones that have left draft – a fresh project's page should not carry a "not started" row for each week.
	const phases: PhaseReview[] = ([Phase.DESIGN, Phase.BUILD] as const)
		.map((phase) => {
			const isDesign = phase === Phase.DESIGN
			const latest = project.submissions
				.filter((s) => s.phase === phase)
				.reduce<Date | null>((at, s) => (!at || s.createdAt > at ? s.createdAt : at), null)
			const disputed = project.submissions
				.filter((s) => s.phase === phase && s.dispute)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
			// Only an open hand-in can be stuck: one that was decided had its marker cleared by the send that succeeded, and one that was withdrawn was deleted outright.
			const openShip = project.submissions
				.filter((s) => s.phase === phase && s.resolvedAt === null)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
			return {
				phase,
				status: isDesign ? project.designStatus : project.buildStatus,
				comments: isDesign ? project.designReviewComments : project.buildReviewComments,
				submittedAt: latest?.getTime() ?? null,
				reviewedAt: (isDesign ? project.designReviewedAt : project.buildReviewedAt)?.getTime() ?? null,
				disputedAt: disputed?.dispute?.createdAt.getTime() ?? null,
				disputeResolved: Boolean(disputed?.dispute?.resolvedAt),
				shipError: openShip?.ariShipError ?? null,
			}
		})
		.filter((p) => p.status !== PhaseStatus.draft || p.submittedAt !== null)

	return {
		coverImageUrl: publicUrlFor(project.coverImageKey),
		fallbackThumbnail: projectThumbnail(
			null,
			project.workSessions,
			project.posts.map((p) => ({
				createdAt: p.createdAt,
				thumbnailUrl: publicUrlFor(p.thumbnailKey),
				videoUrl: publicUrlFor(p.objectKey),
			})),
		),
		timeline,
		bom: await listBom(project.id),
		bomTaxShippingUsd: project.bomTaxShippingUsd ?? 0,
		bomLocked: bomLockReason(project),
		editLocked: inReview ? "In review, so it can't be edited. Unsubmit to change it" : null,
		inReview,
		deleteBlocked: await deleteBlockReason(project),
		phases,
		repoSync: await getRepoSyncState(project.id, userId),
	}
}

/**
 * Someone else's project, as Explore's "See more" opens it.
 *
 * Only what is already public elsewhere: the entries Explore shows, the reels the Doomscroller shows (published ones – a hidden or processing reel is nobody's business but its author's), and the project's name and picture. No parts list, no repo checks, no review comments, no submissions: those are between the maker and their reviewer. Author by display name only, as lib/queries/community has it.
 */
export interface PublicProjectData {
	id: string
	title: string
	description: string
	author: string
	/** The author's user id, so their name can open their profile. */
	authorId: string
	/** 1-based design week the theme runs in, or 0 for a warm-up project. */
	weekId: number
	thumbnail: ProjectThumbnail | null
	timeline: TimelineItem[]
}

export async function getPublicProjectPage(id: string): Promise<PublicProjectData | null> {
	const project = await prisma.themeProject.findFirst({
		// A row nobody has started is a placeholder made at sign-up, not a project.
		where: { id, deletedAt: null, namedAt: { not: null } },
		select: {
			id: true,
			theme: true,
			title: true,
			description: true,
			coverImageKey: true,
			user: { select: { id: true, name: true, displayName: true } },
			workSessions: { where: { deletedAt: null }, select: SESSION_SELECT },
			posts: {
				where: { deletedAt: null, status: PostStatus.PUBLISHED },
				select: POST_SELECT,
			},
		},
	})
	if (!project) return null

	const themeIndex = THEMES.findIndex((t) => t.id === project.theme)
	const timeline = [...project.workSessions.map(sessionItem), ...project.posts.map(reelItem)]
	timeline.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))

	return {
		id: project.id,
		title: project.title,
		description: project.description ?? "",
		author: displayName(project.user, "A maker"),
		authorId: project.user.id,
		weekId: themeIndex === -1 ? WARMUP_WEEK_ID : themeIndex + 1,
		thumbnail: projectThumbnail(
			publicUrlFor(project.coverImageKey),
			project.workSessions,
			project.posts.map((p) => ({
				createdAt: p.createdAt,
				thumbnailUrl: publicUrlFor(p.thumbnailKey),
				videoUrl: publicUrlFor(p.objectKey),
			})),
		),
		timeline,
	}
}
