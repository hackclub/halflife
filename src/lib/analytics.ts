import "server-only"
import { HoursSource } from "@/app/generated/prisma/enums"
import { getBalances } from "@/lib/currency"
import prisma from "@/lib/prisma"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { streakAsOf } from "@/lib/streak"

/**
 * Analytics time markers: when each step of a person's journey happened.
 *
 * The one writer of the markers on User (first project, first reel, first and
 * last submission, last login, last active), of UserDay (one row per active
 * day, which is what DAU counts) and of UserWeek (hours per program week, and
 * when 1h / 5h / 10h / 20h was first crossed). Signing up and onboarding are
 * already stamped (`createdAt`, `onboardingCompletedAt`).
 *
 * Every function here is fire-and-forget safe: it never throws, because a
 * sign-in, a post or a submit must not fail over a counter. And every one is
 * idempotent – "first" markers are written with a `WHERE … IS NULL`, so two
 * requests racing cannot move one, and a replay or the backfill cannot either.
 */

const HOUR_MILESTONES = [1, 5, 10, 20] as const
type Milestone = (typeof HOUR_MILESTONES)[number]
const milestoneField = (h: Milestone) => `reached${h}hAt` as const

/** Page views closer together than this share one activity write. */
const ACTIVITY_THROTTLE_MS = 5 * 60_000

async function quietly(label: string, fn: () => Promise<unknown>): Promise<void> {
	try {
		await fn()
	} catch (err) {
		console.warn(`[analytics] ${label} failed:`, err)
	}
}

/** A new sign-in. */
export function markLogin(userId: string, at = new Date()): Promise<void> {
	return quietly("markLogin", () => prisma.user.update({ where: { id: userId }, data: { lastLoginAt: at } }))
}

// Per process, so a burst of page views costs one write, not one each. The
// database value is the truth; this only saves round trips.
const lastTouched = new Map<string, number>()

/**
 * A page view: moves `lastActiveAt` forward and records today as an active
 * day. Throttled to one write per person per few minutes – DAU needs a day to
 * be counted once, not every click.
 */
export function touchActivity(userId: string, at = new Date()): Promise<void> {
	const prev = lastTouched.get(userId)
	if (prev !== undefined && at.getTime() - prev < ACTIVITY_THROTTLE_MS) return Promise.resolve()
	lastTouched.set(userId, at.getTime())
	if (lastTouched.size > 10_000) lastTouched.clear()

	return quietly("touchActivity", async () => {
		const { programTimezone } = await getProgramSettings()
		const day = effectiveDateFor(at, programTimezone)
		const created = await prisma.userDay.createMany({
			data: [{ userId, day, firstSeenAt: at }],
			skipDuplicates: true,
		})
		await prisma.user.update({
			where: { id: userId },
			data: {
				lastActiveAt: at,
				// Counted only when the day is new, so it always equals the number of
				// UserDay rows without a count query.
				...(created.count > 0 ? { activeDays: { increment: 1 } } : {}),
			},
		})
	})
}

/**
 * Whether a project has actually been started. Not its title: every row is
 * made at sign-up already titled with its theme's name. The app counts a
 * project once it has a description and a tier – that is what completes the
 * trail's "project" node (lib/queries/store) – so this does too.
 */
function isCreated(p: { description: string | null; tier: number | null; requestedTier: number | null }) {
	return !!p.description?.trim() && (p.tier ?? p.requestedTier) != null
}

/**
 * Stamp a project as created, if it now is and was not before. Called after
 * anything that writes a project's description or tier.
 */
export function markProjectCreated(themeProjectId: string, userId: string, at = new Date()): Promise<void> {
	return quietly("markProjectCreated", async () => {
		const p = await prisma.themeProject.findUnique({
			where: { id: themeProjectId },
			select: { description: true, tier: true, requestedTier: true, namedAt: true },
		})
		if (!p || p.namedAt || !isCreated(p)) return
		await prisma.themeProject.updateMany({ where: { id: themeProjectId, namedAt: null }, data: { namedAt: at } })
		await prisma.user.updateMany({ where: { id: userId, firstProjectAt: null }, data: { firstProjectAt: at } })
	})
}

