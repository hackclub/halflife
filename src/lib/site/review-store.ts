import "server-only"

import type { Prisma } from "@/app/generated/prisma/client"
import { ReviewPass } from "@/app/generated/prisma/enums"
import prisma from "@/lib/prisma"

export interface ProjectReviewStats {
	/** Phase submissions handed in since `since`, by `createdAt`. */
	submitted: number
	/** Submissions decided since `since`, by the moment they were decided, whoever decided them – including Ari. */
	reviewed: number
	/**
	 * Who reviewed what, busiest first. Only human reviewers, since Ari has no Slack identity to name and is not competing. Ties break by id so the order is stable between runs.
	 */
	leaderboard: { reviewerId: string; reviewed: number }[]
	/**
	 * The same board over every review on file rather than the last day, so the all-time ranking cannot disagree with the table by whatever the daily runs happened to have fired.
	 */
	globalLeaderboard: { reviewerId: string; reviewed: number }[]
}

/** Human reviewers only: Ari carries no Half Life user and is not competing. */
function reviewerBoard(rows: { reviewerId: string | null }[]): ProjectReviewStats["leaderboard"] {
	const counts = new Map<string, number>()
	for (const row of rows) {
		if (!row.reviewerId) continue
		counts.set(row.reviewerId, (counts.get(row.reviewerId) ?? 0) + 1)
	}
	return [...counts.entries()]
		.map(([reviewerId, reviewed]) => ({ reviewerId, reviewed }))
		.sort((a, b) => b.reviewed - a.reviewed || a.reviewerId.localeCompare(b.reviewerId))
}

/** The counts behind the daily project review summary. `since` is normally 24 hours ago. */
export async function getProjectReviewStats(since: Date): Promise<ProjectReviewStats> {
	const live: Prisma.SubmissionReviewWhereInput = {
		invalidated: false,
		pass: ReviewPass.FINAL,
		submission: { themeProject: { deletedAt: null } },
	}

	const [submitted, reviewRows, allReviewRows] = await Promise.all([
		prisma.phaseSubmission.count({ where: { createdAt: { gte: since } } }),
		prisma.submissionReview.findMany({
			where: { ...live, createdAt: { gte: since } },
			select: { reviewerId: true },
		}),
		// Every live review ever, for the all-time board under the daily one.
		prisma.submissionReview.findMany({ where: live, select: { reviewerId: true } }),
	])

	return {
		submitted,
		reviewed: reviewRows.length,
		leaderboard: reviewerBoard(reviewRows),
		globalLeaderboard: reviewerBoard(allReviewRows),
	}
}
