import { ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { getShopItemsFor } from "@/lib/shop"
import { getShopAccess } from "@/lib/program"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  const [{ items, balances }, access] = await Promise.all([getShopItemsFor(gate.user.id), getShopAccess(gate.user.id)])

  return ok({ items, balances, access })
})
