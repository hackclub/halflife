import "server-only"
import type { HackatimeLink, Prisma, SessionMedia } from "@/app/generated/prisma/client"
import { Phase } from "@/app/generated/prisma/enums"
import { getThemeDef, projectDisplayTitle } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import { getHoursBreakdown, type HoursBreakdown } from "@/lib/hours"
import prisma from "@/lib/prisma"
import { publicUrlFor } from "@/lib/uploads/r2"

export interface QueueItem {
	claimExpiresAt: Date | null
	claimedBy: { id: string; name: string | null } | null
	/** Whether the claim is still in force. Computed here rather than in a
	 *  component, so rendering stays a pure function of its inputs. */
	claimLive: boolean
	id: string
	onTime: boolean
	// Display name only – the queue is open to every REVIEWER, so maker emails must not be scrapable page by page (M6).
	participant: { id: string; name: string | null }
	phase: Phase
	projectTitle: string
	submittedAt: Date
	submittedInWeek: number | null
	themeLabel: string
	themeProjectId: string
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
		// Nobody reviews their own work, so it should never show up as something to act on. The decision path refuses it too – this is so the queue counts are honest, not the enforcement.
		themeProject: { deletedAt: null, userId: { not: opts.reviewerId } },
	}

	const [rows, designCount, buildCount] = await Promise.all([
		prisma.phaseSubmission.findMany({
			// Oldest first: a review queue that surfaces the newest work leaves the people who submitted first waiting longest.
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			take: opts.limit + 1,
			where,
			...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
			include: {
				claim: { include: { reviewer: { select: { displayName: true, id: true, name: true } } } },
				themeProject: {
					select: {
						id: true,
						theme: true,
						tier: true,
						title: true,
						user: { select: { displayName: true, id: true, name: true } },
					},
				},
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
		counts: { build: buildCount, design: designCount },
		items: page.map(row => ({
			claimExpiresAt: row.claim?.expiresAt ?? null,
			claimedBy: row.claim ? { id: row.claim.reviewer.id, name: displayName(row.claim.reviewer) } : null,
			claimLive: !!row.claim && row.claim.expiresAt.getTime() > now,
			id: row.id,
			onTime: row.onTime,
			participant: { ...row.themeProject.user, name: displayName(row.themeProject.user) },
			phase: row.phase,
			projectTitle: row.themeProject.title,
			submittedAt: row.createdAt,
			submittedInWeek: row.submittedInWeek,
			themeLabel: getThemeDef(row.themeProject.theme).label,
			themeProjectId: row.themeProject.id,
			tier: row.themeProject.tier,
		})),
		nextCursor: hasMore && last ? last.id : null,
	}
}

/** The submission row with everything its review page renders: project, maker, claim, dispute and reviews. */
export type SubmissionDetail = Prisma.PhaseSubmissionGetPayload<{ include: typeof submissionDetailInclude }>

/** A devlog session with its evidence resolved to URLs for the review page. */
export interface ReviewSession
	extends Omit<Prisma.WorkSessionGetPayload<{ include: { media: true; timelapses: true } }>, "media"> {
	media: (SessionMedia & { url: string | null })[]
}

/** A prior decision on any of the project's submissions: who wrote it and which phase it decided. */
export type PriorReview = Prisma.SubmissionReviewGetPayload<{
	include: { reviewer: { select: { name: true; displayName: true } }; submission: { select: { phase: true } } }
}>

/** Everything the review page renders for one submission. */
export interface SubmissionDetailView {
	breakdown: HoursBreakdown
	claimLive: boolean
	coverImageUrl: string | null
	links: HackatimeLink[]
	priorReviews: PriorReview[]
	sessions: ReviewSession[]
	submission: SubmissionDetail
	themeLabel: string
}

const submissionDetailInclude = {
	claim: { include: { reviewer: { select: { displayName: true, id: true, name: true } } } },
	dispute: {
		include: {
			messages: {
				include: { author: { select: { displayName: true, id: true, name: true } } },
				orderBy: { createdAt: "asc" },
			},
		},
	},
	reviews: {
		include: { reviewer: { select: { displayName: true, id: true, name: true } } },
		orderBy: { createdAt: "desc" },
	},
	themeProject: {
		include: {
			user: {
				select: {
					displayName: true,
					email: true,
					fraudFlagged: true,
					id: true,
					name: true,
					slackId: true,
					verificationStatus: true,
				},
			},
		},
	},
} as const satisfies Prisma.PhaseSubmissionInclude

export async function getSubmissionDetail(
	submissionId: string,
	reviewerId?: string,
	flags?: { includeContact?: boolean; includeRiskFlags?: boolean },
): Promise<SubmissionDetailView | null> {
	const includeContact = flags?.includeContact ?? false
	const includeRiskFlags = flags?.includeRiskFlags ?? false
	const submission = await prisma.phaseSubmission.findUnique({
		include: submissionDetailInclude,
		where: { id: submissionId },
	})
	if (!submission) return null
	// Your own work is not reviewable by you, so it is not visible here either. Null rather than a 403: the review surface should not confirm that this is a submission you merely lack rights over.
	if (reviewerId && submission.themeProject.userId === reviewerId) return null

	// Maker contact + risk flags only for ADMIN/AUDITOR (contact) and REVIEW_HOURS holders (risk flags) – the volume reviewer role gets the work, not the person (M6). Redacted here, before any caller can render or serialize them.
	if (!includeContact || !includeRiskFlags) {
		const maker = submission.themeProject.user as {
			email: string
			slackId: string | null
			verificationStatus: string | null
			fraudFlagged: boolean
		}
		if (!includeContact) {
			maker.email = ""
			maker.slackId = null
		}
		if (!includeRiskFlags) {
			maker.verificationStatus = null
			maker.fraudFlagged = false
		}
	}

	const [breakdown, sessions, links, priorReviews] = await Promise.all([
		getHoursBreakdown(submission.themeProjectId, submission.phase, { live: false }),
		prisma.workSession.findMany({
			include: { media: true, timelapses: true },
			orderBy: { createdAt: "asc" },
			where: {
				deletedAt: null,
				phase: submission.phase,
				themeProjectId: submission.themeProjectId,
			},
		}),
		prisma.hackatimeLink.findMany({
			where: { phase: submission.phase, themeProjectId: submission.themeProjectId },
		}),
		prisma.submissionReview.findMany({
			include: {
				reviewer: { select: { displayName: true, name: true } },
				submission: { select: { phase: true } },
			},
			orderBy: { createdAt: "desc" },
			take: 20,
			where: { submission: { themeProjectId: submission.themeProjectId } },
		}),
	])

	return {
		breakdown,
		claimLive: !!submission.claim && submission.claim.expiresAt.getTime() > Date.now(),
		coverImageUrl: publicUrlFor(submission.themeProject.coverImageKey),
		links,
		priorReviews,
		sessions: sessions.map(s => ({
			...s,
			media: s.media.map(m => ({ ...m, url: publicUrlFor(m.objectKey) })),
		})),
		submission,
		themeLabel: getThemeDef(submission.themeProject.theme).label,
	}
}

export interface OpenDispute {
	createdAt: Date
	id: string
	/** Replies so far, so the panel can say whether a reviewer has answered. */
	messageCount: number
	note: string
	participant: string
	phase: Phase
	projectTitle: string
	submissionId: string
	themeLabel: string
	themeProjectId: string
}

/**
 * Disputes no one has closed yet, oldest first.
 *
 * Surfaced on the program page so a maker asking for a second look is not left waiting on a queue nobody is watching.
 */
export async function getOpenDisputes(): Promise<OpenDispute[]> {
	const rows = await prisma.reviewDispute.findMany({
		orderBy: { createdAt: "asc" },
		select: {
			_count: { select: { messages: true } },
			createdAt: true,
			id: true,
			note: true,
			submission: {
				select: {
					id: true,
					phase: true,
					themeProject: {
						select: {
							id: true,
							theme: true,
							title: true,
							user: { select: { displayName: true, email: true, name: true } },
						},
					},
				},
			},
		},
		where: { resolvedAt: null },
	})

	return rows.map(d => ({
		createdAt: d.createdAt,
		id: d.id,
		messageCount: d._count.messages,
		note: d.note,
		participant: displayName(d.submission.themeProject.user, d.submission.themeProject.user.email),
		phase: d.submission.phase,
		projectTitle: projectDisplayTitle(d.submission.themeProject),
		submissionId: d.submission.id,
		themeLabel: getThemeDef(d.submission.themeProject.theme).label,
		themeProjectId: d.submission.themeProject.id,
	}))
}
