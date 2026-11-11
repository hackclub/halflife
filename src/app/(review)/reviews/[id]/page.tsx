import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ShipReview } from "@/components/review/ShipReview"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getReviewDetail } from "@/lib/review-platform/queries"
import { reviewViewerFor } from "@/lib/review-platform/viewer"

export const metadata: Metadata = { title: "Review" }

interface Props {
	params: Promise<{ id: string }>
}

export default async function ReviewPage({ params }: Props) {
	const viewer = reviewViewerFor(await requirePermissionPage(Permission.REVIEW_SUBMISSIONS))
	const { id } = await params
	const detail = await getReviewDetail(id, viewer)
	if (!detail) notFound()
	return <ShipReview detail={detail} viewer={viewer} />
}