/** A reel was posted. */
export function markReel(userId: string, at = new Date()): Promise<void> {
	return quietly("markReel", () =>
		prisma.user.updateMany({ where: { id: userId, firstReelAt: null }, data: { firstReelAt: at } }),
	)
}

/** A phase was handed in. */
export function markSubmission(userId: string, at = new Date()): Promise<void> {
	return quietly("markSubmission", async () => {
		await prisma.user.updateMany({ where: { id: userId, firstSubmissionAt: null }, data: { firstSubmissionAt: at } })
		await prisma.user.update({ where: { id: userId }, data: { lastSubmissionAt: at } })
	})
}

/** The repo file checks first passed: the preflight that gates submissions. */
export function markChecksPassed(userId: string, at = new Date()): Promise<void> {
	return quietly("markChecksPassed", () =>
		prisma.user.updateMany({ where: { id: userId, firstChecksPassedAt: null }, data: { firstChecksPassedAt: at } }),
	)
}

/**
 * Recount one person's hours for one program week, and stamp any milestone
 * crossed for the first time. Called after a session is written, edited or
 * deleted; `at` is when the crossing is recorded as having happened.
 */
export function recomputeWeek(userId: string, week: number | null, at = new Date()): Promise<void> {
	if (!week || week < 1) return Promise.resolve()
	return quietly("recomputeWeek", async () => {
		const sum = await prisma.workSession.aggregate({
			// HACKATIME_TRACKED sessions contribute zero to every paid total
			// (lib/hours), so they must not inflate the weekly analytics either.
			where: {
				weekNumber: week,
				deletedAt: null,
				themeProject: { userId, deletedAt: null },
				hoursSource: { not: HoursSource.HACKATIME_TRACKED },
			},
			_sum: { hoursClaimed: true },
		})
		const hours = Math.round((sum._sum.hoursClaimed ?? 0) * 100) / 100
		await prisma.userWeek.upsert({
			where: { userId_week: { userId, week } },
			create: { userId, week, hours },
			update: { hours },
		})
		for (const h of HOUR_MILESTONES) {
			if (hours < h) break
			await prisma.userWeek.updateMany({
				where: { userId, week, [milestoneField(h)]: null },
				data: { [milestoneField(h)]: at },
			})
		}
	})
}

/**
 * Fill the markers in from what the database already holds, for everyone who
 * was here before they were tracked. Safe to run again: every write only fills
 * what is still empty (or, for weeks, recounts).
 *
 * Approximations, said plainly: a project's naming time is taken from the
 * first audit entry that touched it, else when it was last updated; a week's
 * milestones are stamped at the time of the session that crossed them, in
 * order. Past page views were never recorded, so active days are rebuilt from
 * days with a sign-in, a session, a post or a submission.
 */
