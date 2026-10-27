import "server-only"
import { and, or } from "@prisma/orm-postgres/orm-client"
import { THEMES } from "@/lib/config/program"
import { PhaseStatus, ReviewPass, type Theme } from "@/lib/enums"
import db from "@/lib/prisma8"
import { currentWeekNumber } from "@/lib/program"
import { DAY_MS, formatDbTimestamp } from "@/lib/time"
import { tallyBoard } from "./leaderboard"

export interface ProjectReviewStats {
	/**
	 * Review progress per started design week, oldest first: how many of the week's submitted projects have at least one live review. Weeks that have not started yet are omitted, so the section grows with the programme.
	 */
	byWeek: WeekReviewProgress[]
	/**
	 * The same board over the last 30 days rather than every review on file. One query, so it cannot disagree with a table of daily runs that happened to be missed.
	 */
	last30DaysLeaderboard: BoardEntry[]
	/**
	 * Who reviewed what, busiest first, keyed by lower-cased email. Email rather than account because Ari's reviewers hold no Half Life account; `"ari"` is Ari's anonymous decisions, which have no address at all. Ties break by key so the order is stable between runs.
	 */
	leaderboard: BoardEntry[]
	/** Submissions decided since `since`, by the moment they were decided, whoever decided them – including Ari. */
	reviewed: number
	/** Phase submissions handed in since `since`, by `createdAt`. */
	submitted: number
}

/** One row of either board: who (by email), how many, and the name recorded beside the address for display when no account matches it. */
export interface BoardEntry {
	email: string
	name: string | null
	reviewed: number
}

/** The board key for Ari's anonymous decisions: no address, so no email to group by. Named on the board rather than dropped. */
export const ANONYMOUS_ARI = "ari"

/**
 * Ari attributes its automated decisions to this address. It is not a person, so it never takes a place on a board: ranked under its own email it outranked every human reviewer with work nobody did, which is what pushed `system@ari` to the top of the leaderboard.
 */
export const SYSTEM_ARI = "system@ari"

/** Lower-cased and trimmed, so `Name@X.com` and `name@x.com` are one reviewer. Null when there is nothing to key on. */
function emailKey(email: string | null | undefined): string | null {
	const key = email?.trim().toLowerCase()
	return key ? key : null
}

/**
 * Who reviewed what, busiest first.
 *
 * Email is the key, not the account: `reviewerId` is null for every Ari decision, so grouping by it dropped them all – which is how both boards printed empty once Ari took over reviewing. A console review carries both; prefer the account's canonical email so one person is one row even if the address recorded at decision time differs in case. Rows with no address at all are counted under Ari rather than dropped; rows under Ari's automated address are not counted at all, since a sentinel is not a reviewer.
 */
function reviewerBoard(
	rows: { reviewerId: string | null; reviewerEmail: string | null; reviewerName: string | null }[],
	usersById: Map<string, { email: string }>,
): ProjectReviewStats["leaderboard"] {
	const names = new Map<string, string>()
	const keyed = rows.map(row => {
		const key = emailKey(row.reviewerEmail ?? (row.reviewerId ? usersById.get(row.reviewerId)?.email : null))
		if (key !== null && row.reviewerName && !names.has(key)) names.set(key, row.reviewerName)
		return key
	})
	const anonymous = keyed.filter(key => key === null).length
	const board: ProjectReviewStats["leaderboard"] = tallyBoard(
		keyed.filter(key => key !== null && key !== SYSTEM_ARI),
		key => key,
	).map(({ key: email, count: reviewed }) => ({ email, name: names.get(email) ?? null, reviewed }))
	if (anonymous > 0) board.push({ email: ANONYMOUS_ARI, name: "Ari", reviewed: anonymous })
	return board.toSorted((a, b) => b.reviewed - a.reviewed || a.email.localeCompare(b.email))
}

/** One design week's review progress: named projects, and how many have at least one live review. */
export interface WeekReviewProgress {
	/** The theme's own label, e.g. PCBs. */
	label: string
	/** Distinct named projects with at least one live FINAL review, on either phase. */
	reviewed: number
	/** Distinct named projects that have been submitted – a phase has left draft – the same rule the admin projects-by-week chart uses. A row nobody named is a slot, not a project. */
	total: number
	/** The design week number, 1-5. */
	week: number
}

