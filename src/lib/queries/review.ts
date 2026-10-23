import "server-only"
import { and } from "@prisma/orm-postgres/orm-client"
import type { HackatimeLink, Prisma, SessionMedia } from "@/app/generated/prisma/client"
import { Phase } from "@/app/generated/prisma/enums"
import { getThemeDef, projectDisplayTitle } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import { getHoursBreakdown, type HoursBreakdown } from "@/lib/hours"
import { encodeCursor, readCursor } from "@/lib/pagination"
import prisma from "@/lib/prisma"
import db from "@/lib/prisma8"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"
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
	const base = db.orm.public.PhaseSubmission.where({ resolvedAt: null }).where(submission =>
		// Nobody reviews their own work, so it should never show up as something to act on. The decision path refuses it too – this is so the queue counts are honest, not the enforcement.
		submission.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.neq(opts.reviewerId))),
	)
	const filtered = opts.phase ? base.where({ phase: opts.phase }) : base
	const position = readCursor(opts.cursor)
	// Oldest first: a review queue that surfaces the newest work leaves the people who submitted first waiting longest.
	const ordered = filtered.orderBy([submission => submission.createdAt.asc(), submission => submission.id.asc()])
	// The queue is rendered as a page as well as served as an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
	const paged = position?.at
		? ordered.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id })
		: ordered
	const [rows, design, build] = await Promise.all([
		paged
			.limit(opts.limit + 1)
			.include("claim", claim =>
				claim.select("expiresAt").include("reviewer", reviewer => reviewer.select("displayName", "id", "name")),
			)
			.include("themeProject", project =>
				project
					.select("id", "theme", "tier", "title")
					.include("user", user => user.select("displayName", "id", "name")),
			)
			.all(),
		filtered.where({ phase: Phase.DESIGN }).aggregate(a => ({ count: a.count() })),
		filtered.where({ phase: Phase.BUILD }).aggregate(a => ({ count: a.count() })),
	])

	const items = rows.slice(0, opts.limit)
	const last = items.at(-1)
	const now = Date.now()

	return {
		counts: { build: build.count, design: design.count },
		items: items.map(row => {
			const project = row.themeProject
			if (!project) throw new Error(`submission ${row.id} has no project`)
			const user = project.user
			if (!user) throw new Error(`submission ${row.id} has no author`)
			const reviewer = row.claim?.reviewer ?? null
			if (row.claim && !reviewer) throw new Error(`submission ${row.id} has a claim with no reviewer`)
			const expiresAt = row.claim ? parseDbTimestamp(row.claim.expiresAt) : null
			return {
				claimExpiresAt: expiresAt,
				claimedBy: reviewer ? { id: reviewer.id, name: displayName(reviewer) } : null,
				claimLive: expiresAt !== null && expiresAt.getTime() > now,
				id: row.id,
				onTime: row.onTime,
				participant: { id: user.id, name: displayName(user) },
				phase: row.phase,
				projectTitle: project.title,
				submittedAt: parseDbTimestamp(row.createdAt),
				submittedInWeek: row.submittedInWeek,
				themeLabel: getThemeDef(project.theme).label,
				themeProjectId: project.id,
				tier: project.tier,
			}
		}),
		nextCursor:
			rows.length > opts.limit && last ? encodeCursor({ at: parseDbTimestamp(last.createdAt), id: last.id }) : null,
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
		claimLive: submission.claim !== null && submission.claim.expiresAt.getTime() > Date.now(),
		coverImageUrl: publicUrlFor(submission.themeProject.coverImageKey),
		links,
		priorReviews,
		sessions: sessions.map(s =>
			Object.assign({}, s, {
				media: s.media.map(m => Object.assign({}, m, { url: publicUrlFor(m.objectKey) })),
			}),
		),
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
