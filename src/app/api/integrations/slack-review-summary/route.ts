import type { NextRequest } from "next/server"
import { fail, ok, withRoute } from "@/lib/api"
import { requireIntegrationAuth } from "@/lib/integration-auth"
import { postMessage } from "@/lib/site/slack"
import { getProjectReviewStats } from "@/lib/site/review-store"
import { buildReviewSummary } from "@/lib/site/review-summary"
import { recordSyncRun } from "@/lib/sync-run-log"

const WINDOW_MS = 24 * 60 * 60 * 1000

export const POST = withRoute(async (req: NextRequest) => {
	const denied = requireIntegrationAuth(req)
	if (denied) return denied

	const since = new Date(Date.now() - WINDOW_MS)
	const stats = await getProjectReviewStats(since)

	if (req.nextUrl.searchParams.get("dryRun") === "true") {
		return ok({ dryRun: true, since, ...stats, message: await buildReviewSummary(stats) })
	}

	const channel = process.env.SLACK_REVIEW_CHANNEL_ID
	if (!channel) {
		return fail("NOT_CONFIGURED", "Set SLACK_REVIEW_CHANNEL_ID to post the project review summary")
	}

	const message = await buildReviewSummary(stats)
	const result = await postMessage(channel, message)
	if (!result.ok) throw new Error(`Slack chat.postMessage failed: ${result.error ?? "unknown error"}`)

	await recordSyncRun("project_review_summary", {
		submitted: stats.submitted,
		reviewed: stats.reviewed,
		reviewers: stats.leaderboard.length,
	})
	return ok({ posted: true, channel, submitted: stats.submitted, reviewed: stats.reviewed })
})