import "server-only"
import { HoursSource } from "@/app/generated/prisma/enums"
import { getBalances } from "@/lib/currency"
import { pctOf } from "@/lib/numbers"
import prisma from "@/lib/prisma"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { streakAsOf } from "@/lib/streak"

/**
 * Analytics time markers: when each step of a person's journey happened.
 *
 * The one writer of the markers on User (first project, first reel, first and last submission, last login, last active), of UserDay (one row per active day, which is what DAU counts) and of UserWeek (hours per program week, and when 1h / 5h / 10h / 20h was first crossed). Signing up and onboarding are already stamped (`createdAt`, `onboardingCompletedAt`).
 *
 * An active day is one whose time entries total at least 15 minutes – journalled, Hackatime-tracked or Lapse-backed alike, since all three are a WorkSession. Visiting the site is not activity for DAU; it only moves `lastActiveAt`.
 *
 * Every function here is fire-and-forget safe: it never throws, because a sign-in, a post or a submit must not fail over a counter. And every one is idempotent – "first" markers are written with a `WHERE … IS NULL`, so two requests racing cannot move one, and a replay or the backfill cannot either.
 */

const HOUR_MILESTONES = [1, 5, 10, 20] as const
type Milestone = (typeof HOUR_MILESTONES)[number]
const milestoneField = (h: Milestone) => `reached${h}hAt` as const

/** Page views closer together than this share one activity write. */
const ACTIVITY_THROTTLE_MS = 5 * 60_000

/** A day counts as active once its entries total this much. */
const ACTIVE_DAY_MIN_HOURS = 0.25

/**
 * The day total, rounded at microseconds of an hour before it is compared.
 *
 * It is a sum of doubles, so a day that is exactly 15 minutes can land a hair under it: ten 1.5-minute entries sum to 0.24999999999999997, which a bare `>= 0.25` would drop. Tighter than any real entry, so the boundary stays where it says it is.
 */
const roundHours = (hours: number): number => Math.round(hours * 1e6) / 1e6

/**
 * Whether a day's tracked time reaches the active bar.
 *
 * The one expression of the rule, shared by the per-person rebuild below and the admin overview's DAU chart: two copies would be two answers to "how many people were active" that could drift apart, which is the whole reason `UserDay` exists to hold one.
 */
export function isActiveDay(hours: number): boolean {
	return roundHours(hours) >= ACTIVE_DAY_MIN_HOURS
}

async function quietly(label: string, fn: () => Promise<unknown>): Promise<void> {
	try {
		await fn()
	} catch (err) {
		console.warn(`[analytics] ${label} failed:`, err)
	}
}

/** A new sign-in. */
export function markLogin(userId: string, at = new Date()): Promise<void> {
	return quietly("markLogin", () => prisma.user.update({ data: { lastLoginAt: at }, where: { id: userId } }))
}

// Per process, so a burst of page views costs one write, not one each. The database value is the truth; this only saves round trips.
const lastTouched = new Map<string, number>()

/**
 * A page view: moves `lastActiveAt` forward, which is what Loops reads as last site access. Not an active day – those come from time entries. Throttled to one write per person per few minutes, not one every click.
 */
export function touchActivity(userId: string, at = new Date()): Promise<void> {
	const prev = lastTouched.get(userId)
	if (prev !== undefined && at.getTime() - prev < ACTIVITY_THROTTLE_MS) return Promise.resolve()
	lastTouched.set(userId, at.getTime())
	if (lastTouched.size > 10_000) lastTouched.clear()

	return quietly("touchActivity", () => prisma.user.update({ data: { lastActiveAt: at }, where: { id: userId } }))
}

/**
 * Rebuild one person's active days from their live time entries. Rebuilt rather than incremented, as the streak is (lib/streak): an entry can be created, edited below the threshold, deleted, or go with its project, and a counter would have to be right on every one of those paths.
 *
 * The bar is on the day's total rather than on one entry, so two ten-minute entries make a day active just as one twenty-minute entry does. That is why the sum happens here and not as a filter in SQL.
 */