/**
 * Per-week review progress for every design week that has started.
 *
 * "Reviewed" is deliberately looser than a decision: a project counts once it has had any live FINAL review, on design or build, because the bar answers how far reviewing has got through the week's pile rather than what it decided. `total` is only the projects that have joined that pile – a named project whose phases are all still drafts has not been handed in and is not waiting on a reviewer, so counting it made every bar read as a fraction of sign-ups rather than progress through submitted work. Un-started weeks are omitted outright rather than shown empty, so a week-one post is one bar, not five with four zeroes.
 */
async function getWeekReviewProgress(): Promise<WeekReviewProgress[]> {
	const now = await currentWeekNumber()
	const started = THEMES.filter(t => t.designWeek <= now)
	if (started.length === 0) return []
	const themes = started.map(t => t.id)

	// The same threshold the admin projects-by-week chart uses: a phase enters a week's pile the first time it is submitted and stops being a draft.
	const submitted = db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project => project.namedAt.isNotNull())
		.where(project => or(project.designStatus.neq(PhaseStatus.draft), project.buildStatus.neq(PhaseStatus.draft)))
		.where(project => project.theme.in(themes))
	const [projects, reviews] = await Promise.all([
		submitted.select("theme").all(),
		db.orm.public.SubmissionReview.where({ invalidated: false, pass: ReviewPass.FINAL })
			.where(review =>
				review.submission.some(submission =>
					and(
						submission.themeProject.some(project =>
							and(
								project.deletedAt.isNull(),
								project.namedAt.isNotNull(),
								or(project.designStatus.neq(PhaseStatus.draft), project.buildStatus.neq(PhaseStatus.draft)),
								project.theme.in(themes),
							),
						),
					),
				),
			)
			.select("id")
			.include("submission", submission =>
				submission.select("themeProjectId").include("themeProject", project => project.select("theme")),
			)
			.all(),
	])

	const totals = new Map<Theme, number>()
	for (const project of projects) totals.set(project.theme, (totals.get(project.theme) ?? 0) + 1)
	const reviewed = new Map<Theme, Set<string>>()
	for (const review of reviews) {
		const themeProject = review.submission?.themeProject
		if (!themeProject) continue
		let set = reviewed.get(themeProject.theme)
		if (!set) {
			set = new Set()
			reviewed.set(themeProject.theme, set)
		}
		if (review.submission) set.add(review.submission.themeProjectId)
	}

	return started
		.map(theme => ({
			label: theme.label,
			reviewed: reviewed.get(theme.id)?.size ?? 0,
			total: totals.get(theme.id) ?? 0,
			week: theme.designWeek,
		}))
		.toSorted((a, b) => a.week - b.week)
}
/** The counts behind the daily project review summary. `since` is normally 24 hours ago; `now` anchors the rolling 30-day board to the same moment. */
export async function getProjectReviewStats(since: Date, now: Date = new Date()): Promise<ProjectReviewStats> {
	const sinceText = formatDbTimestamp(since)
	const boardSinceText = formatDbTimestamp(new Date(now.getTime() - 30 * DAY_MS))
	const [submitted, reviewRows, recentReviewRows, byWeek] = await Promise.all([
		db.orm.public.PhaseSubmission.where(submission => submission.createdAt.gte(sinceText)).aggregate(a => ({
			count: a.count(),
		})),
		db.orm.public.SubmissionReview.where({ invalidated: false, pass: ReviewPass.FINAL })
			.where(review => review.createdAt.gte(sinceText))
			.select("reviewerEmail", "reviewerId", "reviewerName")
			.all(),
		// The last 30 days, for the rolling board under the daily one.
		db.orm.public.SubmissionReview.where({ invalidated: false, pass: ReviewPass.FINAL })
			.where(review => review.createdAt.gte(boardSinceText))
			.select("reviewerEmail", "reviewerId", "reviewerName")
			.all(),
		getWeekReviewProgress(),
	])

	// Canonical emails for console reviewers, so a decision-time address in a different case still lands on the same row.
	const reviewerIds = [
		...new Set([...reviewRows, ...recentReviewRows].flatMap(row => (row.reviewerId ? [row.reviewerId] : []))),
	]
	const usersById = new Map(
		(
			await db.orm.public.User.where(user => user.id.in(reviewerIds))
				.select("email", "id")
				.all()
		).map(user => [user.id, { email: user.email }]),
	)

	return {
		byWeek,
		last30DaysLeaderboard: reviewerBoard(recentReviewRows, usersById),
		leaderboard: reviewerBoard(reviewRows, usersById),
		reviewed: reviewRows.length,
		submitted: submitted.count,
	}
}
