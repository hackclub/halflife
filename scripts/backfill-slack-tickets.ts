import "dotenv/config"
import prisma from "../src/lib/prisma"
import { backfillHelpTickets } from "../src/lib/site/ticket-store"

/**
 * Seed the help-ticket history from the questions already in #half-life-help, so the "N previous tickets" note on a new ticket is right for people who asked before the table existed. Safe to run again.
 */
const channel = process.env.SLACK_HELP_CHANNEL_ID
if (!channel) {
	console.error("SLACK_HELP_CHANNEL_ID is not set")
	process.exit(1)
}

backfillHelpTickets(channel)
	.then((result) => {
		console.log("help tickets backfilled:", result)
		if (!result.exhausted) {
			console.warn("channel history was not fully walked; run again to continue")
		}
	})
	.catch((err) => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
