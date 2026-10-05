import "server-only"

import prisma from "@/lib/prisma"

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
