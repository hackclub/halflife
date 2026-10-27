import { describe, expect, test } from "bun:test"
import { ShopFulfillmentStage, ShopOrderStatus } from "@/lib/enums"
import { canCancelOrder, cancelBlockedReason } from "@/lib/shop-order"

const order = (status: ShopOrderStatus, fulfillmentStage: ShopFulfillmentStage) => ({ fulfillmentStage, status })

describe("canCancelOrder", () => {
	test("a pending or held order that nothing has been ordered for can be cancelled", () => {
		expect(canCancelOrder(order(ShopOrderStatus.PENDING, ShopFulfillmentStage.UNFULFILLED))).toBe(true)
		expect(canCancelOrder(order(ShopOrderStatus.ON_HOLD, ShopFulfillmentStage.UNFULFILLED))).toBe(true)
	})

	test("once staff order the item it is theirs to cancel", () => {
		expect(canCancelOrder(order(ShopOrderStatus.PENDING, ShopFulfillmentStage.ORDERED_TO_HQ))).toBe(false)
		expect(canCancelOrder(order(ShopOrderStatus.ON_HOLD, ShopFulfillmentStage.SENT_FOR_DELIVERY))).toBe(false)
	})

	test("a decided order cannot be cancelled again", () => {
		for (const status of [ShopOrderStatus.FULFILLED, ShopOrderStatus.REJECTED, ShopOrderStatus.CANCELLED])
			expect(canCancelOrder(order(status, ShopFulfillmentStage.UNFULFILLED))).toBe(false)
	})

	test("a stage-only cancellation is not cancellable again", () => {
		expect(canCancelOrder(order(ShopOrderStatus.PENDING, ShopFulfillmentStage.CANCELLED))).toBe(false)
	})
})

describe("cancelBlockedReason", () => {
	test("returns null while the action is available", () => {
		expect(cancelBlockedReason(order(ShopOrderStatus.PENDING, ShopFulfillmentStage.UNFULFILLED))).toBeNull()
	})

	test("names the state that closed the window", () => {
		expect(cancelBlockedReason(order(ShopOrderStatus.CANCELLED, ShopFulfillmentStage.CANCELLED))).toContain("cancelled")
		expect(cancelBlockedReason(order(ShopOrderStatus.REJECTED, ShopFulfillmentStage.UNFULFILLED))).toContain("rejected")
		expect(cancelBlockedReason(order(ShopOrderStatus.FULFILLED, ShopFulfillmentStage.SENT_FOR_DELIVERY))).toContain(
			"fulfilled",
		)
		expect(cancelBlockedReason(order(ShopOrderStatus.PENDING, ShopFulfillmentStage.ORDERED_TO_HQ))).toContain("staff")
		expect(cancelBlockedReason(order(ShopOrderStatus.PENDING, ShopFulfillmentStage.SENT_FOR_DELIVERY))).toContain(
			"delivery",
		)
	})
})
