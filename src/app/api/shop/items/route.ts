import { ok } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { getShopAccess } from "@/lib/program"
import { getShopItemsFor } from "@/lib/shop"

export const dynamic = "force-dynamic"

export const GET = withSession(async (_req: Request, { gate }) => {
	const [{ items, balances, regions, regionId }, access] = await Promise.all([
		getShopItemsFor(gate.user.id),
		getShopAccess(gate.user.id),
	])

	return ok({ access, balances, items, regionId, regions })
})
