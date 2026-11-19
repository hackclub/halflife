import { ok } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { issueShopGrantCard } from "@/lib/shop-grant-cards"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Issue the HCB card grant this order asked for instead of shipping.
 *
 * One order, one card. The amount came from the order at purchase, so nothing here is typed in by the person pressing the button.
 */
export const POST = withWritePermission(
	Permission.FULFILL_ORDERS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		return ok({ card: await issueShopGrantCard(id, gate.user) })
	},
)
