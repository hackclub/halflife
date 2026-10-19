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
	coveredSeconds: number | null
	/** Where to watch it: Lapse's own page, or the uploaded file. */
	href: string | null
	id: string
	thumbnailUrl: string | null
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

/** One message in a dispute thread, from the maker who raised it or a reviewer answering. */
export interface DisputeMessage {
	/** Epoch ms. */
	at: number
	body: string
	/** A reviewer wrote it, as opposed to the maker who raised the dispute. */
	fromReviewer: boolean
	id: string
}

/** A maker's dispute on a phase's latest decision, with the thread under it. */
export interface PhaseDispute {
	/** Epoch ms. */
	at: number
	id: string
	messages: DisputeMessage[]
	/** The maker's opening words. */
	note: string
	/** How a reviewer ended it, or null while it is still open. */
	outcome: "upheld" | "stood" | null
	/** Epoch ms, or null while open. */
	resolvedAt: number | null
}

/** One phase's review state, for the block above the repo checks. */
export interface PhaseReview {
	/** The reviewer's note on the latest decision, if any. */
	comments: string | null
	/** The maker's dispute on the latest decision, with its thread, if they raised one. */
	dispute: PhaseDispute | null
	phase: Phase
	/** When it was decided, epoch ms. */
	reviewedAt: number | null
	/** Why the maker's open hand-in never reached Ari, when it did not. Null once it has, or when there is no open hand-in. */
	shipError: string | null
	status: PhaseStatus
	/** When the latest submission for this phase was handed in, epoch ms. */
	submittedAt: number | null
}

export interface ProjectPageData {
	bom: BomLine[]
	/** Why the parts list cannot change, or null when it can. */
	bomLocked: string | null
	/** The order's tax and shipping total – a fixed line of the BOM, zero until set. */
	bomTaxShippingUsd: number
	/** The thumbnail the maker chose, if any. */
	coverImageUrl: string | null
	/** Why the project cannot be deleted, or null when it can. */
	deleteBlocked: string | null
	/** Why the project's own fields cannot change, or null when they can. */
	editLocked: string | null
	/** What stands in until they choose one: a journal image, then a reel frame. */
	fallbackThumbnail: ProjectThumbnail | null
	/** The phase handed in and waiting for a reviewer, which can be taken back. */
	inReview: Phase | null
	/** The phases that have left draft, for the review-state block. */
	phases: PhaseReview[]
	/** Whether devlogs and the parts list are mirrored into the repo, and where. */
	repoSync: RepoSyncState
	timeline: TimelineItem[]
}

const SESSION_SELECT = {
	content: true,
	createdAt: true,
	hoursApproved: true,
	hoursClaimed: true,
	id: true,
	phase: true,
	timelapses: {
		orderBy: { createdAt: "asc" },
		select: {
			coveredSeconds: true,
			externalId: true,
			id: true,
			objectKey: true,
			playbackUrl: true,
			provider: true,
			thumbnailUrl: true,
		},
	},
	title: true,
} satisfies Prisma.WorkSessionSelect

const POST_SELECT = {
	caption: true,
	createdAt: true,
	id: true,
	objectKey: true,
	publishedAt: true,
	status: true,
	thumbnailKey: true,
} satisfies Prisma.PostSelect

function sessionItem(s: Prisma.WorkSessionGetPayload<{ select: typeof SESSION_SELECT }>): TimelineItem {
	return {
		approvedHours: s.hoursApproved !== null && s.hoursApproved !== s.hoursClaimed ? s.hoursApproved : null,
		at: s.createdAt.getTime(),
		body: s.content ?? s.title,
		hours: s.hoursClaimed,
		id: s.id,
		kind: "session",
		lapses: s.timelapses.map(t => ({
			coveredSeconds: t.coveredSeconds,
			href:
				t.provider === "lapse" && t.externalId
					? lapseTimelapseUrl(t.externalId)
					: (t.playbackUrl ?? publicUrlFor(t.objectKey)),
			id: t.id,
			thumbnailUrl: t.thumbnailUrl,
		})),
		phase: s.phase,
	}
}

