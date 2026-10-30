import "server-only"
import { and } from "@prisma/orm-postgres/orm-client"
import { CoinBucket, HoursSource } from "@/lib/enums"
import { lockKey } from "@/lib/locks"
import { round2 } from "@/lib/money"
import { pctOf } from "@/lib/numbers"
import db, { type DbOrTx } from "@/lib/prisma8"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { streakAsOf } from "@/lib/streak"
import { DAY_MS, formatDbTimestamp, parseDbTimestamp, parseNullableTimestamp } from "@/lib/time"

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
	return quietly("markLogin", () =>
		db.orm.public.User.where({ id: userId }).update({ lastLoginAt: formatDbTimestamp(at) }),
	)
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

	return quietly("touchActivity", () =>
		db.orm.public.User.where({ id: userId }).update({ lastActiveAt: formatDbTimestamp(at) }),
	)
}

/**
 * Serialise the active-day rebuild for one person.
 *
 * The same pattern as the credit ledger's lock (lib/currency.ts, `lockUserCredit`): `pg_advisory_xact_lock` is released automatically when the transaction ends, including on a rollback, and a different namespace string keeps this lock from ever colliding with the ledger's.
 */
function lockActiveDays(tx: DbOrTx, userId: string): Promise<void> {
	return lockKey(tx, `active-days:${userId}`)
}

/**
 * Rebuild one person's active days from their live time entries. Rebuilt rather than incremented, as the streak is (lib/streak): an entry can be created, edited below the threshold, deleted, or go with its project, and a counter would have to be right on every one of those paths.
 *
 * The bar is on the day's total rather than on one entry, so two ten-minute entries make a day active just as one twenty-minute entry does. That is why the sum happens here and not as a filter in SQL.
 *
 * The whole rebuild runs inside one transaction, under the person's lock. A rebuild is a delete-then-insert, and `UserDay` is keyed on (user, day), so two of them running at once would interleave – one deletes, the other deletes, the first inserts, the second inserts the same days again – and the second's insert would fail on the primary key, losing the rebuild entirely. The lock makes them take turns: the second waits for the first to commit, so the rows it inserts are the rows the first one deleted, and no other rebuild can insert into that (user, day) range in between. What is left on the table is always one rebuild's output, and `User.activeDays` always matches the number of days that rebuild wrote.
 */
function rebuildActiveDays(userId: string, programTimezone: string): Promise<number> {
	return db.transaction(async tx => {
		await lockActiveDays(tx, userId)

		const sessions = await tx.orm.public.WorkSession.where({ deletedAt: null })
			.where(session =>
				session.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.eq(userId))),
			)
			.select("createdAt", "effectiveDate", "hoursClaimed")
			.all()
		// day → the day's total hours and the earliest entry that fell on it, in one pass.
		const totals = new Map<string, { hours: number; firstSeenAt: string }>()
		for (const s of sessions) {
			const day = s.effectiveDate ?? effectiveDateFor(parseDbTimestamp(s.createdAt), programTimezone)
			const seen = totals.get(day)
			if (seen === undefined) {
				totals.set(day, { firstSeenAt: s.createdAt, hours: s.hoursClaimed })
				continue
			}
			seen.hours += s.hoursClaimed
			if (s.createdAt < seen.firstSeenAt) seen.firstSeenAt = s.createdAt
		}
		const days = [...totals].filter(([, day]) => isActiveDay(day.hours))
		await tx.orm.public.UserDay.where({ userId }).deleteAll()
		await tx.orm.public.UserDay.createAll(days.map(([day, { firstSeenAt }]) => ({ day, firstSeenAt, userId })))
		await tx.orm.public.User.where({ id: userId }).update({ activeDays: days.length })
		return days.length
	})
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
	return Boolean(p.description?.trim()) && (p.tier ?? p.requestedTier) != null
}

/**
 * Stamp a project as created, if it now is and was not before. Called after anything that writes a project's description or tier.
 */
export function markProjectCreated(themeProjectId: string, userId: string, at = new Date()): Promise<void> {
	return quietly("markProjectCreated", async () => {
		const atText = formatDbTimestamp(at)
		const p = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
			.select("description", "namedAt", "requestedTier", "tier")
			.first()
		if (!p || p.namedAt || !isCreated(p)) return
		await db.orm.public.ThemeProject.where({ id: themeProjectId })
			.where(project => project.namedAt.isNull())
			.updateAndCount({ namedAt: atText })
		await db.orm.public.User.where({ firstProjectAt: null, id: userId }).updateAll({
			firstProjectAt: atText,
		})
	})
}

