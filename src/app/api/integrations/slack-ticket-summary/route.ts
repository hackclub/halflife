import type { NextRequest } from "next/server"
import { fail, ok, withRoute } from "@/lib/api"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import { postMessage } from "@/lib/site/slack"
import { getHelpTicketStats } from "@/lib/site/ticket-store"
import { buildTicketSummary } from "@/lib/site/ticket-summary"
import { recordSyncRun } from "@/lib/sync-run-log"

/** The window every run summarises: "the last 24 hours", as the post says. */
const WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * Posts the daily #half-life-help ticket summary to the private tickets channel: how many tickets were opened in the last 24 hours, how many were closed, and who closed the most.
 *
 * Run by an Orchard `app` job once a day; see `docs/RUNBOOK.md`. The opened count reads `createdAt` and the closed count `resolvedAt`, both written by the Slack flow itself – `resolveHelpTicket` on any of the three resolution buttons, `rememberHelpTicket` when a ticket's mirror posts.
 *
 * `?dryRun=true` returns the counts and the rendered message without posting, so a schedule can be trusted before it is wired up.
 */
export const POST = withRoute(async (req: NextRequest) => {
	const denied = requireIntegrationAuth(req)
	if (denied) return denied

	const since = new Date(Date.now() - WINDOW_MS)
	const stats = await getHelpTicketStats(since)

	if (req.nextUrl.searchParams.get("dryRun") === "true") {
		return ok({ dryRun: true, since, ...stats, message: await buildTicketSummary(stats) })
	}

	const channel = process.env.SLACK_TICKETS_CHANNEL_ID
	if (!channel) {
		// A missing channel is a misconfiguration, not a quiet no-op: the job's `curl -f` should go red rather than stay green having posted nothing.
		return fail("NOT_CONFIGURED", "Set SLACK_TICKETS_CHANNEL_ID to post the ticket summary")
	}

	const message = await buildTicketSummary(stats)
	const result = await postMessage(channel, message)
	if (!result.ok) throw new Error(`Slack chat.postMessage failed: ${result.error ?? "unknown error"}`)

	await recordSyncRun("help_ticket_summary", {
		opened: stats.opened,
		closed: stats.closed,
		helpers: stats.leaderboard.length,
	})
	return ok({ posted: true, channel, opened: stats.opened, closed: stats.closed })
})
