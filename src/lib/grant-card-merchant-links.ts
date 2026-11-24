import { unionMerchantIds } from "./grant-card-merchants"
import type { DbOrTx } from "./prisma8"

/**
 * Recompute a shop item's flat merchant ID list from the merchants it is linked to. The merchant links are the source of truth; the flat column on the item is a copy that the purchase snapshot and the batch send still read, so every change to the links runs through here to keep the copy in step.
 */
export async function syncItemMerchantIds(tx: DbOrTx, shopItemId: string): Promise<string[]> {
	const links = await tx.orm.public.ShopItemGrantCardMerchant.where({ shopItemId })
		.include("merchant", merchant => merchant.select("merchantIds"))
		.all()
	const merchantIds = unionMerchantIds(links.map(link => link.merchant?.merchantIds ?? []))
	await tx.orm.public.ShopItem.where({ id: shopItemId }).update({ grantCardMerchantIds: merchantIds })
	return merchantIds
}