async function rebuildActiveDays(userId: string, programTimezone: string): Promise<number> {
	const sessions = await prisma.workSession.findMany({
		select: { createdAt: true, effectiveDate: true, hoursClaimed: true },
		where: {
			deletedAt: null,
			themeProject: { deletedAt: null, userId },
		},
	})
	// day → the day's total hours and the earliest entry that fell on it, in one pass.
	const totals = new Map<string, { hours: number; firstSeenAt: Date }>()
	for (const s of sessions) {
		const day = s.effectiveDate ?? effectiveDateFor(s.createdAt, programTimezone)
		const seen = totals.get(day)
		if (seen === undefined) {
			totals.set(day, { firstSeenAt: s.createdAt, hours: s.hoursClaimed })
			continue
		}
		seen.hours += s.hoursClaimed
		if (s.createdAt < seen.firstSeenAt) seen.firstSeenAt = s.createdAt
	}
	const days = [...totals].filter(([, day]) => isActiveDay(day.hours))
	await prisma.$transaction([
		prisma.userDay.deleteMany({ where: { userId } }),
		prisma.userDay.createMany({ data: days.map(([day, { firstSeenAt }]) => ({ day, firstSeenAt, userId })) }),
		prisma.user.update({ data: { activeDays: days.length }, where: { id: userId } }),
	])
	return days.length
}

/** Recount active days. Called after a time entry is written, edited or deleted. */
export function recomputeActiveDays(userId: string): Promise<void> {
	return quietly("recomputeActiveDays", async () => {
		const { programTimezone } = await getProgramSettings()
		await rebuildActiveDays(userId, programTimezone)
	})
}

/**
 * Whether a project has actually been started. Not its title: every row is made at sign-up already titled with its theme's name. The app counts a project once it has a description and a tier – that is what completes the trail's "project" node (lib/queries/store) – so this does too.
 */
function isCreated(p: { description: string | null; tier: number | null; requestedTier: number | null }) {
	return !!p.description?.trim() && (p.tier ?? p.requestedTier) != null
}

/**
 * Stamp a project as created, if it now is and was not before. Called after anything that writes a project's description or tier.
 */
export function markProjectCreated(themeProjectId: string, userId: string, at = new Date()): Promise<void> {
	return quietly("markProjectCreated", async () => {
		const p = await prisma.themeProject.findUnique({
			select: { description: true, namedAt: true, requestedTier: true, tier: true },
			where: { id: themeProjectId },
		})
		if (!p || p.namedAt || !isCreated(p)) return
		await prisma.themeProject.updateMany({ data: { namedAt: at }, where: { id: themeProjectId, namedAt: null } })
		await prisma.user.updateMany({ data: { firstProjectAt: at }, where: { firstProjectAt: null, id: userId } })
	})
}

/** A reel was posted. */
export function markReel(userId: string, at = new Date()): Promise<void> {
	return quietly("markReel", () =>
		prisma.user.updateMany({ data: { firstReelAt: at }, where: { firstReelAt: null, id: userId } }),
	)
}

/** A phase was handed in. */
export function markSubmission(userId: string, at = new Date()): Promise<void> {
	return quietly("markSubmission", async () => {
		await prisma.user.updateMany({ data: { firstSubmissionAt: at }, where: { firstSubmissionAt: null, id: userId } })
		await prisma.user.update({ data: { lastSubmissionAt: at }, where: { id: userId } })
	})
}

/** The repo file checks first passed: the preflight that gates submissions. */
export function markChecksPassed(userId: string, at = new Date()): Promise<void> {
	return quietly("markChecksPassed", () =>
		prisma.user.updateMany({ data: { firstChecksPassedAt: at }, where: { firstChecksPassedAt: null, id: userId } }),
	)
}

/**
 * Recount one person's hours for one program week, and stamp any milestone crossed for the first time. Called after a session is written, edited or deleted; `at` is when the crossing is recorded as having happened.
 */
