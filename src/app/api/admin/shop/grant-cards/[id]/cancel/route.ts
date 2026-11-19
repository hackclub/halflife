import { ok } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { cancelShopGrantCard } from "@/lib/shop-grant-cards"

interface Params {
	params: Promise<{ id: string }>
}

/** Cancel a live shop card grant and return its remaining balance to the organisation. */
export const POST = withWritePermission(
	Permission.FULFILL_ORDERS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		return ok({ card: await cancelShopGrantCard(id, gate.user) })
	},
)
