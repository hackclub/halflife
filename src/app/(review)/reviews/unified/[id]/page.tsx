import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { UnifiedCheck } from "@/components/review/UnifiedCheck"
import { UnifiedReview } from "@/components/review/UnifiedReview"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getUnifiedReview } from "@/lib/review-platform/unified"

export const metadata: Metadata = { title: "T2 review" }

interface Props {
	params: Promise<{ id: string }>
}

export default async function UnifiedReviewPage({ params }: Props) {
	const { user } = await requirePermissionPage(Permission.REVIEW_UNIFIED)
	const detail = await getUnifiedReview((await params).id, user.id)
	if (!detail) notFound()
	const fieldValue = (key: string): string => detail.fields.find(field => field.key === key)?.value ?? ""
	return (
		<UnifiedReview
			check={
				<Suspense fallback={<p className="field__hint">Checking Unified for this project…</p>}>
					<UnifiedCheck
						codeUrl={fieldValue("codeUrl")}
						email={fieldValue("email")}
						kind={detail.kind}
						playableUrl={fieldValue("playableUrl")}
					/>
				</Suspense>
			}
			detail={detail}
		/>
	)
}