export async function backfillAnalytics(): Promise<Record<string, number>> {
	const { programTimezone } = await getProgramSettings()
	const users = await prisma.user.findMany({ select: { id: true } })
	const counts = { users: users.length, projects: 0, days: 0, weeks: 0 }

	for (const { id: userId } of users) {
		const [projects, posts, submissions, logins, sessions] = await Promise.all([
			prisma.themeProject.findMany({
				where: { userId, deletedAt: null },
				select: { id: true, namedAt: true, updatedAt: true, description: true, tier: true, requestedTier: true },
			}),
			prisma.post.findMany({
				where: { userId, deletedAt: null },
				select: { createdAt: true },
				orderBy: { createdAt: "asc" },
			}),
			prisma.phaseSubmission.findMany({
				where: { themeProject: { userId } },
				select: { createdAt: true },
				orderBy: { createdAt: "asc" },
			}),
			prisma.session.findMany({ where: { userId }, select: { createdAt: true }, orderBy: { createdAt: "asc" } }),
			prisma.workSession.findMany({
				where: {
					themeProject: { userId, deletedAt: null },
					deletedAt: null,
					// The backfill must apply the same exclusion as recomputeWeek, or
					// running it re-inflates every tracked session's week.
					hoursSource: { not: HoursSource.HACKATIME_TRACKED },
				},
				select: { createdAt: true, weekNumber: true, hoursClaimed: true },
				orderBy: { createdAt: "asc" },
			}),
		])

		for (const p of projects) {
			if (!isCreated(p)) {
				// Not started yet, whatever an earlier backfill said.
				if (p.namedAt) await prisma.themeProject.update({ where: { id: p.id }, data: { namedAt: null } })
				continue
			}
			const firstTouch = await prisma.auditLog.findFirst({
				where: { targetId: p.id, action: "USER_UPDATE_PROJECT" },
				orderBy: { createdAt: "asc" },
				select: { createdAt: true },
			})
			await prisma.themeProject.update({
				where: { id: p.id },
				data: { namedAt: firstTouch?.createdAt ?? p.updatedAt },
			})
			counts.projects++
		}
		// The earliest started project, or none: settled from the rows above.
		const first = await prisma.themeProject.findFirst({
			where: { userId, namedAt: { not: null } },
			orderBy: { namedAt: "asc" },
			select: { namedAt: true },
		})
		await prisma.user.update({ where: { id: userId }, data: { firstProjectAt: first?.namedAt ?? null } })

		if (posts[0]) await markReel(userId, posts[0].createdAt)
		// The first and last of the list, named rather than indexed twice: the
		// narrowing is what keeps the write off `undefined` without an assertion.
		const firstSubmission = submissions[0]
		const lastSubmission = submissions[submissions.length - 1]
		if (firstSubmission && lastSubmission) {
			await prisma.user.update({
				where: { id: userId },
				data: { firstSubmissionAt: firstSubmission.createdAt, lastSubmissionAt: lastSubmission.createdAt },
			})
		}
		const lastLogin = logins[logins.length - 1]?.createdAt
		if (lastLogin) {
			await prisma.user.updateMany({ where: { id: userId, lastLoginAt: null }, data: { lastLoginAt: lastLogin } })
		}

		// Active days from everything that left a timestamp.
		const moments = [...logins, ...sessions, ...posts, ...submissions].map((x) => x.createdAt)
		const days = new Map<string, Date>()
		for (const m of moments) {
			const d = effectiveDateFor(m, programTimezone)
			const seen = days.get(d)
			if (seen === undefined || m < seen) days.set(d, m)
		}
		if (days.size > 0) {
			await prisma.userDay.createMany({
				data: [...days].map(([day, firstSeenAt]) => ({ userId, day, firstSeenAt })),
				skipDuplicates: true,
			})
			const activeDays = await prisma.userDay.count({ where: { userId } })
			const last = moments.reduce((a, b) => (b > a ? b : a))
			await prisma.user.update({ where: { id: userId }, data: { activeDays } })
			await prisma.user.updateMany({ where: { id: userId, lastActiveAt: null }, data: { lastActiveAt: last } })
			counts.days += days.size
		}

		// Weeks: replay sessions in order so each milestone is stamped by the
		// session that crossed it.
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
				where: { userId_week: { userId, week } },
				create: { userId, week, hours, ...reached },
				update: { hours },
			})
			for (const [field, at] of Object.entries(reached)) {
				await prisma.userWeek.updateMany({ where: { userId, week, [field]: null }, data: { [field]: at } })
			}
			counts.weeks++
		}
	}
	return counts
}

