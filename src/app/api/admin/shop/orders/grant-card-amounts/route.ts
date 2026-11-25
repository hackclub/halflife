import { ok, parseBody } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { shopGrantCardAmountSchema } from "@/lib/schemas/admin"
import { fillGrantCardAmounts } from "@/lib/shop-grant-card-amounts"

/**
 * Give orders placed without a grant card amount one, from their item's current cost.
 *
 * Each order is checked and filled on its own, so one that cannot be filled does not stop the rest; its reason comes back in `outcomes`.
 */
export const POST = withWritePermission(Permission.FULFILL_ORDERS, async (req: Request, { gate }: AuthedContext) => {
	const parsed = await parseBody(req, shopGrantCardAmountSchema)
	if (parsed.error) return parsed.error
	return ok({ outcomes: await fillGrantCardAmounts(parsed.data.orderIds, gate.user) })
})
