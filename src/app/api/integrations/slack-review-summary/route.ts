import type { NextRequest } from "next/server"
import { fail, ok } from "@/lib/api"
import { postSlackOrThrow, wantsDryRun, withIntegrationRoute } from "@/lib/integration-route"
import { getProjectReviewStats } from "@/lib/site/review-store"
import { buildReviewSummary } from "@/lib/site/review-summary"
import { summarySince } from "@/lib/site/summary"
import { recordSyncRun } from "@/lib/sync-run-log"

/**
 * Posts the daily project-review summary to `#half-life-review`: how many phases were handed in in the last 24 hours, how many were reviewed, who reviewed the most, and per-week review progress bars.
 *
 * Run by an Orchard `app` job once a day; see `docs/RUNBOOK.md`. Both counts read the review tables rather than Ari – a decision reaches `SubmissionReview` through the same `finalizeReview` a console reviewer calls, so Ari's calls are counted here too.
 *
 * `?dryRun=true` returns the counts and the rendered message without posting, so a schedule can be trusted before it is wired up.
 */
export const POST = withIntegrationRoute(async (req: NextRequest) => {
	const since = summarySince()
	const stats = await getProjectReviewStats(since)

	if (wantsDryRun(req)) {
		return ok({ dryRun: true, since, ...stats, message: await buildReviewSummary(stats) })
	}

	const channel = process.env.SLACK_REVIEW_CHANNEL_ID
	if (!channel) {
		// A missing channel is a misconfiguration, not a quiet no-op: the job's `curl -f` should go red rather than stay green having posted nothing.
		return fail("NOT_CONFIGURED", "Set SLACK_REVIEW_CHANNEL_ID to post the project review summary")
	}

	await postSlackOrThrow(channel, await buildReviewSummary(stats))

	await recordSyncRun("project_review_summary", {
		submitted: stats.submitted,
		reviewed: stats.reviewed,
		reviewers: stats.leaderboard.length,
	})
	return ok({ posted: true, channel, submitted: stats.submitted, reviewed: stats.reviewed })
})
