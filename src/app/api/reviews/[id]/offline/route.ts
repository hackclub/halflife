import { fail, ok } from "@/lib/api"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { getReviewDetail } from "@/lib/review-platform/queries"
import { reviewViewerFor } from "@/lib/review-platform/viewer"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * A submission's review screen as data, for downloading it to review offline (`/reviews/offline`).
 *
 * Exactly what `/reviews/[id]` renders – `getReviewDetail` with the caller's own viewer – plus the time it was read, which the sync later compares the journal against. Held to the review screen's rules: REVIEW_SUBMISSIONS, and a 404 for your own work.
 */
export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const viewer = reviewViewerFor(gate)
		const packedAt = new Date().toISOString()
		const detail = await getReviewDetail((await params).id, viewer)
		if (!detail) return fail("NOT_FOUND", "No such submission")
		return ok({ detail, packedAt, viewer })
	},
)
