import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import { PostKind } from "@/app/generated/prisma/enums"
import { STREAK_GRACE_DAYS } from "@/lib/config/program"
import prisma from "@/lib/prisma"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"

type Tx = Prisma.TransactionClient

/**
 * Journalling streaks.
 *
 * A day counts when the participant did one of the two things the program asks
 * for: wrote a devlog – a `WorkSession` stamped with that calendar day as its
 * `effectiveDate` – or posted a reel, a `Post` that is not a staff ANNOUNCEMENT. The two live in separate tables for good reason (a devlog is evidence a reviewer reads, a reel is something made to be watched), but for the one question a streak answers – did you do the work today – they are the same signal, so both feed the run.
 *
 * Recomputed from those rows rather than incremented on write. An incremented counter has to be right on every path that can create, edit, back-date or soft-delete a devlog or a reel, and is wrong forever the first time one of them is missed – there is no way to notice, and no way to repair it without the recompute this module would have needed anyway. Deriving it means `User.currentStreak` is a cache that any write can rebuild and `scripts/` can backfill.
 *
 * The unit is the calendar day in the PROGRAM timezone: `effectiveDate` already stores one, and a reel's timestamp is converted to one here, so a participant in Hawaii and one in Berlin get the same answer for "did I journal today" as each other and as the dashboard.
 */

/** Days between two YYYY-MM-DD strings. Both are program-timezone dates. */
function daysBetween(earlier: string, later: string): number {
	// Parsed as UTC midnight deliberately: these are calendar dates with no time component, and UTC is the one zone with no DST, so the subtraction can never come out as 23 or 25 hours and round to the wrong day.
	const a = Date.parse(`${earlier}T00:00:00Z`)
	const b = Date.parse(`${later}T00:00:00Z`)
	return Math.round((b - a) / 86_400_000)
}

export interface StreakState {
	current: number
	lastDate: string | null
	longest: number
}

/**
 * Walk a descending list of distinct active days and measure the run ending at the most recent one, plus the longest run anywhere in the history.
 *
 * `STREAK_GRACE_DAYS` is the largest gap that does NOT break a run, so with a grace of 1 a Monday and a Wednesday are still one streak and a Monday and a Thursday are two.
 */
export function streakFromDays(daysDesc: readonly string[]): StreakState {
	const first = daysDesc[0]
	if (!first) return { current: 0, lastDate: null, longest: 0 }

	let current = 1
	let longest = 1
	let run = 1

	for (let i = 1; i < daysDesc.length; i++) {
		const newer = daysDesc[i - 1]
		const older = daysDesc[i]
		if (!newer || !older) break

		if (daysBetween(older, newer) <= STREAK_GRACE_DAYS + 1) run += 1
		else run = 1

		if (run > longest) longest = run
		// The current streak is the run that reaches the most recent day, so it stops growing as soon as the walk hits its first break.
		if (run === i + 1) current = run
	}

	return { current, lastDate: first, longest: Math.max(longest, current) }
}

/**
 * The distinct program-timezone days a user has a devlog or a reel on, newest first.
 *
 * A reel counts from the day it was published, in the program timezone. Posts are published the moment they are created (there is no transcode step yet), so `publishedAt` is normally just `createdAt` seconds later; the fallback covers a row whose status was flipped by hand.
 */
async function activeDaysDesc(tx: Tx, userId: string): Promise<string[]> {
	const { programTimezone } = await getProgramSettings()

	const [sessions, posts] = await Promise.all([
		tx.workSession.findMany({
			distinct: ["effectiveDate"],
			select: { effectiveDate: true },
			where: {
				deletedAt: null,
				effectiveDate: { not: null },
				themeProject: { deletedAt: null, userId },
			},
		}),
		// Soft-deleted reels are gone, so the day they carried goes with them. Hidden ones still count: the day was worked whatever a moderator later did with the post. ANNOUNCEMENTs are HQ's, never a participant's.
		tx.post.findMany({
			select: { createdAt: true, publishedAt: true },
			where: { deletedAt: null, kind: { not: PostKind.ANNOUNCEMENT }, userId },
		}),
	])

	const days = new Set<string>()
	for (const s of sessions) if (s.effectiveDate) days.add(s.effectiveDate)
	for (const p of posts) days.add(effectiveDateFor(p.publishedAt ?? p.createdAt, programTimezone))

	// YYYY-MM-DD sorts lexicographically, so sort-then-reverse is newest-first without parsing a single date.
	return [...days].toSorted().toReversed()
}

/**
 * Recompute and persist one user's streak.
 *
 * Safe to call inside the transaction that wrote the devlog or reel – pass its `tx` – so a rolled-back write cannot leave an inflated streak behind.
 */
export async function recomputeStreak(tx: Tx, userId: string): Promise<StreakState> {
	const state = streakFromDays(await activeDaysDesc(tx, userId))

	await tx.user.update({
		data: {
			currentStreak: state.current,
			lastStreakDate: state.lastDate,
			longestStreak: state.longest,
		},
		where: { id: userId },
	})

	return state
}

/**
 * The streak as it should READ today, without writing anything.
 *
 * The stored `currentStreak` is only correct as of the last devlog or reel write: a participant who journalled for ten days and then stopped still has a 10 in the column a week later. Displays must go through this, which expires a stale run against today's date.
 */
export function streakAsOf(stored: { currentStreak: number; lastStreakDate: string | null }, today: string): number {
	if (!stored.lastStreakDate) return 0
	const gap = daysBetween(stored.lastStreakDate, today)
	if (gap < 0) return stored.currentStreak
	return gap <= STREAK_GRACE_DAYS + 1 ? stored.currentStreak : 0
}

/** Rebuild every user's streak. For a backfill or after editing the rules. */
export async function recomputeAllStreaks(): Promise<number> {
	const users = await prisma.user.findMany({ select: { id: true } })
	for (const user of users) await prisma.$transaction(tx => recomputeStreak(tx, user.id))
	return users.length
}
