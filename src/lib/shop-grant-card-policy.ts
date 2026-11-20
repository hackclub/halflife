import { ShopDeliveryPreference, ShopOrderStatus } from "@/lib/enums"
import { grantCardPurpose, PRIZE_GRANT_CARD_PURPOSE } from "@/lib/grant-card-policy"

/**
 * The parts of shop card issuance that are pure.
 *
 * Kept out of `shop-grant-cards.ts` so the rules and the wording can be tested without a database or an HCB connection.
 */

/** What the buyer is told the card is for. Shop cards have no project, so the item and order number are the whole description. */
export function shopGrantCardInviteMessage(itemName: string): string {
	return `Your Half Life shop grant for "${itemName}" is ready. Accept it to get your card.`
}

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

/**
 * Why a bulk send leaves this order out, or null when it belongs in the batch.
 *
 * It is `shopGrantCardBlockReason` plus the one thing the single-order panel can see from the row and this cannot: whether a card already exists. The identity check is deliberately not made here – it reads HCA and belongs to the issue itself, which reports it per order – so the listing never hides an order it could have paid.
 */
export function shopGrantCardBatchBlockReason(
	order: ShopGrantCardOrder & { hasLiveCard: boolean; hasSettledCard: boolean },
	payoutBlock: string | null,
): string | null {
	if (order.hasLiveCard) return "A card for this order is already in progress or issued"
	if (order.hasSettledCard) return "An earlier card for this order was cancelled or returned"
	return shopGrantCardBlockReason(order, payoutBlock, true)
}

/** What HCB shows on the grant: the order and the item, which is all a shop card has. */
export function shopGrantCardInstructions(orderNumber: number, itemName: string): string {
	return `Order #${orderNumber}. Please use to purchase "${itemName}"`
}

/** The purpose HCB stores. It has to identify the attempt for a reconcile, and HCB caps it, so the item name is cut to fit. */
export function shopGrantCardPurpose(itemName: string): string {
	return grantCardPurpose(itemName, PRIZE_GRANT_CARD_PURPOSE)
}
