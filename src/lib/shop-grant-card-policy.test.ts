import { describe, expect, test } from "bun:test"
import { ShopDeliveryPreference, ShopOrderStatus } from "@/lib/enums"
import {
	SHOP_GRANT_CARD_INVITE_MESSAGE,
	shopGrantCardBlockReason,
	shopGrantCardInstructions,
} from "@/lib/shop-grant-card-policy"

const order = (overrides: Partial<Parameters<typeof shopGrantCardBlockReason>[0]> = {}) => ({
	deliveryPreference: ShopDeliveryPreference.GRANT_CARD,
	grantCardCents: 1850,
	status: ShopOrderStatus.PENDING,
	...overrides,
})

describe("shopGrantCardBlockReason", () => {
	test("a pending grant card order with an amount is ready", () => {
		expect(shopGrantCardBlockReason(order(), null, true)).toBeNull()
	})

	test("a held order is ready too", () => {
		expect(shopGrantCardBlockReason(order({ status: ShopOrderStatus.ON_HOLD }), null, true)).toBeNull()
	})

	test("a decided order has nothing left to pay", () => {
		for (const status of [ShopOrderStatus.FULFILLED, ShopOrderStatus.REJECTED, ShopOrderStatus.CANCELLED])
			expect(shopGrantCardBlockReason(order({ status }), null, true)).toContain("pending or held")
	})

	test("an order that asked for shipping is not a card", () => {
		expect(shopGrantCardBlockReason(order({ deliveryPreference: ShopDeliveryPreference.SHIP }), null, true)).toContain(
			"did not ask",
		)
		expect(shopGrantCardBlockReason(order({ deliveryPreference: null }), null, true)).toContain("did not ask")
	})

	test("an order with no amount cannot be paid", () => {
		expect(shopGrantCardBlockReason(order({ grantCardCents: null }), null, true)).toContain("no grant card amount")
		expect(shopGrantCardBlockReason(order({ grantCardCents: 0 }), null, true)).toContain("no grant card amount")
	})

	test("a payout block is passed through, so the reason names the account state", () => {
		expect(shopGrantCardBlockReason(order(), "Account is flagged", true)).toBe("Account is flagged")
	})

	test("an unverified buyer is refused", () => {
		expect(shopGrantCardBlockReason(order(), null, false)).toContain("identity")
	})
})

describe("shopGrantCardInstructions", () => {
	test("names the order and the item", () => {
		expect(shopGrantCardInstructions(12, "Soldering kit")).toBe("Order #12: Soldering kit")
	})
})

describe("SHOP_GRANT_CARD_INVITE_MESSAGE", () => {
	test("says shop, not parts", () => {
		expect(SHOP_GRANT_CARD_INVITE_MESSAGE).toContain("shop")
	})
})
