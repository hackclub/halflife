import { getSlackUserNames } from "./slack"
import { countedLine, creditedLine, rankedShareBoard, renderSummary, type SummaryBoard } from "./summary"
import type { HelpTicketStats } from "./ticket-store"

/**
 * The daily ticket summary, in the cat's voice the rest of the bot uses.
 *
 * It deliberately keeps to what the table can actually answer: how many tickets were opened, how many were closed, and who closed them – over the last day, and over every ticket on file. The Stasis sample this is modelled on also listed "assigned" and "still open" counts and a set of ageing tickets – none of which Half Life tracks. The table is also seeded by a backfill, so every pre-launch question looks unresolved; a "still open" number built from it would be wrong rather than merely absent, which is why there isn't one.
 */

export async function buildTicketSummary(stats: HelpTicketStats): Promise<string> {
	const daily = stats.leaderboard
	const global = stats.globalLeaderboard

	// Resolved across both boards in one call: the same helpers usually sit on each, and the second concurrent users.info for a name already being fetched is the request that gets the post rate-limited.
	const names = await getSlackUserNames([...daily, ...global].map((entry) => entry.resolvedBy))

	const board = (title: string, rows: typeof daily): SummaryBoard =>
		rankedShareBoard(
			title,
			rows.map((entry) => ({
				name: names.get(entry.resolvedBy) ?? `<@${entry.resolvedBy}>`,
				count: entry.closed,
			})),
			rows.reduce((n, entry) => n + entry.closed, 0),
		)

	return renderSummary({
		headline: `${countedLine(stats.opened, { singular: "ticket", plural: "tickets" }, { singular: "was opened", plural: "were opened" })} and ${creditedLine(stats.closed, "close")}`,
		boards: [board(":yay-peace: today's leaderboard", daily), board(":yay-blush-2: all-time leaderboard", global)],
	})
}
