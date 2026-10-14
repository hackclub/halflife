import prisma from "@/lib/prisma"
import type { ProjectReviewStats } from "./review-store"
import { ANONYMOUS_ARI } from "./review-store"
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

/**
 * Display names for both boards at once.
 *
 * Emails are matched to accounts case-insensitively, since the address recorded at decision time is whatever the reviewer typed or Ari reported. An address with no account – an external Ari reviewer – falls back to the name recorded beside it on the review, then to the address itself, so the row always has something to print. Ari's anonymous decisions are simply Ari.
 */
async function namesFor(entries: ProjectReviewStats["leaderboard"]): Promise<Map<string, string>> {
	const names = new Map<string, string>()
	const emails = [...new Set(entries.map((entry) => entry.email))].filter((email) => email !== ANONYMOUS_ARI)
	if (emails.length === 0) {
		for (const entry of entries) names.set(entry.email, "Ari")
		return names
	}

	const users = await prisma.user.findMany({
		where: { email: { in: emails } },
		select: { email: true, slackId: true, name: true, displayName: true },
	})
	const byEmail = new Map(users.map((user) => [user.email.trim().toLowerCase(), user]))

	const slackNames = await getSlackUserNames(users.flatMap((user) => (user.slackId ? [user.slackId] : [])))

	for (const entry of entries) {
		if (entry.email === ANONYMOUS_ARI) {
			names.set(entry.email, "Ari")
			continue
		}
		const user = byEmail.get(entry.email.trim().toLowerCase())
		names.set(
			entry.email,
			(user?.slackId ? slackNames.get(user.slackId) : null) ??
				user?.displayName ??
				user?.name ??
				entry.name ??
				entry.email,
		)
	}
	return names
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
					names.get(entry.email) ?? entry.email,
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
