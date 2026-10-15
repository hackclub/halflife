import type { NextRequest } from "next/server"
import { ok, parseQuery, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { getReviewQueue } from "@/lib/queries/review"
import { reviewQueueQuery } from "@/lib/schemas/review"

export const dynamic = "force-dynamic"

export const GET = withRoute(async (req: NextRequest) => {
	const gate = await requirePermission(Permission.REVIEW_SUBMISSIONS)
	if (gate.error) return gate.error

	const query = parseQuery(req, reviewQueueQuery)
	if (query.error) return query.error

	return ok(
		await getReviewQueue({
			cursor: query.data.cursor,
			limit: query.data.limit,
			phase: query.data.phase,
			reviewerId: gate.user.id,
		}),
	)
})
