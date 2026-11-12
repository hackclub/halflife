import type { Metadata } from "next"
import { QueueView } from "@/components/review/QueueView"
import { isTierId } from "@/lib/config/tiers"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getQueue, isReviewStatus, isStarterFilter } from "@/lib/review-platform/queries"
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
	const kind = params.kind === "design" || params.kind === "build" ? params.kind : ""
	const mine = params.mine === "1"
	const tier = Number(params.tier)
	const facets = {
		starter: isStarterFilter(params.starter) ? params.starter : "",
		tier: isTierId(tier) ? tier : null,
		week: /^\d{1,2}$/.test(params.week ?? "") ? Number(params.week) : null,
	}
	const queue = await getQueue({ cursor: params.cursor, facets, kind, mine, status, viewer })
	return <QueueView filters={{ ...facets, kind, mine, status }} queue={queue} />
}
