import "server-only"
import { Phase } from "@/app/generated/prisma/enums"
import { getThemeDef } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import { getHoursBreakdown } from "@/lib/hours"
import prisma from "@/lib/prisma"
import { publicUrlFor } from "@/lib/uploads/r2"

export interface QueueItem {
	id: string
	themeProjectId: string
	phase: Phase
	themeLabel: string
	projectTitle: string
	// Display name only – the queue is open to every REVIEWER, so maker
	// emails must not be scrapable page by page (M6).
	participant: { id: string; name: string | null }
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
		// to act on. The decision path refuses it too – this is so the queue
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
						user: { select: { id: true, name: true, displayName: true } },
					},
				},
				claim: { include: { reviewer: { select: { id: true, name: true, displayName: true } } } },
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
			participant: { ...row.themeProject.user, name: displayName(row.themeProject.user) },
			submittedAt: row.createdAt,
			submittedInWeek: row.submittedInWeek,
			onTime: row.onTime,
			claimedBy: row.claim ? { id: row.claim.reviewer.id, name: displayName(row.claim.reviewer) } : null,
			claimExpiresAt: row.claim?.expiresAt ?? null,
			claimLive: !!row.claim && row.claim.expiresAt.getTime() > now,
			tier: row.themeProject.tier,
		})),
		nextCursor: hasMore && last ? last.id : null,
		counts: { design: designCount, build: buildCount },
	}
}

export async function getSubmissionDetail(
	submissionId: string,
	reviewerId?: string,
	flags?: { includeContact?: boolean; includeRiskFlags?: boolean },
) {
	const includeContact = flags?.includeContact ?? false
	const includeRiskFlags = flags?.includeRiskFlags ?? false
	const submission = await prisma.phaseSubmission.findUnique({
		where: { id: submissionId },
		include: {
			themeProject: {
				include: {
					user: {
						select: {
							id: true,
							name: true,
							displayName: true,
							email: true,
							slackId: true,
							verificationStatus: true,
							fraudFlagged: true,
						},
					},
				},
			},
			claim: { include: { reviewer: { select: { id: true, name: true, displayName: true } } } },
			dispute: true,
			reviews: {
				orderBy: { createdAt: "desc" },
				include: { reviewer: { select: { id: true, name: true, displayName: true } } },
			},
		},
	})
	if (!submission) return null
	// Your own work is not reviewable by you, so it is not visible here either.
	// Null rather than a 403: the review surface should not confirm that this is
	// a submission you merely lack rights over.
	if (reviewerId && submission.themeProject.userId === reviewerId) return null

	// Maker contact + risk flags only for ADMIN/AUDITOR (contact) and
	// REVIEW_HOURS holders (risk flags) – the volume reviewer role gets the
	// work, not the person (M6). Redacted here, before any caller can render
	// or serialize them.
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
				reviewer: { select: { name: true, displayName: true } },
				submission: { select: { phase: true } },
			},
		}),
	])

	return {
		submission,
		claimLive: !!submission.claim && submission.claim.expiresAt.getTime() > Date.now(),
		themeLabel: getThemeDef(submission.themeProject.theme).label,
		coverImageUrl: publicUrlFor(submission.themeProject.coverImageKey),
		breakdown,
		sessions: sessions.map((s) => ({
			...s,
			media: s.media.map((m) => ({ ...m, url: publicUrlFor(m.objectKey) })),
		})),
		links,
		priorReviews,
	}
}

export interface OpenDispute {
	id: string
	note: string
	createdAt: Date
	phase: Phase
	submissionId: string
	themeProjectId: string
	projectTitle: string
	themeLabel: string
	participant: string
}

/**
 * Disputes no one has closed yet, oldest first.
 *
 * Surfaced on the program page so a maker asking for a second look is not left
 * waiting on a queue nobody is watching.
 */
export async function getOpenDisputes(): Promise<OpenDispute[]> {
	const rows = await prisma.reviewDispute.findMany({
		where: { resolvedAt: null },
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			note: true,
			createdAt: true,
			submission: {
				select: {
					id: true,
					phase: true,
					themeProject: {
						select: {
							id: true,
							title: true,
							theme: true,
							user: { select: { name: true, displayName: true, email: true } },
						},
					},
				},
			},
		},
	})

	return rows.map((d) => ({
		id: d.id,
		note: d.note,
		createdAt: d.createdAt,
		phase: d.submission.phase,
		submissionId: d.submission.id,
		themeProjectId: d.submission.themeProject.id,
		projectTitle: d.submission.themeProject.title.trim() || getThemeDef(d.submission.themeProject.theme).label,
		themeLabel: getThemeDef(d.submission.themeProject.theme).label,
		participant: displayName(d.submission.themeProject.user, d.submission.themeProject.user.email),
	}))
}