function reelItem(p: Prisma.PostGetPayload<{ select: typeof POST_SELECT }>): TimelineItem {
	return {
		at: (p.publishedAt ?? p.createdAt).getTime(),
		caption: p.caption,
		id: p.id,
		kind: "reel",
		status: p.status,
		thumbnailUrl: publicUrlFor(p.thumbnailKey),
		videoUrl: publicUrlFor(p.objectKey),
	}
}

export async function getProjectPage(userId: string, id: string): Promise<ProjectPageData | null> {
	const project = await prisma.themeProject.findFirst({
		select: {
			bomTaxShippingUsd: true,
			buildReviewComments: true,
			buildReviewedAt: true,
			buildStatus: true,
			coverImageKey: true,
			designReviewComments: true,
			designReviewedAt: true,
			designStatus: true,
			grantEmittedAt: true,
			id: true,
			posts: {
				select: POST_SELECT,
				// Their own reels, including one a moderator took out of the feed – the author still sees those, as the feed's own rule has it.
				where: { deletedAt: null, status: { not: PostStatus.REMOVED }, userId },
			},
			submissions: {
				select: {
					ariShipError: true,
					createdAt: true,
					dispute: {
						select: {
							createdAt: true,
							id: true,
							messages: {
								orderBy: { createdAt: "asc" },
								select: { body: true, createdAt: true, fromReviewer: true, id: true },
							},
							note: true,
							outcome: true,
							resolvedAt: true,
						},
					},
					id: true,
					phase: true,
					resolvedAt: true,
					resolvedResult: true,
				},
			},
			workSessions: { select: SESSION_SELECT, where: { deletedAt: null } },
		},
		where: { deletedAt: null, id, userId },
	})
	if (!project) return null

	const timeline: TimelineItem[] = [...project.workSessions.map(sessionItem), ...project.posts.map(reelItem)]

	// A resolved submission is two moments – handed in, then decided – and the gap between them is part of the story. Only the latest decision per phase has comments on the project row, so older ones are shown without them.
	const latestResolved = new Map<Phase, string>()
	for (const sub of [...project.submissions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
		timeline.push({ at: sub.createdAt.getTime(), id: `${sub.id}-in`, kind: "submitted", phase: sub.phase })
		if (sub.resolvedAt && sub.resolvedResult) latestResolved.set(sub.phase, sub.id)
	}
	for (const sub of project.submissions) {
		if (!sub.resolvedAt || !sub.resolvedResult) continue
		const latest = latestResolved.get(sub.phase) === sub.id
		timeline.push({
			at: sub.resolvedAt.getTime(),
			comments: latest
				? sub.phase === Phase.DESIGN
					? project.designReviewComments
					: project.buildReviewComments
				: null,
			id: `${sub.id}-out`,
			kind: "reviewed",
			phase: sub.phase,
			result: sub.resolvedResult,
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
		.map(phase => {
			const isDesign = phase === Phase.DESIGN
			const latest = project.submissions
				.filter(s => s.phase === phase)
				.reduce<Date | null>((at, s) => (!at || s.createdAt > at ? s.createdAt : at), null)
			const disputed = project.submissions
				.filter(s => s.phase === phase && s.dispute)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.dispute
			// Only an open hand-in can be stuck: one that was decided had its marker cleared by the send that succeeded, and one that was withdrawn was deleted outright.
			const openShip = project.submissions
				.filter(s => s.phase === phase && s.resolvedAt === null)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
			return {
				comments: isDesign ? project.designReviewComments : project.buildReviewComments,
				dispute: disputed
					? {
							at: disputed.createdAt.getTime(),
							id: disputed.id,
							messages: disputed.messages.map(m => ({
								at: m.createdAt.getTime(),
								body: m.body,
								fromReviewer: m.fromReviewer,
								id: m.id,
							})),
							note: disputed.note,
							outcome: disputed.outcome,
							resolvedAt: disputed.resolvedAt?.getTime() ?? null,
						}
					: null,
				phase,
				reviewedAt: (isDesign ? project.designReviewedAt : project.buildReviewedAt)?.getTime() ?? null,
				shipError: openShip?.ariShipError ?? null,
				status: isDesign ? project.designStatus : project.buildStatus,
				submittedAt: latest?.getTime() ?? null,
			}
		})
		.filter(p => p.status !== PhaseStatus.draft || p.submittedAt !== null)

	return {
		bom: await listBom(project.id),
		bomLocked: bomLockReason(project),
		bomTaxShippingUsd: project.bomTaxShippingUsd ?? 0,
		coverImageUrl: publicUrlFor(project.coverImageKey),
		deleteBlocked: await deleteBlockReason(project),
		editLocked: inReview ? "In review, so it can't be edited. Unsubmit to change it" : null,
		fallbackThumbnail: projectThumbnail(
			null,
			project.workSessions,
			project.posts.map(p => ({
				createdAt: p.createdAt,
				thumbnailUrl: publicUrlFor(p.thumbnailKey),
				videoUrl: publicUrlFor(p.objectKey),
			})),
		),
		inReview,
		phases,
		repoSync: await getRepoSyncState(project.id, userId),
		timeline,
	}
}

/**
 * Someone else's project, as Explore's "See more" opens it.
 *
 * Only what is already public elsewhere: the entries Explore shows, the reels the Doomscroller shows (published ones – a hidden or processing reel is nobody's business but its author's), and the project's name and picture. No parts list, no repo checks, no review comments, no submissions: those are between the maker and their reviewer. Author by display name only, as lib/queries/community has it.
 */
export interface PublicProjectData {
	author: string
	/** The author's user id, so their name can open their profile. */
	authorId: string
	description: string
	id: string
	thumbnail: ProjectThumbnail | null
	timeline: TimelineItem[]
	title: string
	/** 1-based design week the theme runs in, or 0 for a warm-up project. */
	weekId: number
}

/** A dispute still waiting on a reviewer, as the public project page offers the way back to it. */
export interface ProjectOpenDispute {
	phase: Phase
	/** The review console page that carries the thread. */
	submissionId: string
}

/**
 * The open disputes on a project, if there are any.
 *
 * Read only for a reviewer looking at someone else's project: the review console is where a dispute is answered, so the project page needs each submission id to open it. The maker's own page already carries the threads themselves and never calls this.
 */
export async function getOpenDisputesForProject(projectId: string): Promise<ProjectOpenDispute[]> {
	const submissions = await prisma.phaseSubmission.findMany({
		orderBy: { createdAt: "asc" },
		select: { id: true, phase: true },
		where: { dispute: { is: { resolvedAt: null } }, themeProjectId: projectId },
	})
	return submissions.map(submission => ({ phase: submission.phase, submissionId: submission.id }))
}

export async function getPublicProjectPage(id: string): Promise<PublicProjectData | null> {
	const project = await prisma.themeProject.findFirst({
		select: {
			coverImageKey: true,
			description: true,
			id: true,
			posts: {
				select: POST_SELECT,
				where: { deletedAt: null, status: PostStatus.PUBLISHED },
			},
			theme: true,
			title: true,
			user: { select: { displayName: true, id: true, name: true } },
			workSessions: { select: SESSION_SELECT, where: { deletedAt: null } },
		},
		// A row nobody has started is a placeholder made at sign-up, not a project.
		where: { deletedAt: null, id, namedAt: { not: null } },
	})
	if (!project) return null

	const themeIndex = THEMES.findIndex(t => t.id === project.theme)
	const timeline = [...project.workSessions.map(sessionItem), ...project.posts.map(reelItem)]
	timeline.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))

	return {
		author: displayName(project.user, "A maker"),
		authorId: project.user.id,
		description: project.description ?? "",
		id: project.id,
		thumbnail: projectThumbnail(
			publicUrlFor(project.coverImageKey),
			project.workSessions,
			project.posts.map(p => ({
				createdAt: p.createdAt,
				thumbnailUrl: publicUrlFor(p.thumbnailKey),
				videoUrl: publicUrlFor(p.objectKey),
			})),
		),
		timeline,
		title: project.title,
		weekId: themeIndex === -1 ? WARMUP_WEEK_ID : themeIndex + 1,
	}
}
