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

export async function buildReviewSummary(stats: ProjectReviewStats): Promise<string> {
	const reviewers = stats.leaderboard.length
		? await prisma.user.findMany({
				where: { id: { in: stats.leaderboard.map((entry) => entry.reviewerId) } },
				select: { id: true, slackId: true, name: true, displayName: true },
			})
		: []
	const byId = new Map(reviewers.map((user) => [user.id, user]))

	const board = await Promise.all(
		stats.leaderboard.slice(0, LEADERBOARD_LIMIT).map(async (entry, index) => {
			const user = byId.get(entry.reviewerId)
			const name = user?.slackId
				? await getSlackUserName(user.slackId)
				: (user?.displayName || user?.name || entry.reviewerId)
			return leaderboardLine(index + 1, name, entry.reviewed)
		}),
	)

	const lines = [
		"um, um, hi there! hope i'm not disturbing you, but i just wanted to let you know that i've got some stats for you! :yay:",
		"",
		":mc-clock: in the last 24 hours...",
		`:yay-love: ${submittedLine(stats.submitted)} and ${reviewedLine(stats.reviewed)}`,
		"",
		":yay-peace: today's leaderboard",
		...(board.length > 0 ? board : ["no one yet – there's still time... :yay-bazooka:"]),
	]

	if (stats.leaderboard.length > LEADERBOARD_LIMIT) {
		lines.push(`(plus ${stats.leaderboard.length - LEADERBOARD_LIMIT} more)`)
	}

	return lines.join("\n")
}