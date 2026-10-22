import { ok } from "@/lib/api"
import { sendDisputedPhaseBack } from "@/lib/disputes"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Agree with a dispute and send the hand-in back for a fresh review.
 *
 * This undoes a decision and re-sends the ship, so it needs `OVERRIDE_DECISIONS` rather than the plain review permission that replying and closing take.
 */
export const POST = withPermission(
	Permission.OVERRIDE_DECISIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		await sendDisputedPhaseBack(id, gate.user.id, gate.user.email)
		return ok({ sentBack: true })
	},
)
