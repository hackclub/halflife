import "server-only"

import prisma from "@/lib/prisma"
import { listChannelHistory, type SlackHistoryMessage } from "./slack"

/**
 * How many tickets this person opened before the current one.
 *
 * The Slack flow keeps no state of its own, so this table is what lets the
 * tickets-channel mirror tell a first-time asker from a repeat one.
 */
export async function countPriorHelpTickets(authorSlackId: string): Promise<number> {
	return prisma.helpTicket.count({ where: { authorSlackId } })
}

/**
 * Remembers a ticket once its mirror has actually reached the tickets channel.
 *
 * Called only on a successful post, so a fail-to-mirror doesn't leave a
 * phantom row that would count toward the next ask. Upsert rather than create
 * because Slack can redeliver an event, and the unique [helpChannel, helpTs]
 * must not turn that into an error.
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

/** A history message that opened a ticket, under the same guards
 * `handleHelpMessage` applies to a live event. A parent message carries
 * `thread_ts` equal to its own `ts` once it has replies, so it only counts as
 * a reply when the two differ. */
function isTicketOpeningMessage(
	message: SlackHistoryMessage,
): message is SlackHistoryMessage & { user: string; ts: string } {
	return (
		message.type === "message" &&
		!message.subtype &&
		!message.bot_id &&
		Boolean(message.user) &&
		Boolean(message.ts) &&
		(!message.thread_ts || message.thread_ts === message.ts)
	)
}

/**
 * Seeds the table from the questions already sitting in #half-life-help.
 *
 * The live flow only records tickets from the moment it ships, so without this
 * staff would see everyone as a first-timer until they ask again. Each
 * top-level, non-bot question in the channel is one ticket. Idempotent: rows
 * are keyed by [helpChannel, helpTs] and duplicates are skipped, so it is safe
 * to run again after a partial sweep.
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
		// The question's own time, not the backfill's, so the rows order as the
		// conversation actually happened.
		createdAt: new Date(Number(message.ts) * 1000),
	}))

	// Chunked so a long channel does not exceed one INSERT's parameter limit;
	// `skipDuplicates` is the idempotency.
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
