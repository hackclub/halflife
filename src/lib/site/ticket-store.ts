import "server-only"

import prisma from "@/lib/prisma"
import { tallyBoard } from "./leaderboard"
import { listChannelHistory, type SlackHistoryMessage } from "./slack"

/**
 * How many tickets this person opened before the current one.
 *
 * The Slack flow keeps no state of its own, so this table is what lets the tickets-channel mirror tell a first-time asker from a repeat one.
 */
export async function countPriorHelpTickets(authorSlackId: string): Promise<number> {
	return prisma.helpTicket.count({ where: { authorSlackId } })
}

/**
 * Remembers a ticket once its mirror has actually reached the tickets channel.
 *
 * Called only on a successful post, so a fail-to-mirror doesn't leave a phantom row that would count toward the next ask. Upsert rather than create because Slack can redeliver an event, and the unique [helpChannel, helpTs] must not turn that into an error.
 */
export async function rememberHelpTicket(input: {
	authorSlackId: string
	helpChannel: string
	helpTs: string
}): Promise<void> {
	await prisma.helpTicket.upsert({
		where: { helpChannel_helpTs: { helpChannel: input.helpChannel, helpTs: input.helpTs } },
		create: input,
		update: {},
	})
}

/**
 * Marks a ticket resolved, called from all three resolution buttons.
 *
 * `updateMany` rather than `update`: a ticket asked before the table existed, or one whose mirror post failed, has no row – resolving it is still a success, not an error. The `resolvedAt: null` guard makes a second resolution a no-op, so two people clicking at once (or a Slack redelivery) cannot move the closer or double-count the ticket in a summary.
 */
export async function resolveHelpTicket(input: {
	helpChannel: string
	helpTs: string
	resolvedBy: string
}): Promise<void> {
	await prisma.helpTicket.updateMany({
		where: { helpChannel: input.helpChannel, helpTs: input.helpTs, resolvedAt: null },
		data: { resolvedAt: new Date(), resolvedBy: input.resolvedBy },
	})
}

export type HelpTicketStats = {
	/** Tickets opened since `since`, by `createdAt`. */
	opened: number
	/** Tickets resolved since `since`, by `resolvedAt`, whoever resolved them. */
	closed: number
	/**
	 * Who closed what, busiest first. Self-resolutions are left out: the leaderboard is the helpers' competition, and an asker clicking "I'm all set" on their own ticket would read as a helper. Ties break by id so the order is stable between runs.
	 */
	leaderboard: { resolvedBy: string; closed: number }[]
	/**
	 * The same board over every ticket on file rather than the last day. Read separately instead of by folding daily runs together: the leaderboard's ranking changes as names resolve and a run that has not fired yet would leave a gap, whereas one query over the table is whatever has actually been closed.
	 */
	globalLeaderboard: { resolvedBy: string; closed: number }[]
}

/** Closers only: the helpers' competition, with self-resolutions left out. */
function closerBoard(rows: { resolvedBy: string | null; authorSlackId: string }[]): HelpTicketStats["leaderboard"] {
	return tallyBoard(
		rows,
		(row) => row.resolvedBy,
		(row, key) => key === row.authorSlackId,
	).map(({ key: resolvedBy, count: closed }) => ({ resolvedBy, closed }))
}

/** The counts behind the daily summary. `since` is normally 24 hours ago. */
export async function getHelpTicketStats(since: Date): Promise<HelpTicketStats> {
	const [opened, closedRows, allClosedRows] = await Promise.all([
		prisma.helpTicket.count({ where: { createdAt: { gte: since } } }),
		prisma.helpTicket.findMany({
			where: { resolvedAt: { gte: since }, resolvedBy: { not: null } },
			select: { resolvedBy: true, authorSlackId: true },
		}),
		// Every closed ticket ever, for the all-time board under the daily one.
		prisma.helpTicket.findMany({
			where: { resolvedAt: { not: null }, resolvedBy: { not: null } },
			select: { resolvedBy: true, authorSlackId: true },
		}),
	])

	return {
		opened,
		closed: closedRows.length,
		leaderboard: closerBoard(closedRows),
		globalLeaderboard: closerBoard(allClosedRows),
	}
}

/** A history message that opened a ticket, under the same guards
 * `handleHelpMessage` applies to a live event. A parent message carries `thread_ts` equal to its own `ts` once it has replies, so it only counts as
 * a reply when the two differ. A message sharing a file (e.g. a photo) carries subtype `file_share`, so that subtype still opens a ticket. */
function isTicketOpeningMessage(
	message: SlackHistoryMessage,
): message is SlackHistoryMessage & { user: string; ts: string } {
	return (
		message.type === "message" &&
		(!message.subtype || message.subtype === "file_share") &&
		!message.bot_id &&
		Boolean(message.user) &&
		Boolean(message.ts) &&
		(!message.thread_ts || message.thread_ts === message.ts)
	)
}

/**
 * Seeds the table from the questions already sitting in #half-life-help.
 *
 * The live flow only records tickets from the moment it ships, so without this staff would see everyone as a first-timer until they ask again. Each top-level, non-bot question in the channel is one ticket. Idempotent: rows are keyed by [helpChannel, helpTs] and duplicates are skipped, so it is safe to run again after a partial sweep.
 */
export async function backfillHelpTickets(channel: string): Promise<{
	scanned: number
	created: number
	exhausted: boolean
}> {
	const { messages, exhausted } = await listChannelHistory(channel)
	const rows = messages.filter(isTicketOpeningMessage).map((message) => ({
		authorSlackId: message.user,
		helpChannel: channel,
		helpTs: message.ts,
		// The question's own time, not the backfill's, so the rows order as the conversation actually happened.
		createdAt: new Date(Number(message.ts) * 1000),
	}))

	// Chunked so a long channel does not exceed one INSERT's parameter limit; `skipDuplicates` is the idempotency.
	const CHUNK = 1000
	let created = 0
	for (let i = 0; i < rows.length; i += CHUNK) {
		const result = await prisma.helpTicket.createMany({
			data: rows.slice(i, i + CHUNK),
			skipDuplicates: true,
		})
		created += result.count
	}

	return { scanned: messages.length, created, exhausted }
}
