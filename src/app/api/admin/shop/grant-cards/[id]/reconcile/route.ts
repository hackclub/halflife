import { ok } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { reconcileShopGrantCard } from "@/lib/shop-grant-cards"

interface Params {
	params: Promise<{ id: string }>
}

/** Check an ambiguous, failed or abandoned shop card attempt against HCB. */
export const POST = withWritePermission(
	Permission.FULFILL_ORDERS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		return ok({ card: await reconcileShopGrantCard(id, gate.user) })
	},
)
