import "server-only"
import { AuditAction, logAudit } from "@/lib/audit"
import { ShopDeliveryPreference, ShopOrderStatus } from "@/lib/enums"
import db from "@/lib/prisma8"
import { grantCardCentsFor } from "@/lib/shop-order"

/**
 * Give orders that were placed without a grant card amount one, taken from their item's current cost.
 *
 * An order's amount is normally snapshotted when it is placed. Orders placed while their item had no cost were left with none, and nothing else can set it, so the batch send refuses them. This writes the amount that a fresh purchase would get today: the item's cost times the quantity. It only touches a pending or held card order that still has no amount, and each filled order is audited.
 */

interface Admin {
	email: string | null
	id: string
}

export interface AmountFillOutcome {
	amountCents: number | null
	error: string | null
	filled: boolean
	orderId: string
	orderNumber: number | null
}

export async function fillGrantCardAmounts(orderIds: readonly string[], admin: Admin): Promise<AmountFillOutcome[]> {
	const outcomes: AmountFillOutcome[] = []
	for (const orderId of orderIds) outcomes.push(await fillOne(orderId, admin))
	return outcomes
}

async function fillOne(orderId: string, admin: Admin): Promise<AmountFillOutcome> {
	const refused = (error: string, orderNumber: number | null = null): AmountFillOutcome => ({
		amountCents: null,
		error,
		filled: false,
		orderId,
		orderNumber,
	})

	const order = await db.orm.public.ShopOrder.whereUnique({ id: orderId })
		.select("deliveryPreference", "grantCardCents", "id", "orderNumber", "quantity", "status")
		.include("shopItem", item => item.select("costUsd"))
		.first()
	if (!order?.shopItem) return refused("Order not found")
	if (order.status !== ShopOrderStatus.PENDING && order.status !== ShopOrderStatus.ON_HOLD)
		return refused("Only a pending or held order can be paid by grant card", order.orderNumber)
	if (order.deliveryPreference !== ShopDeliveryPreference.GRANT_CARD)
		return refused("This order did not ask for a grant card", order.orderNumber)
	if (order.grantCardCents !== null && order.grantCardCents > 0)
		return refused("This order already has an amount", order.orderNumber)

	const amountCents = grantCardCentsFor(order.shopItem.costUsd, order.quantity)
	if (amountCents === null) return refused("Its item has no cost to take an amount from", order.orderNumber)

	// Conditional on the status that was just read, so an order decided in between is left alone.
	const updated = await db.orm.public.ShopOrder.where({ id: orderId, status: order.status }).updateAndCount({
		grantCardCents: amountCents,
		lastActorId: admin.id,
	})
	if (updated !== 1) return refused("This order was decided by someone else", order.orderNumber)

	await logAudit({
		action: AuditAction.ADMIN_UPDATE_ORDER_FULFILLMENT,
		actorEmail: admin.email,
		actorId: admin.id,
		metadata: {
			after: { grantCardCents: amountCents },
			before: { grantCardCents: null },
			change: "Filled the grant card amount from the item's current cost",
		},
		targetId: orderId,
		targetType: "ShopOrder",
	})

	return { amountCents, error: null, filled: true, orderId, orderNumber: order.orderNumber }
}
