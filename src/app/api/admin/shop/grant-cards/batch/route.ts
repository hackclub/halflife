import { ok, parseBody } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { shopGrantCardBatchSchema } from "@/lib/schemas/admin"
import { sendShopGrantCardBatch } from "@/lib/shop-grant-card-batch"

/**
 * Send one item's waiting grant cards in a batch.
 *
 * The body names the item, the orders and the merchant allowlist every card in it carries. Each card still goes through the single-order issue, so each is claimed, audited and fulfilled on its own; an order that fails does not stop the rest, and its reason comes back in `outcomes`.
 */
export const POST = withWritePermission(Permission.FULFILL_ORDERS, async (req: Request, { gate }: AuthedContext) => {
	const parsed = await parseBody(req, shopGrantCardBatchSchema)
	if (parsed.error) return parsed.error
	return ok({ outcomes: await sendShopGrantCardBatch(parsed.data, gate.user) })
})