export function recomputeWeek(userId: string, week: number | null, at = new Date()): Promise<void> {
	if (!week || week < 1) return Promise.resolve()
	return quietly("recomputeWeek", async () => {
		const sum = await prisma.workSession.aggregate({
			_sum: { hoursClaimed: true },
			// HACKATIME_TRACKED sessions contribute zero to every paid total (lib/hours), so they must not inflate the weekly analytics either.
			where: {
				deletedAt: null,
				hoursSource: { not: HoursSource.HACKATIME_TRACKED },
				themeProject: { deletedAt: null, userId },
				weekNumber: week,
			},
		})
		const hours = Math.round((sum._sum.hoursClaimed ?? 0) * 100) / 100
		await prisma.userWeek.upsert({
			create: { hours, userId, week },
			update: { hours },
			where: { userId_week: { userId, week } },
		})
		for (const h of HOUR_MILESTONES) {
			if (hours < h) break
			await prisma.userWeek.updateMany({
				data: { [milestoneField(h)]: at },
				where: { userId, week, [milestoneField(h)]: null },
			})
		}
	})
}

/**
 * Fill the markers in from what the database already holds, for everyone who was here before they were tracked. Safe to run again: every write only fills what is still empty (or, for weeks, recounts).
 *
 * Approximations, said plainly: a project's naming time is taken from the first audit entry that touched it, else when it was last updated; a week's milestones are stamped at the time of the session that crossed them, in order. Past page views were never recorded, so `lastActiveAt` is filled from the last sign-in, session, post or submission.
 */
export async function backfillAnalytics(): Promise<{ [_: string]: number }> {
	const { programTimezone } = await getProgramSettings()
	const users = await prisma.user.findMany({ select: { id: true } })
	const counts = { days: 0, projects: 0, users: users.length, weeks: 0 }

	for (const { id: userId } of users) {
		const [projects, posts, submissions, logins, sessions] = await Promise.all([
			prisma.themeProject.findMany({
				select: { description: true, id: true, namedAt: true, requestedTier: true, tier: true, updatedAt: true },
				where: { deletedAt: null, userId },
			}),
			prisma.post.findMany({
				orderBy: { createdAt: "asc" },
				select: { createdAt: true },
				where: { deletedAt: null, userId },
			}),
			prisma.phaseSubmission.findMany({
				orderBy: { createdAt: "asc" },
				select: { createdAt: true },
				where: { themeProject: { userId } },
			}),
			prisma.session.findMany({ orderBy: { createdAt: "asc" }, select: { createdAt: true }, where: { userId } }),
			prisma.workSession.findMany({
				orderBy: { createdAt: "asc" },
				select: { createdAt: true, hoursClaimed: true, weekNumber: true },
				where: {
					deletedAt: null,
					// The backfill must apply the same exclusion as recomputeWeek, or running it re-inflates every tracked session's week.
					hoursSource: { not: HoursSource.HACKATIME_TRACKED },
					themeProject: { deletedAt: null, userId },
				},
			}),
		])

		for (const p of projects) {
			if (!isCreated(p)) {
				// Not started yet, whatever an earlier backfill said.
				if (p.namedAt) await prisma.themeProject.update({ data: { namedAt: null }, where: { id: p.id } })
				continue
			}
			const firstTouch = await prisma.auditLog.findFirst({
				orderBy: { createdAt: "asc" },
				select: { createdAt: true },
				where: { action: "USER_UPDATE_PROJECT", targetId: p.id },
			})
			await prisma.themeProject.update({
				data: { namedAt: firstTouch?.createdAt ?? p.updatedAt },
				where: { id: p.id },
			})
			counts.projects++
		}
		// The earliest started project, or none: settled from the rows above.
		const first = await prisma.themeProject.findFirst({
			orderBy: { namedAt: "asc" },
			select: { namedAt: true },
			where: { namedAt: { not: null }, userId },
		})
		await prisma.user.update({ data: { firstProjectAt: first?.namedAt ?? null }, where: { id: userId } })

		if (posts[0]) await markReel(userId, posts[0].createdAt)
		// The first and last of the list, named rather than indexed twice: the narrowing is what keeps the write off `undefined` without an assertion.
		const firstSubmission = submissions[0]
		const lastSubmission = submissions[submissions.length - 1]
		if (firstSubmission && lastSubmission) {
			await prisma.user.update({
				data: { firstSubmissionAt: firstSubmission.createdAt, lastSubmissionAt: lastSubmission.createdAt },
				where: { id: userId },
			})
		}
		const lastLogin = logins[logins.length - 1]?.createdAt
		if (lastLogin) {
			await prisma.user.updateMany({ data: { lastLoginAt: lastLogin }, where: { id: userId, lastLoginAt: null } })
		}

		// Active days are rebuilt outright, which also clears any left from when a page view counted as one.
		counts.days += await rebuildActiveDays(userId, programTimezone)

		// Last seen, from everything that left a timestamp.
		const moments = [...logins, ...sessions, ...posts, ...submissions].map(x => x.createdAt)
		if (moments.length > 0) {
			const last = moments.reduce((a, b) => (b > a ? b : a))
			await prisma.user.updateMany({ data: { lastActiveAt: last }, where: { id: userId, lastActiveAt: null } })
		}

		// Weeks: replay sessions in order so each milestone is stamped by the session that crossed it.
		const byWeek = new Map<number, { at: Date; hours: number }[]>()
		for (const s of sessions) {
			if (!s.weekNumber || s.weekNumber < 1) continue
			const list = byWeek.get(s.weekNumber) ?? []
			list.push({ at: s.createdAt, hours: s.hoursClaimed })
			byWeek.set(s.weekNumber, list)
		}
		for (const [week, list] of byWeek) {
			let running = 0
			const reached: Partial<Record<ReturnType<typeof milestoneField>, Date>> = {}
			for (const s of list) {
				running += s.hours
				for (const h of HOUR_MILESTONES)
					if (running >= h && !reached[milestoneField(h)]) reached[milestoneField(h)] = s.at
			}
			const hours = Math.round(running * 100) / 100
			await prisma.userWeek.upsert({
				create: { hours, userId, week, ...reached },
				update: { hours },
				where: { userId_week: { userId, week } },
			})
			for (const [field, at] of Object.entries(reached)) {
				await prisma.userWeek.updateMany({ data: { [field]: at }, where: { userId, week, [field]: null } })
			}
			counts.weeks++
		}
	}
	return counts
}

