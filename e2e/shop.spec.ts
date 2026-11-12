import { readBalance, readShopOrders } from "./db"
import { expect, test } from "./fixtures"

const itemName = "E2E Test Item"

test("a participant confirms their mailing address before buying", async ({ openAs }) => {
	const { page, user } = await openAs({ coins: 130 })
	await page.goto("/shop")

	const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: itemName }) })
	await expect(item).toBeVisible()
	await item.hover()
	await item.getByRole("button", { name: "Buy" }).click()

	const dialog = page.getByRole("dialog", { name: "How should we get this to you?" })
	await expect(dialog).toBeVisible()

	// The delivery choice has to be made before anything else is asked.
	const place = dialog.getByRole("button", { name: "Place order" })
	await expect(place).toBeDisabled()

	await dialog.getByText("Ship it to me", { exact: true }).click()
	await expect(dialog.getByRole("link", { name: "Open Hack Club Auth" })).toHaveAttribute(
		"href",
		"https://auth.hackclub.com",
	)

	// Nothing is ordered until the maker ticks that they have checked the address.
	expect(await readShopOrders(user.id)).toEqual([])
	await expect(place).toBeDisabled()

	await dialog.getByText(/checked my mailing address/i).click()
	await expect(place).toBeEnabled()
	await place.click()

	// The fixture item allows five per person, so a successful first order leaves the card offering another rather than showing the at-limit "Ordered" link.
	await expect(item.getByRole("button", { name: "Order another" })).toBeVisible({ timeout: 15_000 })

	const orders = await readShopOrders(user.id)
	expect(orders).toHaveLength(1)
	expect(orders[0]?.shopItemId).toBe("e2e-item")
	expect(orders[0]?.quantity).toBe(1)
	expect(orders[0]?.deliveryPreference).toBe("SHIP")
	expect(orders[0]?.totalCredits).toBe(60)
	expect(await readBalance(user.id)).toBe(70)
})

test("a participant can ask for a grant card instead of shipping", async ({ openAs }) => {
	const { page, user } = await openAs({ coins: 130 })
	await page.goto("/shop")

	const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: itemName }) })
	await expect(item).toBeVisible()
	await item.hover()
	await item.getByRole("button", { name: "Buy" }).click()

	const dialog = page.getByRole("dialog", { name: "How should we get this to you?" })
	await expect(dialog).toBeVisible()

	await dialog.getByText("Send a grant card instead", { exact: true }).click()
	// The shipping address is not part of this path.
	await expect(dialog.getByRole("link", { name: "Open Hack Club Auth" })).toHaveCount(0)

	const place = dialog.getByRole("button", { name: "Place order" })
	await expect(place).toBeDisabled()
	await dialog.getByText(/get a grant card instead of the item being shipped/i).click()
	await expect(place).toBeEnabled()
	await place.click()

	await expect(item.getByRole("button", { name: "Order another" })).toBeVisible({ timeout: 15_000 })

	const orders = await readShopOrders(user.id)
	expect(orders).toHaveLength(1)
	expect(orders[0]?.deliveryPreference).toBe("GRANT_CARD")
	expect(orders[0]?.totalCredits).toBe(60)
	expect(await readBalance(user.id)).toBe(70)
})

test("dismissing the address check places no order", async ({ openAs }) => {
	const { page, user } = await openAs({ coins: 130 })
	await page.goto("/shop")

	const item = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: itemName }) })
	await expect(item).toBeVisible()
	await item.hover()
	await item.getByRole("button", { name: "Buy" }).click()

	const dialog = page.getByRole("dialog", { name: "How should we get this to you?" })
	await expect(dialog).toBeVisible()
	await dialog.getByRole("button", { name: "Not yet" }).click()
	await expect(dialog).toHaveCount(0)

	expect(await readShopOrders(user.id)).toEqual([])
	expect(await readBalance(user.id)).toBe(130)
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