/** A reel was posted. */
export function markReel(userId: string, at = new Date()): Promise<void> {
	return quietly("markReel", async () => {
		await db.orm.public.User.where({ firstReelAt: null, id: userId }).updateAll({
			firstReelAt: formatDbTimestamp(at),
		})
	})
}

/** A phase was handed in. */
export function markSubmission(userId: string, at = new Date()): Promise<void> {
	return quietly("markSubmission", async () => {
		const atText = formatDbTimestamp(at)
		await db.orm.public.User.where({ firstSubmissionAt: null, id: userId }).updateAll({
			firstSubmissionAt: atText,
		})
		await db.orm.public.User.where({ id: userId }).update({ lastSubmissionAt: atText })
	})
}

/**
 * The repo file checks first passed: the checks that gate a submission came back green.
 *
 * Stamped on the submit path (lib/submissions.ts), where the checks are actually enforced. It used to be stamped by the advisory preflight GET, which made a GET write to the database – and a cross-site navigation reaches a GET with the session cookie attached.
 */
export function markChecksPassed(userId: string, at = new Date()): Promise<void> {
	return quietly("markChecksPassed", async () => {
		await db.orm.public.User.where({ firstChecksPassedAt: null, id: userId }).updateAll({
			firstChecksPassedAt: formatDbTimestamp(at),
		})
	})
}

/**
 * Recount one person's hours for one program week, and stamp any milestone crossed for the first time. Called after a session is written, edited or deleted; `at` is when the crossing is recorded as having happened.
 */
export function recomputeWeek(userId: string, week: number | null, at = new Date()): Promise<void> {
	if (!week || week < 1) return Promise.resolve()
	return quietly("recomputeWeek", async () => {
		const atText = formatDbTimestamp(at)
		const sum = await db.orm.public.WorkSession.where({ deletedAt: null, weekNumber: week })
			// HACKATIME_TRACKED sessions contribute zero to every paid total (lib/hours), so they must not inflate the weekly analytics either.
			.where(session => session.hoursSource.neq(HoursSource.HACKATIME_TRACKED))
			.where(session =>
				session.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.eq(userId))),
			)
			.aggregate(a => ({ total: a.sum("hoursClaimed") }))
		const hours = round2(sum.total ?? 0)
		await db.orm.public.UserWeek.upsert({
			conflictOn: { userId, week },
			create: { hours, userId, week },
			update: { hours },
		})
		const crosses = HOUR_MILESTONES.filter(h => hours >= h)
		if (crosses.length === 0) return
		const base = db.orm.public.UserWeek.where({ userId, week })
		// Each milestone fills only while still empty, so a replay stamps the crossing once rather than moving it.
		if (crosses.includes(1)) await base.where(row => row.reached1hAt.isNull()).updateAll({ reached1hAt: atText })
		if (crosses.includes(5)) await base.where(row => row.reached5hAt.isNull()).updateAll({ reached5hAt: atText })
		if (crosses.includes(10)) await base.where(row => row.reached10hAt.isNull()).updateAll({ reached10hAt: atText })
		if (crosses.includes(20)) await base.where(row => row.reached20hAt.isNull()).updateAll({ reached20hAt: atText })
	})
}

/**
 * Fill the markers in from what the database already holds, for everyone who was here before they were tracked. Safe to run again: every write only fills what is still empty (or, for weeks, recounts).
 *
 * Approximations, said plainly: a project's naming time is taken from the first audit entry that touched it, else when it was last updated; a week's milestones are stamped at the time of the session that crossed them, in order. Past page views were never recorded, so `lastActiveAt` is filled from the last sign-in, session, post or submission.
 */