/** Everything tracked about one person, flattened for an export row. */
export interface UserAnalyticsRow {
	userId: string
	email: string
	signedUpAt: Date
	onboardedAt: Date | null
	firstProjectAt: Date | null
	firstReelAt: Date | null
	firstSubmissionAt: Date | null
	lastSubmissionAt: Date | null
	firstChecksPassedAt: Date | null
	lastLoginAt: Date | null
	lastActiveAt: Date | null
	activeDays: number
	totalHours: number
	coins: number
	bankedCoins: number
	currentStreak: number
	longestStreak: number
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
			id: true,
			email: true,
			createdAt: true,
			onboardingCompletedAt: true,
			firstProjectAt: true,
			firstReelAt: true,
			firstSubmissionAt: true,
			lastSubmissionAt: true,
			firstChecksPassedAt: true,
			lastLoginAt: true,
			lastActiveAt: true,
			activeDays: true,
			currentStreak: true,
			longestStreak: true,
			lastStreakDate: true,
			activityWeeks: { orderBy: { week: "asc" } },
		},
	})
	const out: UserAnalyticsRow[] = []
	for (const u of users) {
		const balances = await prisma.$transaction((tx) => getBalances(tx, u.id))
		out.push({
			userId: u.id,
			email: u.email,
			signedUpAt: u.createdAt,
			onboardedAt: u.onboardingCompletedAt,
			firstProjectAt: u.firstProjectAt,
			firstReelAt: u.firstReelAt,
			firstSubmissionAt: u.firstSubmissionAt,
			lastSubmissionAt: u.lastSubmissionAt,
			firstChecksPassedAt: u.firstChecksPassedAt,
			lastLoginAt: u.lastLoginAt,
			lastActiveAt: u.lastActiveAt,
			activeDays: u.activeDays,
			totalHours: Math.round(u.activityWeeks.reduce((n, w) => n + w.hours, 0) * 100) / 100,
			coins: balances.spendable,
			bankedCoins: balances.banked,
			// The stored column is a cache only correct as of the last devlog or
			// reel; an export that reads it directly calls a lapsed run current.
			currentStreak: streakAsOf(u, today),
			longestStreak: u.longestStreak,
			weeks: u.activityWeeks.map(({ week, hours, reached1hAt, reached5hAt, reached10hAt, reached20hAt }) => ({
				week,
				hours,
				reached1hAt,
				reached5hAt,
				reached10hAt,
				reached20hAt,
			})),
		})
	}
	return out
}

/**
 * The program-wide numbers: DAU per day, the funnel with drop-off at each
 * step, and how many people crossed each hour milestone in each week.
 */
export async function getAnalyticsSummary(days = 30) {
	const { programTimezone } = await getProgramSettings()
	const since = effectiveDateFor(new Date(Date.now() - days * 86_400_000), programTimezone)

	const [dau, people, weeks] = await Promise.all([
		prisma.userDay.groupBy({
			by: ["day"],
			where: { day: { gte: since } },
			_count: { _all: true },
			orderBy: { day: "asc" },
		}),
		prisma.user.findMany({
			select: { onboardingCompletedAt: true, firstProjectAt: true, firstReelAt: true, firstSubmissionAt: true },
		}),
		prisma.userWeek.findMany({
			select: { week: true, reached1hAt: true, reached5hAt: true, reached10hAt: true, reached20hAt: true },
		}),
	])

	// A strict funnel: each step counts only people who also did every step
	// before it, so a step never has more people than the one above it (and
	// drop-off is never negative), whatever order things happened in.
	const reached = (n: number) =>
		people.filter((u) =>
			[u.onboardingCompletedAt, u.firstProjectAt, u.firstReelAt, u.firstSubmissionAt]
				.slice(0, n)
				.every((t) => t !== null),
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
		// The step before this one, or this one at the top of the funnel. The
		// fallback is unreachable – `i` is always within `steps` – but it keeps
		// the arithmetic off `undefined` without an assertion.
		const prev = i === 0 ? count : (steps[i - 1]?.[1] ?? count)
		return {
			step,
			count,
			// Share of the previous step that did not make it to this one.
			dropOffPct: i === 0 || prev === 0 ? 0 : Math.round(((prev - count) / prev) * 1000) / 10,
			// Share of everyone who signed up that got this far.
			ofSignUpsPct: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
		}
	})

	const byWeek = new Map<number, { week: number; over1h: number; over5h: number; over10h: number; over20h: number }>()
	for (const w of weeks) {
		const row = byWeek.get(w.week) ?? { week: w.week, over1h: 0, over5h: 0, over10h: 0, over20h: 0 }
		if (w.reached1hAt) row.over1h++
		if (w.reached5hAt) row.over5h++
		if (w.reached10hAt) row.over10h++
		if (w.reached20hAt) row.over20h++
		byWeek.set(w.week, row)
	}

	return {
		dau: dau.map((d) => ({ day: d.day, users: d._count._all })),
		funnel,
		weeklyMilestones: [...byWeek.values()].sort((a, b) => a.week - b.week),
	}
}
