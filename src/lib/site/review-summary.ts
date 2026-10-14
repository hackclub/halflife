import prisma from "@/lib/prisma"
import type { ProjectReviewStats } from "./review-store"
import { getSlackUserNames } from "./slack"
import {
	countedLine,
	creditedLine,
	LEADERBOARD_LIMIT,
	leaderboardLine,
	renderSummary,
	type SummaryBoard,
} from "./summary"

/**
 * The daily project-review summary, the same post as the ticket summary with review nouns.
 *
 * Reviewers are Half Life users rather than Slack ids, so the board's keys have to be resolved to a Slack account before a name can be asked for. One query and one batched lookup cover both boards: the daily ten are usually also on the all-time ten, and users.info is rate-limited.
 */

/** Display names for both boards at once, falling back to the Half Life name so a missing Slack link is never a broken summary. */
async function namesFor(entries: ProjectReviewStats["leaderboard"]): Promise<Map<string, string>> {
	const ids = [...new Set(entries.map((entry) => entry.reviewerId))]
	if (ids.length === 0) return new Map()

	const users = await prisma.user.findMany({
		where: { id: { in: ids } },
		select: { id: true, slackId: true, name: true, displayName: true },
	})

	const slackNames = await getSlackUserNames(users.flatMap((user) => (user.slackId ? [user.slackId] : [])))

	return new Map(
		users.map((user) => [
			user.id,
			(user.slackId ? slackNames.get(user.slackId) : null) ?? user.displayName ?? user.name ?? user.id,
		]),
	)
}

export async function buildReviewSummary(stats: ProjectReviewStats): Promise<string> {
	const daily = stats.leaderboard
	const global = stats.globalLeaderboard
	const names = await namesFor([...daily, ...global])

	const board = (title: string, rows: typeof daily): SummaryBoard => ({
		title,
		total: rows.length,
		lines: rows
			.slice(0, LEADERBOARD_LIMIT)
			.map((entry, index) =>
				leaderboardLine(
					index + 1,
					names.get(entry.reviewerId) ?? entry.reviewerId,
					entry.reviewed,
					"reviewed",
					"submission",
					"submissions",
				),
			),
	})

	return renderSummary({
		headline: `${countedLine(
			stats.submitted,
			{ singular: "submission", plural: "submissions" },
			{ singular: "was handed in", plural: "were handed in" },
		)} and ${creditedLine(stats.reviewed, "review")}`,
		boards: [board(":yay-peace: today's leaderboard", daily), board(":yay-blush-2: all-time leaderboard", global)],
	})
}
