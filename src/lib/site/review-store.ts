import "server-only"

import prisma from "@/lib/prisma"
import { ReviewPass } from "@/app/generated/prisma/enums"

export interface ProjectReviewStats {
	/** Phase submissions handed in since `since`, by `createdAt`. */
	submitted: number
	/** Submissions decided since `since`, by the moment they were decided, whoever decided them – including Ari. */
	reviewed: number
	/**
	 * Who reviewed what, busiest first. Only human reviewers, since Ari has no Slack identity to name and is not competing. Ties break by id so the order is stable between runs.
	 */
	leaderboard: { reviewerId: string; reviewed: number }[]
}

/** The counts behind the daily project review summary. `since` is normally 24 hours ago. */
export async function getProjectReviewStats(since: Date): Promise<ProjectReviewStats> {
	const [submitted, reviewRows] = await Promise.all([
		prisma.phaseSubmission.count({ where: { createdAt: { gte: since } } }),
		prisma.submissionReview.findMany({
			where: {
				createdAt: { gte: since },
				invalidated: false,
				pass: ReviewPass.FINAL,
				submission: { themeProject: { deletedAt: null } },
			},
			select: { reviewerId: true },
		}),
	])

	const counts = new Map<string, number>()
	for (const row of reviewRows) {
		// Ari's decisions carry no Half Life user, so they sit out of the leaderboard – the same way a self-resolution does not count as a helper.
		if (!row.reviewerId) continue
		counts.set(row.reviewerId, (counts.get(row.reviewerId) ?? 0) + 1)
	}
	const leaderboard = [...counts.entries()]
		.map(([reviewerId, reviewed]) => ({ reviewerId, reviewed }))
		.sort((a, b) => b.reviewed - a.reviewed || a.reviewerId.localeCompare(b.reviewerId))

	return { submitted, reviewed: reviewRows.length, leaderboard }
}