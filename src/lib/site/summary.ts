/**
 * How a daily summary post is put together.
 *
 * The tickets and project-review summaries are the same post with different nouns – an opener, a 24-hour line, and one or more leaderboards – so the shape lives here and each summary supplies only what is actually different about it. They drifted apart when each carried its own copy: the review summary learned to resolve names in one batch because `users.info` is rate-limited, and the ticket summary kept firing a lookup per row. One module means the next fix reaches both.
 *
 * The register is the one the rest of the bot uses (see `tickets.ts`): lowercase, an emoji to open, a first-person narrator who is a cat and is not the one doing the work.
 */

/** How many rows a board prints before it collapses into an overflow note. */
export const LEADERBOARD_LIMIT = 10

/**
 * The window every daily summary covers.
 *
 * Kept next to the `":mc-clock: in the last 24 hours..."` line that promises it, so the two cannot drift – the constant used to live in each route and the line here, and nothing stopped someone changing one without the other.
 */
export const SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000

/** The start of the window, for a caller that wants to pass the `since` down to a query. */
export const summarySince = (now: Date = new Date()): Date => new Date(now.getTime() - SUMMARY_WINDOW_MS)

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
	return `you managed to ${verb} ${count} of them! congrats!! :D`
}

/** One board's rows, already named and ranked – "1. Someone - 4 closed tickets". */
export function leaderboardLine(
	rank: number,
	name: string,
	count: number,
	action: string,
	singular: string,
	plural: string,
): string {
	return `${rank}. ${name} - ${count} ${action} ${count === 1 ? singular : plural}`
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

/** One leaderboard as it appears in a post, before the names in it have been resolved. */
export interface SummaryBoard {
	title: string
	/** The board's real length, for the overflow note. */
	total: number
	/** Already-rendered rows; empty means the board falls back to the "no one yet" line. */
	lines: readonly string[]
}

/** The finished post: opener, the day's numbers, then each board separated by a blank line. */
export function renderSummary(input: { headline: string; boards: readonly SummaryBoard[] }): string {
	const sections = input.boards.flatMap((board) => ["", ...boardSection(board.title, board.total, board.lines)])
	return [OPENING, "", CLOCK_LINE, `:yay-love: ${input.headline}`, ...sections].join("\n")
}
