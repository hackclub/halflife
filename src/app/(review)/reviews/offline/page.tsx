import type { Metadata } from "next"
import { OfflineReviews } from "@/components/review/offline/OfflineReviews"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"

export const metadata: Metadata = { title: "Offline reviews" }

/**
 * Offline reviews: download submissions, review them with no connection, send the reviews when back online (see components/review/offline).
 *
 * Everything on it is read in the browser, from what was downloaded, so the page the service worker keeps works on its own. The server only guards it: REVIEW_SUBMISSIONS, as for the rest of the review platform.
 */
export default async function OfflineReviewsPage() {
	await requirePermissionPage(Permission.REVIEW_SUBMISSIONS)
	return <OfflineReviews />
}
