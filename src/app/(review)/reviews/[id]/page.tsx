import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { type ReviewTab, ShipReview } from "@/components/review/ShipReview"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getReviewDetail } from "@/lib/review-platform/queries"
import { reviewViewerFor } from "@/lib/review-platform/viewer"

export const metadata: Metadata = { title: "Review" }

const REVIEW_TABS: readonly ReviewTab[] = Object.freeze(["submission", "deflation", "files"])

/** The tab a `?tab=` value names (see `showTab` in ShipReview), or the submission tab for anything else. */
const reviewTabFrom = (value: string | string[] | undefined): ReviewTab =>
	REVIEW_TABS.find(tab => tab === value) ?? "submission"

interface Props {
	params: Promise<{ id: string }>
	searchParams: Promise<{ [_: string]: string | string[] | undefined }>
}

export default async function ReviewPage({ params, searchParams }: Props) {
	const viewer = reviewViewerFor(await requirePermissionPage(Permission.REVIEW_SUBMISSIONS))
	const { id } = await params
	const { tab } = await searchParams
	const detail = await getReviewDetail(id, viewer)
	if (!detail) notFound()
	return <ShipReview detail={detail} initialTab={reviewTabFrom(tab)} viewer={viewer} />
}