export async function backfillAnalytics(): Promise<{ [_: string]: number }> {
	const { programTimezone } = await getProgramSettings()
	const users = await db.orm.public.User.select("id").all()
	const counts = { days: 0, projects: 0, users: users.length, weeks: 0 }

	for (const { id: userId } of users) {
		const [projects, posts, submissions, logins, sessions] = await Promise.all([
			db.orm.public.ThemeProject.where({ deletedAt: null, userId })
				.select("description", "id", "namedAt", "requestedTier", "tier", "updatedAt")
				.all(),
			db.orm.public.Post.where({ deletedAt: null, userId })
				.orderBy(post => post.createdAt.asc())
				.select("createdAt")
				.all(),
			db.orm.public.PhaseSubmission.where(submission =>
				submission.themeProject.some(project => project.userId.eq(userId)),
			)
				.orderBy(submission => submission.createdAt.asc())
				.select("createdAt")
				.all(),
			db.orm.public.Session.where({ userId })
				.orderBy(session => session.createdAt.asc())
				.select("createdAt")
				.all(),
			db.orm.public.WorkSession.where({ deletedAt: null })
				// The backfill must apply the same exclusion as recomputeWeek, or running it re-inflates every tracked session's week.
				.where(session => session.hoursSource.neq(HoursSource.HACKATIME_TRACKED))
				.where(session =>
					session.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.eq(userId))),
				)
				.orderBy(session => session.createdAt.asc())
				.select("createdAt", "hoursClaimed", "weekNumber")
				.all(),
		])

		for (const p of projects) {
			if (!isCreated(p)) {
				// Not started yet, whatever an earlier backfill said.
				if (p.namedAt) await db.orm.public.ThemeProject.where({ id: p.id }).update({ namedAt: null })
				continue
			}
			const firstTouch = await db.orm.public.AuditLog.where({
				action: "USER_UPDATE_PROJECT",
				targetId: p.id,
			})
				.orderBy(entry => entry.createdAt.asc())
				.select("createdAt")
				.first()
			await db.orm.public.ThemeProject.where({ id: p.id }).update({
				namedAt: firstTouch?.createdAt ?? p.updatedAt,
			})
			counts.projects++
		}
		// The earliest started project, or none: settled from the rows above.
		const first = await db.orm.public.ThemeProject.where({ userId })
			.where(project => project.namedAt.isNotNull())
			.orderBy(project => project.namedAt.asc())
			.select("namedAt")
			.first()
		await db.orm.public.User.where({ id: userId }).update({ firstProjectAt: first?.namedAt ?? null })

		if (posts[0]) await markReel(userId, parseDbTimestamp(posts[0].createdAt))
		// The first and last of the list, named rather than indexed twice: the narrowing is what keeps the write off `undefined` without an assertion.
		const [firstSubmission] = submissions
		const lastSubmission = submissions.at(-1)
		if (firstSubmission && lastSubmission)
			await db.orm.public.User.where({ id: userId }).update({
				firstSubmissionAt: firstSubmission.createdAt,
				lastSubmissionAt: lastSubmission.createdAt,
			})

		const lastLogin = logins.at(-1)?.createdAt
		if (lastLogin)
			await db.orm.public.User.where({ id: userId })
				.where(user => user.lastLoginAt.isNull())
				.updateAll({ lastLoginAt: lastLogin })

		// Active days are rebuilt outright, which also clears any left from when a page view counted as one.
		counts.days += await rebuildActiveDays(userId, programTimezone)

		// Last seen, from everything that left a timestamp.
		const moments = [...logins, ...sessions, ...posts, ...submissions].map(x => x.createdAt)
		if (moments.length > 0) {
			const last = new Date(Math.max(...moments.map(moment => parseDbTimestamp(moment).getTime())))
			await db.orm.public.User.where({ id: userId })
				.where(user => user.lastActiveAt.isNull())
				.updateAll({ lastActiveAt: formatDbTimestamp(last) })
		}

		// Weeks: replay sessions in order so each milestone is stamped by the session that crossed it.
		const byWeek = new Map<number, { at: string; hours: number }[]>()
		for (const s of sessions) {
			if (!s.weekNumber || s.weekNumber < 1) continue
			const list = byWeek.get(s.weekNumber) ?? []
			list.push({ at: s.createdAt, hours: s.hoursClaimed })
			byWeek.set(s.weekNumber, list)
		}
		for (const [week, list] of byWeek) {
			let running = 0
			const reached: Partial<Record<ReturnType<typeof milestoneField>, string>> = {}
			for (const s of list) {
				running += s.hours
				for (const h of HOUR_MILESTONES)
					if (running >= h && !reached[milestoneField(h)]) reached[milestoneField(h)] = s.at
			}
			const hours = round2(running)
			await db.orm.public.UserWeek.upsert({
				conflictOn: { userId, week },
				create: { hours, userId, week },
				update: { hours },
			})
			if (reached.reached1hAt)
				await db.orm.public.UserWeek.where({ userId, week })
					.where(row => row.reached1hAt.isNull())
					.updateAll({ reached1hAt: reached.reached1hAt })
			if (reached.reached5hAt)
				await db.orm.public.UserWeek.where({ userId, week })
					.where(row => row.reached5hAt.isNull())
					.updateAll({ reached5hAt: reached.reached5hAt })
			if (reached.reached10hAt)
				await db.orm.public.UserWeek.where({ userId, week })
					.where(row => row.reached10hAt.isNull())
					.updateAll({ reached10hAt: reached.reached10hAt })
			if (reached.reached20hAt)
				await db.orm.public.UserWeek.where({ userId, week })
					.where(row => row.reached20hAt.isNull())
					.updateAll({ reached20hAt: reached.reached20hAt })

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
	const [users, ledger] = await Promise.all([
		db.orm.public.User.orderBy(user => user.createdAt.asc())
			.select(
				"activeDays",
				"createdAt",
				"currentStreak",
				"email",
				"firstChecksPassedAt",
				"firstProjectAt",
				"firstReelAt",
				"firstSubmissionAt",
				"id",
				"lastActiveAt",
				"lastLoginAt",
				"lastStreakDate",
				"lastSubmissionAt",
				"longestStreak",
				"onboardingCompletedAt",
			)
			.include("activityWeeks", weeks =>
				weeks
					.select("hours", "reached1hAt", "reached10hAt", "reached20hAt", "reached5hAt", "week")
					.orderBy(w => w.week.asc()),
			)
			.all(),
		// Every balance in one aggregate, rather than a transaction per person.
		//
		// The balances are a SUM over the ledger grouped by (person, pot), so the ledger can answer for everyone at once. Reading them one person at a time meant a transaction and two queries each: at a few thousand participants that is thousands of transactions and tens of thousands of queries, on a route with a two-minute budget. One groupBy is one query, and it gives every person's balance from the same snapshot of the ledger.
		db.orm.public.LedgerEntry.groupBy("userId", "bucket").aggregate(group => ({
			total: group.sum("amount"),
		})),
	])
	// person → the two pots, joined in memory with the rows above.
	const balances = new Map<string, { banked: number; spendable: number }>()
	for (const row of ledger) {
		const amount = row.total ?? 0
		const pots = balances.get(row.userId) ?? { banked: 0, spendable: 0 }
		if (row.bucket === CoinBucket.BANKED) pots.banked += amount
		else pots.spendable += amount
		balances.set(row.userId, pots)
	}
	const out: UserAnalyticsRow[] = []
	for (const u of users) {
		const pots = balances.get(u.id) ?? { banked: 0, spendable: 0 }
		out.push({
			activeDays: u.activeDays,
			bankedCoins: pots.banked,
			coins: pots.spendable,
			// The stored column is a cache only correct as of the last devlog or reel; an export that reads it directly calls a lapsed run current.
			currentStreak: streakAsOf(u, today),
			email: u.email,
			firstChecksPassedAt: parseNullableTimestamp(u.firstChecksPassedAt),
			firstProjectAt: parseNullableTimestamp(u.firstProjectAt),
			firstReelAt: parseNullableTimestamp(u.firstReelAt),
			firstSubmissionAt: parseNullableTimestamp(u.firstSubmissionAt),
			lastActiveAt: parseNullableTimestamp(u.lastActiveAt),
			lastLoginAt: parseNullableTimestamp(u.lastLoginAt),
			lastSubmissionAt: parseNullableTimestamp(u.lastSubmissionAt),
			longestStreak: u.longestStreak,
			onboardedAt: parseNullableTimestamp(u.onboardingCompletedAt),
			signedUpAt: parseDbTimestamp(u.createdAt),
			totalHours: round2(u.activityWeeks.reduce((n, w) => n + w.hours, 0)),
			userId: u.id,
			weeks: u.activityWeeks.map(({ week, hours, reached1hAt, reached5hAt, reached10hAt, reached20hAt }) => ({
				hours,
				reached1hAt: parseNullableTimestamp(reached1hAt),
				reached5hAt: parseNullableTimestamp(reached5hAt),
				reached10hAt: parseNullableTimestamp(reached10hAt),
				reached20hAt: parseNullableTimestamp(reached20hAt),
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
	const since = effectiveDateFor(new Date(Date.now() - days * DAY_MS), programTimezone)

	const [dau, people, weeks] = await Promise.all([
		db.orm.public.UserDay.where(day => day.day.gte(since))
			.groupBy("day")
			.orderBy(group => group.day.asc())
			.aggregate(group => ({ count: group.count() })),
		db.orm.public.User.select("firstProjectAt", "firstReelAt", "firstSubmissionAt", "onboardingCompletedAt").all(),
		db.orm.public.UserWeek.select("reached1hAt", "reached5hAt", "reached10hAt", "reached20hAt", "week").all(),
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
		dau: dau.map(d => ({ day: d.day, users: d.count })),
		funnel,
		weeklyMilestones: [...byWeek.values()].toSorted((a, b) => a.week - b.week),
	}
}
