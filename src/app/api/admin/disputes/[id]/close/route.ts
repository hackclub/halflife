import { ok } from "@/lib/api"
import { closeDispute } from "@/lib/disputes"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Leave the disputed decision standing and close the dispute.
 *
 * A reviewer's judgement that the decision was right, so nothing moves but the dispute itself. Sending one back for review is the other ending, and is gated harder (`send-back`).
 */
export const POST = withWritePermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		await closeDispute(id, gate.user.id, gate.user.email)
		return ok({ resolved: true })
	},
)