/** Everything tracked about one person, flattened for an export row. */
export interface UserAnalyticsRow {
	activeDays: number
	bankedCoins: number
	coins: number
	currentStreak: number
	email: string
	firstChecksPassedAt: Date | null
	firstProjectAt: Date | null
	firstReelAt: Date | null
	firstSubmissionAt: Date | null
	lastActiveAt: Date | null
	lastLoginAt: Date | null
	lastSubmissionAt: Date | null
	longestStreak: number
	onboardedAt: Date | null
	signedUpAt: Date
	totalHours: number
	userId: string
	weeks: {
		week: number
		hours: number
		reached1hAt: Date | null
		reached5hAt: Date | null
		reached10hAt: Date | null
		reached20hAt: Date | null
	}[]
}

/** Per-person rows, for the Loops/Airtable sync and for export. */
export async function getUserAnalytics(): Promise<UserAnalyticsRow[]> {
	const { programTimezone } = await getProgramSettings()
	const today = effectiveDateFor(new Date(), programTimezone)
	const users = await prisma.user.findMany({
		orderBy: { createdAt: "asc" },
		select: {
			activeDays: true,
			activityWeeks: { orderBy: { week: "asc" } },
			createdAt: true,
			currentStreak: true,
			email: true,
			firstChecksPassedAt: true,
			firstProjectAt: true,
			firstReelAt: true,
			firstSubmissionAt: true,
			id: true,
			lastActiveAt: true,
			lastLoginAt: true,
			lastStreakDate: true,
			lastSubmissionAt: true,
			longestStreak: true,
			onboardingCompletedAt: true,
		},
	})
	const out: UserAnalyticsRow[] = []
	for (const u of users) {
		const balances = await prisma.$transaction(tx => getBalances(tx, u.id))
		out.push({
			activeDays: u.activeDays,
			bankedCoins: balances.banked,
			coins: balances.spendable,
			// The stored column is a cache only correct as of the last devlog or reel; an export that reads it directly calls a lapsed run current.
			currentStreak: streakAsOf(u, today),
			email: u.email,
			firstChecksPassedAt: u.firstChecksPassedAt,
			firstProjectAt: u.firstProjectAt,
			firstReelAt: u.firstReelAt,
			firstSubmissionAt: u.firstSubmissionAt,
			lastActiveAt: u.lastActiveAt,
			lastLoginAt: u.lastLoginAt,
			lastSubmissionAt: u.lastSubmissionAt,
			longestStreak: u.longestStreak,
			onboardedAt: u.onboardingCompletedAt,
			signedUpAt: u.createdAt,
			totalHours: Math.round(u.activityWeeks.reduce((n, w) => n + w.hours, 0) * 100) / 100,
			userId: u.id,
			weeks: u.activityWeeks.map(({ week, hours, reached1hAt, reached5hAt, reached10hAt, reached20hAt }) => ({
				hours,
				reached1hAt,
				reached5hAt,
				reached10hAt,
				reached20hAt,
				week,
			})),
		})
	}
	return out
}

