import { describe, expect, test } from "bun:test"
import { ShopDeliveryPreference, ShopOrderStatus } from "@/lib/enums"
import {
	shopGrantCardBatchBlockReason,
	shopGrantCardBlockReason,
	shopGrantCardInstructions,
	shopGrantCardInviteMessage,
	shopGrantCardPurpose,
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

describe("shopGrantCardBatchBlockReason", () => {
	const ready = { ...order(), hasLiveCard: false, hasSettledCard: false }

	test("a card order with no card yet belongs in the batch", () => {
		expect(shopGrantCardBatchBlockReason(ready, null)).toBeNull()
	})

	test("a held order belongs in the batch", () => {
		expect(shopGrantCardBatchBlockReason({ ...ready, status: ShopOrderStatus.ON_HOLD }, null)).toBeNull()
	})

	test("an order that asked for shipping is never swept in", () => {
		expect(
			shopGrantCardBatchBlockReason({ ...ready, deliveryPreference: ShopDeliveryPreference.SHIP }, null),
		).toContain("did not ask")
	})

	test("an order whose card is live or settled is left for the single-order panel", () => {
		expect(shopGrantCardBatchBlockReason({ ...ready, hasLiveCard: true }, null)).toContain("in progress")
		expect(shopGrantCardBatchBlockReason({ ...ready, hasSettledCard: true }, null)).toContain("cancelled or returned")
	})

	test("the amount and account checks are the single-order ones", () => {
		expect(shopGrantCardBatchBlockReason({ ...ready, grantCardCents: null }, null)).toContain("no grant card amount")
		expect(shopGrantCardBatchBlockReason(ready, "Account is banned")).toBe("Account is banned")
	})
})

describe("shopGrantCardInstructions", () => {
	test("names the order once and asks for the item", () => {
		expect(shopGrantCardInstructions(12, "Soldering kit")).toBe('Order #12. Please use to purchase "Soldering kit"')
	})
})

describe("shopGrantCardPurpose", () => {
	test("uses the prize prefix", () => {
		expect(shopGrantCardPurpose("Iron")).toBe("Half Life prize – Iron")
	})

	test("cuts a long item name to HCB's limit", () => {
		const purpose = shopGrantCardPurpose("A very long shop item name")
		expect(purpose.startsWith("Half Life prize – ")).toBe(true)
		expect(purpose.length).toBeLessThanOrEqual(30)
	})
})

describe("shopGrantCardInviteMessage", () => {
	test("names the item and says shop, not parts", () => {
		const message = shopGrantCardInviteMessage("Soldering kit")
		expect(message).toContain('shop grant for "Soldering kit"')
		expect(message).not.toContain("parts")
	})
})
