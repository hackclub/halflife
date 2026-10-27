import { ShopFulfillmentStage, ShopOrderStatus } from "@/lib/enums"

/**
 * Whether a participant can still cancel this order themselves.
 *
 * Only while it is awaiting a decision and nothing has been ordered from a vendor. Once staff mark it ordered to HQ or sent for delivery, the coins are tied to a real purchase and only staff can decide what happens; after it is fulfilled, rejected or cancelled there is nothing left to undo.
 */
export function canCancelOrder(order: { fulfillmentStage: ShopFulfillmentStage; status: ShopOrderStatus }): boolean {
	return (
		(order.status === ShopOrderStatus.PENDING || order.status === ShopOrderStatus.ON_HOLD)
		&& order.fulfillmentStage === ShopFulfillmentStage.UNFULFILLED
	)
}

/**
 * Why the cancel action is not offered, in the participant's terms, or null when it is.
 *
 * The sheet says which one applies rather than only hiding the button, so an order past the self-service window has somewhere to go: staff can still reject and refund it.
 */
export function cancelBlockedReason(order: {
	fulfillmentStage: ShopFulfillmentStage
	status: ShopOrderStatus
}): string | null {
	if (canCancelOrder(order)) return null
	if (order.status === ShopOrderStatus.CANCELLED) return "This order was cancelled."
	if (order.status === ShopOrderStatus.REJECTED) return "This order was rejected and refunded."
	if (order.status === ShopOrderStatus.FULFILLED) return "This order has been fulfilled."
	if (order.fulfillmentStage === ShopFulfillmentStage.CANCELLED) return "This order is marked cancelled."
	if (order.fulfillmentStage === ShopFulfillmentStage.SENT_FOR_DELIVERY)
		return "This order has been sent for delivery. Ask staff if you need to cancel it."
	return "Staff have already ordered this item. Ask staff if you need to cancel it."
}
