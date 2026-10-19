import type { NextRequest } from "next/server"
import { fail, ok } from "@/lib/api"
import { postSlackOrThrow, wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import { summarySince } from "@/lib/site/summary"
import { getHelpTicketStats } from "@/lib/site/ticket-store"
import { buildTicketSummary } from "@/lib/site/ticket-summary"
import { recordSyncRun } from "@/lib/sync-run-log"

/**
 * Posts the daily #half-life-help ticket summary to the private tickets channel: how many tickets were opened in the last 24 hours, how many were closed, and who closed the most.
 *
 * Run by an Orchard `app` job once a day; see `docs/RUNBOOK.md`. The opened count reads `createdAt` and the closed count `resolvedAt`, both written by the Slack flow itself – `resolveHelpTicket` on any of the three resolution buttons, `rememberHelpTicket` when a ticket's mirror posts.
 *
 * `?dryRun=true` returns the counts and the rendered message without posting, so a schedule can be trusted before it is wired up.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const since = summarySince()
	const stats = await getHelpTicketStats(since)

	if (wantsDryRun(req)) return ok({ dryRun: true, since, ...stats, message: await buildTicketSummary(stats) })

	const channel = process.env.SLACK_TICKETS_CHANNEL_ID
	if (!channel)
		// A missing channel is a misconfiguration, not a quiet no-op: the job's `curl -f` should go red rather than stay green having posted nothing.
		return fail("NOT_CONFIGURED", "Set SLACK_TICKETS_CHANNEL_ID to post the ticket summary")

	await postSlackOrThrow(channel, await buildTicketSummary(stats))

	await recordSyncRun("help_ticket_summary", {
		closed: stats.closed,
		helpers: stats.leaderboard.length,
		opened: stats.opened,
	})
	return ok({ channel, closed: stats.closed, opened: stats.opened, posted: true })
})
