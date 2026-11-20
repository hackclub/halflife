import { describe, expect, test } from "bun:test"
import {
	groupLegacyShopBuyers,
	isSlackUserId,
	LEGACY_SHOP_ACTION_PREFIX,
	LEGACY_SHOP_DM_MAX_ORDERS,
	type LegacyShopOrderRow,
	legacyShopButtonValue,
	legacyShopMessage,
	parseLegacyShopButtonValue,
} from "@/lib/legacy-shop-dm-policy"

const order = (orderId: string, userId: string, orderNumber: number): LegacyShopOrderRow => ({
	itemName: `Item ${orderId}`,
	orderId,
	orderNumber,
	userId,
})

describe("isSlackUserId", () => {
	test("accepts user and workspace-user shapes", () => {
		expect(isSlackUserId("U01ABCDEF")).toBe(true)
		expect(isSlackUserId("W0123456789")).toBe(true)
	})

	test("rejects mentions, lower case and short strings", () => {
		expect(isSlackUserId("@lewin")).toBe(false)
		expect(isSlackUserId("u01abcdef")).toBe(false)
		expect(isSlackUserId("U1")).toBe(false)
		expect(isSlackUserId("")).toBe(false)
	})
})

describe("button values", () => {
	test("a value round-trips through the parser", () => {
		const value = legacyShopButtonValue({ choice: "GRANT_CARD", orderId: "ord_1" })
		expect(parseLegacyShopButtonValue(value)).toEqual({ choice: "GRANT_CARD", orderId: "ord_1" })
	})

	test("malformed, missing or unknown values are refused", () => {
		expect(parseLegacyShopButtonValue(undefined)).toBeNull()
		expect(parseLegacyShopButtonValue("not json")).toBeNull()
		expect(parseLegacyShopButtonValue(JSON.stringify({ choice: "BOTH", orderId: "ord_1" }))).toBeNull()
		expect(parseLegacyShopButtonValue(JSON.stringify({ choice: "SHIP", orderId: "" }))).toBeNull()
	})
})

describe("legacyShopMessage", () => {
	test("each order gets its own two buttons carrying its ID", () => {
		const message = legacyShopMessage(
			[
				{ choice: null, itemName: "Sticker", orderId: "ord_1", orderNumber: 12 },
				{ choice: "SHIP", itemName: "Hoodie", orderId: "ord_2", orderNumber: 13 },
			],
			false,
		)
		const buttons = message.blocks.flatMap(block =>
			block.type === "actions" && Array.isArray(block.elements)
				? (block.elements as { action_id: string; value: string }[])
				: [],
		)
		expect(buttons).toHaveLength(4)
		expect(buttons.every(button => button.action_id.startsWith(LEGACY_SHOP_ACTION_PREFIX))).toBe(true)
		expect(new Set(buttons.slice(0, 2).map(button => button.action_id)).size).toBe(2)
		expect(parseLegacyShopButtonValue(buttons[0]?.value)?.orderId).toBe("ord_1")
		expect(parseLegacyShopButtonValue(buttons[3]?.value)?.orderId).toBe("ord_2")
	})

	test("the current choice is shown per order", () => {
		const message = legacyShopMessage(
			[{ choice: "GRANT_CARD", itemName: "Sticker", orderId: "ord_1", orderNumber: 12 }],
			false,
		)
		expect(JSON.stringify(message.blocks)).toContain("Your choice: Grant card")
	})

	test("item names are escaped so they cannot inject markup", () => {
		const message = legacyShopMessage(
			[{ choice: null, itemName: "<!channel> & *bold*", orderId: "ord_1", orderNumber: 1 }],
			false,
		)
		expect(JSON.stringify(message.blocks)).toContain("&lt;!channel&gt; &amp; *bold*")
	})

	test("a test message carries no order and marks its buttons as test", () => {
		const message = legacyShopMessage([{ choice: null, itemName: "Sample", orderId: null, orderNumber: null }], true)
		const values = message.blocks.flatMap(block =>
			block.type === "actions" && Array.isArray(block.elements)
				? (block.elements as { value: string }[]).map(element => parseLegacyShopButtonValue(element.value))
				: [],
		)
		expect(values.every(value => value?.test === true && value.orderId === undefined)).toBe(true)
		expect(message.text).toContain("Test")
	})
})

describe("groupLegacyShopBuyers", () => {
	const slackIds = new Map([
		["u_a", { name: "Ada", slackId: "U0AAAAAAA" }],
		["u_b", { name: "Bea", slackId: "U0BBBBBBB" }],
		["u_c", { name: null, slackId: null }],
	])

	test("groups orders by buyer, oldest order first", () => {
		const buyers = groupLegacyShopBuyers(
			[order("o3", "u_a", 3), order("o1", "u_a", 1), order("o2", "u_b", 2)],
			new Set(),
			slackIds,
		)
		const a = buyers.find(buyer => buyer.userId === "u_a")
		expect(a?.orders.map(o => o.orderId)).toEqual(["o1", "o3"])
		expect(a?.skipReason).toBeNull()
		expect(a?.name).toBe("Ada")
	})

	test("orders a live DM already lists are left out", () => {
		const buyers = groupLegacyShopBuyers([order("o1", "u_a", 1), order("o2", "u_a", 2)], new Set(["o1"]), slackIds)
		expect(buyers[0]?.orders.map(o => o.orderId)).toEqual(["o2"])
	})

	test("a buyer whose orders are all sent does not appear", () => {
		const buyers = groupLegacyShopBuyers([order("o1", "u_a", 1)], new Set(["o1"]), slackIds)
		expect(buyers).toEqual([])
	})

	test("a buyer with no Slack ID is listed but skipped", () => {
		const buyers = groupLegacyShopBuyers([order("o1", "u_c", 1)], new Set(), slackIds)
		expect(buyers[0]?.skipReason).toBe("No Slack ID on the account")
	})

	test("a buyer with too many orders is listed but skipped", () => {
		const many = Array.from({ length: LEGACY_SHOP_DM_MAX_ORDERS + 1 }, (_, i) => order(`o${i}`, "u_a", i + 1))
		const buyers = groupLegacyShopBuyers(many, new Set(), slackIds)
		expect(buyers[0]?.skipReason).toContain("too many for one DM")
	})
})
