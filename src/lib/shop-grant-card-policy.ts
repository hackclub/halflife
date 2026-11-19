import { ShopDeliveryPreference, ShopOrderStatus } from "@/lib/enums"
import { grantCardPurpose } from "@/lib/grant-card-policy"

/**
 * The parts of shop card issuance that are pure.
 *
 * Kept out of `shop-grant-cards.ts` so the rules and the wording can be tested without a database or an HCB connection.
 */

/** What the buyer is told the card is for. Shop cards have no project, so the item and order number are the whole description. */
export const SHOP_GRANT_CARD_INVITE_MESSAGE = "Your Half Life shop grant is ready. Accept it to get your card."

export interface ShopGrantCardOrder {
	deliveryPreference: ShopDeliveryPreference | null
	grantCardCents: number | null
	status: ShopOrderStatus
}

/**
 * Why a card cannot be issued for this order, or null when it can.
 *
 * The order is the funding decision here, so an order that was rejected, cancelled or already fulfilled has nothing left to pay. The account checks are passed in rather than read here, because they come from different places and the caller already has them.
 */
export function shopGrantCardBlockReason(
	order: ShopGrantCardOrder,
	payoutBlock: string | null,
	verified: boolean,
): string | null {
	if (order.status !== ShopOrderStatus.PENDING && order.status !== ShopOrderStatus.ON_HOLD)
		return "Only a pending or held order can be paid by grant card"
	if (order.deliveryPreference !== ShopDeliveryPreference.GRANT_CARD) return "This order did not ask for a grant card"
	if (order.grantCardCents === null || order.grantCardCents <= 0) return "This order has no grant card amount"
	if (payoutBlock) return payoutBlock
	if (!verified) return "The buyer's identity is not verified"
	return null
}

/** What HCB shows on the grant: the order and the item, which is all a shop card has. */
export function shopGrantCardInstructions(orderNumber: number, itemName: string): string {
	return `Order #${orderNumber}: ${itemName}`
}

/** The purpose HCB stores. It has to identify the attempt for a reconcile, and HCB caps it, so the item name is cut to fit. */
export function shopGrantCardPurpose(itemName: string): string {
	return grantCardPurpose(itemName)
}
