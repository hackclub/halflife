import prisma from "@/lib/prisma"
import type { ProjectReviewStats, WeekReviewProgress } from "./review-store"
import { ANONYMOUS_ARI } from "./review-store"
import { getSlackUserNames } from "./slack"
import { countedLine, creditedLine, LEADERBOARD_LIMIT, renderSummary, type SummaryBoard } from "./summary"

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

/** How wide each week's bar is, in characters. Fixed, so every row is the same length and the counts line up. */
const WEEK_BAR_WIDTH = 10

/**
 * One week's progress as a text bar: `week 1 · PCBs  ██████░░░░   12/20 ·  60%`.
 *
 * Inside a fenced block Slack renders monospace, so the label is padded to the longest week, the bar is a fixed width, and the count and share are padded too – every column lands in the same place on every row. A week with no named projects yet reads `0/0 · 0%` rather than dividing by zero.
 */
function weekBarLine(row: WeekReviewProgress, labelWidth: number, countWidth: number): string {
	const share = row.total === 0 ? 0 : row.reviewed / row.total
	const filled = Math.round(share * WEEK_BAR_WIDTH)
	const bar = "█".repeat(filled) + "░".repeat(WEEK_BAR_WIDTH - filled)
	const count = `${row.reviewed}/${row.total}`.padStart(countWidth)
	const pct = `${Math.round(share * 100)}%`.padStart(4)
	return `${`week ${row.week} · ${row.label}`.padEnd(labelWidth)} ${bar} ${count} · ${pct}`
}

/**
 * The per-week progress section, or null before the programme starts.
 *
 * Fenced so Slack renders it monospace – without the fence the bars wobble in a proportional font and the columns stop lining up. A `SummaryBoard` rather than a special case, so the overflow note and the "no one yet" fallback keep working the way the leaderboards use them; with at most five weeks neither can trigger.
 */
function weekProgressSection(byWeek: WeekReviewProgress[]): SummaryBoard | null {
	if (byWeek.length === 0) return null
	const labelWidth = Math.max(...byWeek.map((row) => `week ${row.week} · ${row.label}`.length))
	const countWidth = Math.max(...byWeek.map((row) => `${row.reviewed}/${row.total}`.length))
	const lines = ["```", ...byWeek.map((row) => weekBarLine(row, labelWidth, countWidth)), "```"]
	return { title: ":bar-chart: reviewed by week", total: byWeek.length, lines }
}

/**
 * A leaderboard with the share chart merged into each row: ` 1. ██████░░░░  Bunny Pranav  164 ·  29%`.
 *
 * One fence holds the whole board, so bars, names, counts and shares all line up – split across a table and a separate chart the two could never share columns. Shares read against every review behind the board, not just the ten printed, so they do not sum to 100 when the overflow note says more were cut. An empty board stays an empty board, and the shared "no one yet" fallback says so.
 */
function rankedBoard(title: string, rows: ProjectReviewStats["leaderboard"], names: Map<string, string>): SummaryBoard {
	const shown = rows.slice(0, LEADERBOARD_LIMIT)
	if (shown.length === 0) return { title, total: 0, lines: [] }
	const total = rows.reduce((n, row) => n + row.reviewed, 0)
	const labelled = shown.map((row) => ({ name: names.get(row.email) ?? row.email, reviewed: row.reviewed }))
	const nameWidth = Math.max(...labelled.map((row) => row.name.length))
	const countWidth = Math.max(...labelled.map((row) => `${row.reviewed}`.length))
	const rankWidth = `${shown.length}`.length + 1
	const lines = [
		"```",
		...labelled.map((row, index) => {
			const share = total === 0 ? 0 : row.reviewed / total
			const filled = Math.round(share * WEEK_BAR_WIDTH)
			const bar = "█".repeat(filled) + "░".repeat(WEEK_BAR_WIDTH - filled)
			return `${`${index + 1}.`.padStart(rankWidth)} ${bar}  ${row.name.padEnd(nameWidth)} ${`${row.reviewed}`.padStart(countWidth)} · ${`${Math.round(share * 100)}%`.padStart(4)}`
		}),
		"```",
	]
	return { title, total: rows.length, lines }
}

export async function buildReviewSummary(stats: ProjectReviewStats): Promise<string> {
	const daily = stats.leaderboard
	const global = stats.globalLeaderboard
	const names = await namesFor([...daily, ...global])

	const weekly = weekProgressSection(stats.byWeek)

	return renderSummary({
		headline: `${countedLine(
			stats.submitted,
			{ singular: "submission", plural: "submissions" },
			{ singular: "was handed in", plural: "were handed in" },
		)} and ${creditedLine(stats.reviewed, "review")}`,
		boards: [
			rankedBoard(":yay-peace: today's leaderboard", daily, names),
			rankedBoard(":yay-blush-2: all-time leaderboard", global, names),
			...(weekly ? [weekly] : []),
		],
	})
}
