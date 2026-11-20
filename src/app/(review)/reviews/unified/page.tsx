import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { PageHead, Paper } from "@/components/review/ui"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { unifiedQueue } from "@/lib/review-platform/unified"

export const metadata: Metadata = { title: "T2 review" }

/** T2's front door: the oldest website approval waiting for this admin, or a note that there is none. As on Fabricate, there is no list – T2 is worked through in order. */
export default async function UnifiedQueuePage() {
	const { user } = await requirePermissionPage(Permission.REVIEW_UNIFIED)
	const [first] = await unifiedQueue(user.id)
	if (first) redirect(`/reviews/unified/${first}`)
	return (
		<>
			<PageHead
				eyebrow={
					<>
						<Link href="/reviews">←</Link> · Unified
					</>
				}
				title="T2 review"
			/>
			<Paper>
				<p className="field__hint">
					Nothing is waiting for T2. Website approvals show up here once they&rsquo;re approved, except your own
					projects and the ones you approved yourself.
				</p>
			</Paper>
		</>
	)
}
