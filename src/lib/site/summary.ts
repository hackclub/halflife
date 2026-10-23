import { DAY_MS } from "@/lib/time"

/**
 * How a daily summary post is put together.
 *
 * The tickets and project-review summaries are the same post with different nouns – an opener, a 24-hour line, and one or more leaderboards – so the shape lives here and each summary supplies only what is actually different about it. They drifted apart when each carried its own copy: the review summary learned to resolve names in one batch because `users.info` is rate-limited, and the ticket summary kept firing a lookup per row. One module means the next fix reaches both.
 *
 * The register is the one the rest of the bot uses (see `tickets.ts`): lowercase, an emoji to open, a first-person narrator who is a cat and is not the one doing the work.
 */

/** How many rows a board prints before it collapses into an overflow note. */
const LEADERBOARD_LIMIT = 10

/**
 * The window every daily summary covers.
 *
 * Kept next to the `":mc-clock: in the last 24 hours..."` line that promises it, so the two cannot drift – the constant used to live in each route and the line here, and nothing stopped someone changing one without the other.
 */
const SUMMARY_WINDOW_MS = DAY_MS

/** The start of the window, for a caller that wants to pass the `since` down to a query. */
const summarySince = (now: Date = new Date()): Date => new Date(now.getTime() - SUMMARY_WINDOW_MS)

const OPENING =
	"um, um, hi there! hope i'm not disturbing you, but i just wanted to let you know that i've got some stats for you! :yay:"
const CLOCK_LINE = ":mc-clock: in the last 24 hours..."
const NOTHING_YET = "no one yet – there's still time... :yay-bazooka:"

/**
 * A count that is stated rather than congratulated: "no new tickets were opened", "1 total ticket was opened", "12 total tickets were opened".
 *
 * The noun and the verb are separate because the two summaries use the same shape and different words for both – "tickets were opened" against "submissions were handed in". The verb carries its own singular form because the count decides it: "1 total submission was handed in", not "were".
 */
export function countedLine(
	count: number,
	nouns: { singular: string; plural: string },
	verb: { singular: string; plural: string },
): string {
	if (count === 0) return `no new ${nouns.plural} ${verb.plural}`
	if (count === 1) return `1 total ${nouns.singular} ${verb.singular}`
	return `${count} total ${nouns.plural} ${verb.plural}`
}

/**
 * The same count read as somebody's work rather than the programme's: nothing at all, or the effort with the same congratulation whatever the number.
 */
export function creditedLine(count: number, verb: string): string {
	if (count === 0) return `you didn't ${verb} any of them this time :(`
	return `you managed to ${verb} ${count}! congrats!! :D`
}

/**
 * A board's heading, its rows, and the overflow note when there were more helpers than rows.
 *
 * `total` is the board's real length rather than the rows rendered, so the note counts what is actually cut off.
 */
export function boardSection(title: string, total: number, lines: readonly string[]): string[] {
	const section = [title, ...(lines.length > 0 ? lines : [NOTHING_YET])]
	if (total > LEADERBOARD_LIMIT) section.push(`(plus ${total - LEADERBOARD_LIMIT} more)`)
	return section
}

/** How wide a share bar is, in characters. Fixed, so every row is the same length and the counts line up. */
export const SHARE_BAR_WIDTH = 20

/**
 * A leaderboard with the share chart merged into each row: ` 1. ████████████░░░░░░░░  Bunny Pranav  164  29%`.
 *
 * One fence holds the whole board, so bars, names, counts and shares all line up – Slack only renders monospace in fences, and split across a table and a separate chart the two could never share columns. Shares read against the full `total` behind the board, not just the rows printed, so they do not sum to 100 when the overflow note says more were cut. An empty board stays an empty board, and the shared "no one yet" fallback says so.
 */
export function rankedShareBoard(title: string, items: { name: string; count: number }[], total: number): SummaryBoard {
	const shown = items.slice(0, LEADERBOARD_LIMIT)
	if (shown.length === 0) return { lines: [], title, total: 0 }
	const nameWidth = Math.max(...shown.map(item => item.name.length))
	const countWidth = Math.max(...shown.map(item => `${item.count}`.length))
	const rankWidth = `${shown.length}`.length + 1
	const lines = [
		"```",
		...shown.map((item, index) => {
			const share = total === 0 ? 0 : item.count / total
			const filled = Math.round(share * SHARE_BAR_WIDTH)
			const bar = "█".repeat(filled) + "░".repeat(SHARE_BAR_WIDTH - filled)
			return `${`${index + 1}.`.padStart(rankWidth)} ${bar}  ${item.name.padEnd(nameWidth)} ${`${item.count}`.padStart(countWidth)} ${`${Math.round(share * 100)}%`.padStart(4)}`
		}),
		"```",
	]
	return { lines, title, total: items.length }
}

/** One leaderboard as it appears in a post, before the names in it have been resolved. */
export interface SummaryBoard {
	/** Already-rendered rows; empty means the board falls back to the "no one yet" line. */
	lines: readonly string[]
	title: string
	/** The board's real length, for the overflow note. */
	total: number
}

/** The finished post: opener, the day's numbers, then each board separated by a blank line. */
export function renderSummary(input: { headline: string; boards: readonly SummaryBoard[] }): string {
	const sections = input.boards.flatMap(board => ["", ...boardSection(board.title, board.total, board.lines)])
	return [OPENING, "", CLOCK_LINE, `:yay-love: ${input.headline}`, ...sections].join("\n")
}

export { LEADERBOARD_LIMIT, SUMMARY_WINDOW_MS, summarySince }
