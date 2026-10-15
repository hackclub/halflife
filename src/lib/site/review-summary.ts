import prisma from "@/lib/prisma"
import type { ProjectReviewStats, WeekReviewProgress } from "./review-store"
import { ANONYMOUS_ARI } from "./review-store"
import { getSlackUserNames } from "./slack"
import { countedLine, creditedLine, rankedShareBoard, renderSummary, type SummaryBoard } from "./summary"

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
	const emails = [...new Set(entries.map(entry => entry.email))].filter(email => email !== ANONYMOUS_ARI)
	if (emails.length === 0) {
		for (const entry of entries) names.set(entry.email, "Ari")
		return names
	}

	const users = await prisma.user.findMany({
		where: { email: { in: emails } },
		select: { email: true, slackId: true, name: true, displayName: true },
	})
	const byEmail = new Map(users.map(user => [user.email.trim().toLowerCase(), user]))

	const slackNames = await getSlackUserNames(users.flatMap(user => (user.slackId ? [user.slackId] : [])))

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
const SHARE_BAR_WIDTH = 20

/**
 * One week's progress as a text bar: `week 1 · PCBs  ████████████░░░░░░░░   12/20  60%`.
 *
 * Inside a fenced block Slack renders monospace, so the label is padded to the longest week, the bar is a fixed width, and the count and share are padded too – every column lands in the same place on every row. A week with no named projects yet reads `0/0 0%` rather than dividing by zero.
 */
function weekBarLine(row: WeekReviewProgress, labelWidth: number, countWidth: number): string {
	const share = row.total === 0 ? 0 : row.reviewed / row.total
	const filled = Math.round(share * SHARE_BAR_WIDTH)
	const bar = "█".repeat(filled) + "░".repeat(SHARE_BAR_WIDTH - filled)
	const count = `${row.reviewed}/${row.total}`.padStart(countWidth)
	const pct = `${Math.round(share * 100)}%`.padStart(4)
	return `${`week ${row.week} · ${row.label}`.padEnd(labelWidth)} ${bar} ${count} ${pct}`
}

/**
 * The per-week progress section, or null before the programme starts.
 *
 * Fenced so Slack renders it monospace – without the fence the bars wobble in a proportional font and the columns stop lining up. A `SummaryBoard` rather than a special case, so the overflow note and the "no one yet" fallback keep working the way the leaderboards use them; with at most five weeks neither can trigger.
 */
function weekProgressSection(byWeek: WeekReviewProgress[]): SummaryBoard | null {
	if (byWeek.length === 0) return null
	const labelWidth = Math.max(...byWeek.map(row => `week ${row.week} · ${row.label}`.length))
	const countWidth = Math.max(...byWeek.map(row => `${row.reviewed}/${row.total}`.length))
	const lines = ["```", ...byWeek.map(row => weekBarLine(row, labelWidth, countWidth)), "```"]
	return { title: ":bar-chart: reviewed by week", total: byWeek.length, lines }
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
			rankedShareBoard(
				":yay-peace: today's leaderboard",
				daily.map(row => ({ name: names.get(row.email) ?? row.email, count: row.reviewed })),
				daily.reduce((n, row) => n + row.reviewed, 0),
			),
			rankedShareBoard(
				":yay-blush-2: all-time leaderboard",
				global.map(row => ({ name: names.get(row.email) ?? row.email, count: row.reviewed })),
				global.reduce((n, row) => n + row.reviewed, 0),
			),
			...(weekly ? [weekly] : []),
		],
	})
}
