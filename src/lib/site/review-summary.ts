import { getSlackUserName } from "./slack"
import type { ProjectReviewStats } from "./review-store"
import prisma from "@/lib/prisma"

const LEADERBOARD_LIMIT = 10

function submittedLine(submitted: number): string {
	if (submitted === 0) return "no new submissions were handed in"
	if (submitted === 1) return "1 total submission was handed in"
	return `${submitted} total submissions were handed in`
}

function reviewedLine(reviewed: number): string {
	if (reviewed === 0) return "you didn't review any of them this time :("
	if (reviewed === 1) return "you managed to review 1 of them! congrats!! :D"
	return `you managed to review ${reviewed} of them! congrats!! :D`
}

function leaderboardLine(rank: number, name: string, reviewed: number): string {
	return `${rank}. ${name} - ${reviewed} reviewed ${reviewed === 1 ? "submission" : "submissions"}`
}

/** A Slack display name per reviewer, looked up once for both boards and falling back to the Half Life name so a lookup miss is never a broken summary. */
async function namesFor(entries: ProjectReviewStats["leaderboard"]): Promise<Map<string, string>> {
	const ids = [...new Set(entries.map((entry) => entry.reviewerId))]
	if (ids.length === 0) return new Map()

	const users = await prisma.user.findMany({
		where: { id: { in: ids } },
		select: { id: true, slackId: true, name: true, displayName: true },
	})
	const byId = new Map(users.map((user) => [user.id, user]))

	return new Map(
		await Promise.all(
			ids.map(async (id) => {
				const user = byId.get(id)
				const name = user?.slackId ? await getSlackUserName(user.slackId) : user?.displayName || user?.name || id
				return [id, name] as const
			}),
		),
	)
}

function boardLines(board: ProjectReviewStats["leaderboard"], names: Map<string, string>): string[] {
	return board
		.slice(0, LEADERBOARD_LIMIT)
		.map((entry, index) => leaderboardLine(index + 1, names.get(entry.reviewerId) ?? entry.reviewerId, entry.reviewed))
}

/** The header and rows for one board, with the overflow note under it. */
function boardSection(title: string, board: ProjectReviewStats["leaderboard"], lines: string[]): string[] {
	const section = [title, ...(lines.length > 0 ? lines : ["no one yet – there's still time... :yay-bazooka:"])]
	if (board.length > LEADERBOARD_LIMIT) section.push(`(plus ${board.length - LEADERBOARD_LIMIT} more)`)
	return section
}

export async function buildReviewSummary(stats: ProjectReviewStats): Promise<string> {
	// One lookup for both boards: the daily ten are usually also on the all-time ten, and users.info is a rate-limited call.
	const names = await namesFor([...stats.leaderboard, ...stats.globalLeaderboard])

	return [
		"um, um, hi there! hope i'm not disturbing you, but i just wanted to let you know that i've got some stats for you! :yay:",
		"",
		":mc-clock: in the last 24 hours...",
		`:yay-love: ${submittedLine(stats.submitted)} and ${reviewedLine(stats.reviewed)}`,
		"",
		...boardSection(":yay-peace: today's leaderboard", stats.leaderboard, boardLines(stats.leaderboard, names)),
		"",
		...boardSection(
			":yay-blush-2: all-time leaderboard",
			stats.globalLeaderboard,
			boardLines(stats.globalLeaderboard, names),
		),
	].join("\n")
}
