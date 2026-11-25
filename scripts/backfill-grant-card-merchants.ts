import "../src/lib/auth"
import { syncItemMerchantIds } from "../src/lib/grant-card-merchant-links"
import db from "../src/lib/prisma8"

/**
 * Move each shop item's flat merchant ID list into the merchants table: one merchant per item that has IDs and no links yet, named after the item, with the item linked to it. Items already linked are left alone, so this is safe to run again.
 *
 * A dry run by default. Pass `--apply` to write.
 *
 * Run with `bun --conditions=react-server scripts/backfill-grant-card-merchants.ts [--apply]`.
 */
const apply = process.argv.includes("--apply")

async function main() {
	const items = (await db.orm.public.ShopItem.select("id", "name", "grantCardMerchantIds").all()).filter(
		item => item.grantCardMerchantIds.length > 0,
	)
	const links = await db.orm.public.ShopItemGrantCardMerchant.select("shopItemId").all()
	const linked = new Set(links.map(link => link.shopItemId))
	const todo = items.filter(item => !linked.has(item.id))

	if (todo.length === 0) {
		console.log("every item with merchant IDs already links to a merchant")
		return
	}
	for (const item of todo)
		console.log(`${item.name}: ${item.grantCardMerchantIds.length} IDs -> merchant "item-${item.id}"`)

	if (!apply) {
		console.log(
			`\ndry run: ${todo.length} item${todo.length === 1 ? "" : "s"} would be backfilled. Pass --apply to write.`,
		)
		return
	}

	for (const item of todo) {
		await db.transaction(async tx => {
			const merchant = await tx.orm.public.GrantCardMerchant.create({
				merchantIds: [...item.grantCardMerchantIds],
				name: item.name,
				slug: `item-${item.id}`,
				sourceNote: "Backfilled from the item's own list",
			})
			await tx.orm.public.ShopItemGrantCardMerchant.create({ merchantId: merchant.id, shopItemId: item.id })
			await syncItemMerchantIds(tx, item.id)
		})
		console.log(`backfilled ${item.name}`)
	}
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exit(1)
} finally {
	await db.close()
}
