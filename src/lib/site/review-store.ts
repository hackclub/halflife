import "server-only"

import type { Prisma } from "@/app/generated/prisma/client"
import { ReviewPass, type Theme } from "@/app/generated/prisma/enums"
import { THEMES } from "@/lib/config/program"
import prisma from "@/lib/prisma"
import { currentWeekNumber } from "@/lib/program"
import { tallyBoard } from "./leaderboard"

export type ProjectReviewStats = {
	/** Phase submissions handed in since `since`, by `createdAt`. */
	submitted: number
	/** Submissions decided since `since`, by the moment they were decided, whoever decided them – including Ari. */
	reviewed: number
	/**
	 * Who reviewed what, busiest first, keyed by lower-cased email. Email rather than account because Ari's reviewers hold no Half Life account; `"ari"` is Ari's anonymous decisions, which have no address at all. Ties break by key so the order is stable between runs.
	 */
	leaderboard: BoardEntry[]
	/**
	 * The same board over every review on file rather than the last day, so the all-time ranking cannot disagree with the table by whatever the daily runs happened to have fired.
	 */
	globalLeaderboard: BoardEntry[]
	/**
	 * Review progress per started design week, oldest first: how many of the week's named projects have at least one live review. Weeks that have not started yet are omitted, so the section grows with the programme.
	 */
	byWeek: WeekReviewProgress[]
}

/** One row of either board: who (by email), how many, and the name recorded beside the address for display when no account matches it. */
export type BoardEntry = {
	email: string
	reviewed: number
	name: string | null
}

/** The board key for Ari's anonymous decisions: no address, so no email to group by. Named on the board rather than dropped. */
export const ANONYMOUS_ARI = "ari"

/** Lower-cased and trimmed, so `Name@X.com` and `name@x.com` are one reviewer. Null when there is nothing to key on. */
function emailKey(email: string | null | undefined): string | null {
	const key = email?.trim().toLowerCase()
	return key ? key : null
}

/**
 * Who reviewed what, busiest first.
 *
 * Email is the key, not the account: `reviewerId` is null for every Ari decision, so grouping by it dropped them all – which is how both boards printed empty once Ari took over reviewing. A console review carries both; prefer the account's canonical email so one person is one row even if the address recorded at decision time differs in case. Rows with no address at all are counted under Ari rather than dropped.
 */
function reviewerBoard(
	rows: { reviewerId: string | null; reviewerEmail: string | null; reviewerName: string | null }[],
	usersById: Map<string, { email: string }>,
): ProjectReviewStats["leaderboard"] {
	const names = new Map<string, string>()
	const keyed = rows.map((row) => {
		const key = emailKey(row.reviewerEmail ?? (row.reviewerId ? usersById.get(row.reviewerId)?.email : null))
		if (key !== null && row.reviewerName && !names.has(key)) names.set(key, row.reviewerName)
		return key
	})
	const anonymous = keyed.filter((key) => key === null).length
	const board: ProjectReviewStats["leaderboard"] = tallyBoard(
		keyed.filter((key) => key !== null),
		(key) => key,
	).map(({ key: email, count: reviewed }) => ({ email, reviewed, name: names.get(email) ?? null }))
	if (anonymous > 0) board.push({ email: ANONYMOUS_ARI, reviewed: anonymous, name: "Ari" })
	return board.sort((a, b) => b.reviewed - a.reviewed || a.email.localeCompare(b.email))
}

/** One design week's review progress: named projects, and how many have at least one live review. */
export type WeekReviewProgress = {
	/** The design week number, 1-5. */
	week: number
	/** The theme's own label, e.g. PCBs. */
	label: string
	/** Distinct named projects with at least one live FINAL review, on either phase. */
	reviewed: number
	/** Distinct named projects. A row nobody named is a slot, not a project – the same rule the admin projects-by-week chart uses. */
	total: number
}

/**
 * Per-week review progress for every design week that has started.
 *
 * "Reviewed" is deliberately looser than a decision: a project counts once it has had any live FINAL review, on design or build, because the bar answers how far reviewing has got through the week's pile rather than what it decided. Un-started weeks are omitted outright rather than shown empty, so a week-one post is one bar, not five with four zeroes.
 */
async function getWeekReviewProgress(): Promise<WeekReviewProgress[]> {
	const now = await currentWeekNumber()
	const started = THEMES.filter((t) => t.designWeek <= now)
	if (started.length === 0) return []
	const themes = started.map((t) => t.id)

	const [projects, reviews] = await Promise.all([
		prisma.themeProject.findMany({
			where: { deletedAt: null, namedAt: { not: null }, theme: { in: themes } },
			select: { theme: true },
		}),
		prisma.submissionReview.findMany({
			where: {
				invalidated: false,
				pass: ReviewPass.FINAL,
				submission: {
					themeProject: { deletedAt: null, namedAt: { not: null }, theme: { in: themes } },
				},
			},
			select: { submission: { select: { themeProjectId: true, themeProject: { select: { theme: true } } } } },
		}),
	])

	const totals = new Map<Theme, number>()
	for (const project of projects) totals.set(project.theme, (totals.get(project.theme) ?? 0) + 1)
	const reviewed = new Map<Theme, Set<string>>()
	for (const review of reviews) {
		const theme = review.submission.themeProject.theme
		let set = reviewed.get(theme)
		if (!set) {
			set = new Set()
			reviewed.set(theme, set)
		}
		set.add(review.submission.themeProjectId)
	}

	return started
		.map((theme) => ({
			week: theme.designWeek,
			label: theme.label,
			reviewed: reviewed.get(theme.id)?.size ?? 0,
			total: totals.get(theme.id) ?? 0,
		}))
		.sort((a, b) => a.week - b.week)
}
/** The counts behind the daily project review summary. `since` is normally 24 hours ago. */
export async function getProjectReviewStats(since: Date): Promise<ProjectReviewStats> {
	const live: Prisma.SubmissionReviewWhereInput = {
		invalidated: false,
		pass: ReviewPass.FINAL,
		submission: { themeProject: { deletedAt: null } },
	}

	const [submitted, reviewRows, allReviewRows, byWeek] = await Promise.all([
		prisma.phaseSubmission.count({ where: { createdAt: { gte: since } } }),
		prisma.submissionReview.findMany({
			where: { ...live, createdAt: { gte: since } },
			select: { reviewerId: true, reviewerEmail: true, reviewerName: true },
		}),
		// Every live review ever, for the all-time board under the daily one.
		prisma.submissionReview.findMany({
			where: live,
			select: { reviewerId: true, reviewerEmail: true, reviewerName: true },
		}),
		getWeekReviewProgress(),
	])

	// Canonical emails for console reviewers, so a decision-time address in a different case still lands on the same row.
	const reviewerIds = [
		...new Set([...reviewRows, ...allReviewRows].flatMap((row) => (row.reviewerId ? [row.reviewerId] : []))),
	]
	const usersById = new Map(
		(
			await prisma.user.findMany({
				where: { id: { in: reviewerIds } },
				select: { id: true, email: true },
			})
		).map((user) => [user.id, { email: user.email }]),
	)

	return {
		submitted,
		reviewed: reviewRows.length,
		leaderboard: reviewerBoard(reviewRows, usersById),
		globalLeaderboard: reviewerBoard(allReviewRows, usersById),
		byWeek,
	}
}
