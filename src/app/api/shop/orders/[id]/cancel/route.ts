import { ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import { cancelOrderSchema } from "@/lib/schemas/shop"
import { cancelOrder } from "@/lib/shop"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * A participant cancelling their own order.
 *
 * The route is deliberately not gated on the shop being open: a refund must not be held hostage by shop hours. Ownership, the point-of-no-return and the refund arithmetic all live in `cancelOrder`, under the same per-user credit lock the purchase took.
 */
export const POST = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, cancelOrderSchema)
	if (parsed.error) return parsed.error

	const order = await cancelOrder(id, gate.user.id, parsed.data.reason ?? null)

	await logAudit({
		action: AuditAction.USER_CANCEL_ORDER,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			orderNumber: order.orderNumber,
			reason: parsed.data.reason ?? null,
			refunded: order.totalCredits,
		},
		targetId: order.id,
		targetType: "ShopOrder",
	})

	return ok({ order })
})
