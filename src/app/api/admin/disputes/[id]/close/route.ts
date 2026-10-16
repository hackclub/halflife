import { ok, withRoute } from "@/lib/api"
import { closeDispute } from "@/lib/disputes"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Leave the disputed decision standing and close the dispute.
 *
 * A reviewer's judgement that the decision was right, so nothing moves but the dispute itself. Sending one back for review is the other ending, and is gated harder (`send-back`).
 */
export const POST = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.REVIEW_SUBMISSIONS)
	if (gate.error) return gate.error
	const { id } = await params

	await closeDispute(id, gate.user.id, gate.user.email)
	return ok({ resolved: true })
})