/**
 * The program-wide numbers: DAU per day, the funnel with drop-off at each step, and how many people crossed each hour milestone in each week.
 */
export async function getAnalyticsSummary(days = 30): Promise<{
	dau: { day: string; users: number }[]
	funnel: { step: string; count: number; dropOffPct: number; ofSignUpsPct: number }[]
	weeklyMilestones: { week: number; over1h: number; over5h: number; over10h: number; over20h: number }[]
}> {
	const { programTimezone } = await getProgramSettings()
	const since = effectiveDateFor(new Date(Date.now() - days * 86_400_000), programTimezone)

	const [dau, people, weeks] = await Promise.all([
		prisma.userDay.groupBy({
			_count: { _all: true },
			by: ["day"],
			orderBy: { day: "asc" },
			where: { day: { gte: since } },
		}),
		prisma.user.findMany({
			select: { firstProjectAt: true, firstReelAt: true, firstSubmissionAt: true, onboardingCompletedAt: true },
		}),
		prisma.userWeek.findMany({
			select: { reached1hAt: true, reached5hAt: true, reached10hAt: true, reached20hAt: true, week: true },
		}),
	])

	// A strict funnel: each step counts only people who also did every step before it, so a step never has more people than the one above it (and drop-off is never negative), whatever order things happened in.
	const reached = (n: number) =>
		people.filter(u =>
			[u.onboardingCompletedAt, u.firstProjectAt, u.firstReelAt, u.firstSubmissionAt]
				.slice(0, n)
				.every(t => t !== null),
		).length
	const total = people.length
	const steps = [
		["signedUp", total],
		["onboarded", reached(1)],
		["createdProject", reached(2)],
		["postedReel", reached(3)],
		["submitted", reached(4)],
	] as const
	const funnel = steps.map(([step, count], i) => {
		// The step before this one, or this one at the top of the funnel. The fallback is unreachable – `i` is always within `steps` – but it keeps the arithmetic off `undefined` without an assertion.
		const prev = i === 0 ? count : (steps[i - 1]?.[1] ?? count)
		return {
			count,
			// Share of the previous step that did not make it to this one.
			dropOffPct: i === 0 ? 0 : pctOf(prev - count, prev),
			// Share of everyone who signed up that got this far.
			ofSignUpsPct: pctOf(count, total),
			step,
		}
	})

	const byWeek = new Map<number, { week: number; over1h: number; over5h: number; over10h: number; over20h: number }>()
	for (const w of weeks) {
		const row = byWeek.get(w.week) ?? { over1h: 0, over5h: 0, over10h: 0, over20h: 0, week: w.week }
		if (w.reached1hAt) row.over1h++
		if (w.reached5hAt) row.over5h++
		if (w.reached10hAt) row.over10h++
		if (w.reached20hAt) row.over20h++
		byWeek.set(w.week, row)
	}

	return {
		dau: dau.map(d => ({ day: d.day, users: d._count._all })),
		funnel,
		weeklyMilestones: [...byWeek.values()].toSorted((a, b) => a.week - b.week),
	}
}
