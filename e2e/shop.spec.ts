import { readBalance, readShopOrders } from "./db"
import { expect, test } from "./fixtures"

const itemName = "E2E Test Item"

test("a participant can buy an affordable item", async ({ openAs }) => {
	const { page, user } = await openAs({ coins: 100 })
	await page.goto("/shop")

	const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: itemName }) })
	await expect(item).toBeVisible()
	await item.hover()
	await item.getByRole("button", { name: "Buy" }).click()

	await expect(item.getByRole("button", { name: "Ordered" })).toBeVisible({ timeout: 15_000 })

	const orders = await readShopOrders(user.id)
	expect(orders).toHaveLength(1)
	expect(orders[0]?.shopItemId).toBe("e2e-item")
	expect(orders[0]?.quantity).toBe(1)
	expect(orders[0]?.totalCredits).toBe(60)
	expect(await readBalance(user.id)).toBe(40)
})

test("an unaffordable item refuses the purchase", async ({ openAs }) => {
	const { page, user } = await openAs({ coins: 10 })
	await page.goto("/shop")

	const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: itemName }) })
	await expect(item).toBeVisible()
	await expect(item.getByRole("button", { name: "Not enough coins" })).toBeDisabled()

	expect(await readShopOrders(user.id)).toEqual([])
	expect(await readBalance(user.id)).toBe(10)
})
