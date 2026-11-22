import type { Metadata } from "next"
import { QueueView } from "@/components/review/QueueView"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getQueue, isReviewStatus } from "@/lib/review-platform/queries"
import { queueFiltersFrom } from "@/lib/review-platform/queue-filters"
import { reviewViewerFor } from "@/lib/review-platform/viewer"

export const metadata: Metadata = { title: "Review queue" }

interface Props {
	searchParams: Promise<{
		cursor?: string
		kind?: string
		mine?: string
		starter?: string
		status?: string
		tier?: string
		week?: string
	}>
}

export default async function ReviewQueuePage({ searchParams }: Props) {
	const viewer = reviewViewerFor(await requirePermissionPage(Permission.REVIEW_SUBMISSIONS))
	const params = await searchParams
	const status = isReviewStatus(params.status) ? params.status : "pending"
	const mine = params.mine === "1"
	const { kind, ...facets } = queueFiltersFrom(params)
	const queue = await getQueue({ cursor: params.cursor, facets, kind, mine, status, viewer })
	return (
		<QueueView canReviewUnified={viewer.canReviewUnified} filters={{ ...facets, kind, mine, status }} queue={queue} />
	)
}
