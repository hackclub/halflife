import { getSlackUserName } from "./slack"
import type { HelpTicketStats } from "./ticket-store"

/**
 * The daily ticket summary, in the cat's voice the rest of the bot uses.
 *
 * It deliberately keeps to what the table can actually answer: how many
 * tickets were opened, how many were closed, and who closed them. The Stasis
 * sample this is modelled on also listed "assigned" and "still open" counts
 * and a set of ageing tickets — none of which Half Life tracks. The table is
 * also seeded by a backfill, so every pre-launch question looks unresolved;
 * a "still open" number built from it would be wrong rather than merely
 * absent, which is why there isn't one.
 */

const LEADERBOARD_LIMIT = 10

function openedLine(opened: number): string {
	if (opened === 0) return "no new tickets were opened"
	if (opened === 1) return "1 total ticket was opened"
	return `${opened} total tickets were opened`
}

function closedLine(closed: number): string {
	if (closed === 0) return "you didn't close any of them this time :("
	if (closed === 1) return "you managed to close 1 of them! congrats!! :D"
	return `you managed to close ${closed} of them! congrats!! :D`
}

function leaderboardLine(rank: number, name: string, closed: number): string {
	return `${rank}. ${name} - ${closed} closed ${closed === 1 ? "ticket" : "tickets"}`
}

export async function buildTicketSummary(stats: HelpTicketStats): Promise<string> {
	const board = await Promise.all(
		stats.leaderboard
			.slice(0, LEADERBOARD_LIMIT)
			.map(async (entry, index) => leaderboardLine(index + 1, await getSlackUserName(entry.resolvedBy), entry.closed)),
	)

	const lines = [
		"um, um, hi there! hope i'm not disturbing you, but i just wanted to let you know that i've got some stats for you! :yay:",
		"",
		":mc-clock: in the last 24 hours...",
		`:yay-love: ${openedLine(stats.opened)} and ${closedLine(stats.closed)}`,
		"",
		":yay-peace: today's leaderboard",
		...(board.length > 0 ? board : ["no one yet – there's still time... :yay-bazooka:"]),
	]

	if (stats.leaderboard.length > LEADERBOARD_LIMIT) {
		lines.push(`(plus ${stats.leaderboard.length - LEADERBOARD_LIMIT} more)`)
	}

	return lines.join("\n")
}
