import "server-only"
import { and, or } from "@prisma/orm-postgres/orm-client"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { displayName } from "@/lib/display-name"
import {
	type ShopDeliveryPreference,
	type ShopFulfillmentMethod,
	ShopFulfillmentStage,
	ShopOrderStatus,
} from "@/lib/enums"
import { encodeCursor, readCursor } from "@/lib/pagination"
import { safeDecrypt } from "@/lib/pii"
import db from "@/lib/prisma8"
import { formatDbTimestamp, parseDbTimestamp, parseNullableTimestamp } from "@/lib/time"

/**
 * What the fulfilment sheet lists. Rejected orders were refunded and never ship; cancelled ones stay, since one may already be on its way to HQ.
 */
export const FULFILLMENT_ORDER_STATUSES: ShopOrderStatus[] = [
	ShopOrderStatus.PENDING,
	ShopOrderStatus.ON_HOLD,
	ShopOrderStatus.FULFILLED,
	ShopOrderStatus.CANCELLED,
]

/** A participant's cancellation wins over whatever stage was marked before it. */
export const fulfillmentStageOf = (order: {
	status: ShopOrderStatus
	fulfillmentStage: ShopFulfillmentStage
}): ShopFulfillmentStage =>
	order.status === ShopOrderStatus.CANCELLED ? ShopFulfillmentStage.CANCELLED : order.fulfillmentStage

export interface FulfillmentFilters {
	/** `"NONE"` is an order whose buyer never chose between shipping and a card (placed before the question was asked). */
	delivery?: ShopDeliveryPreference | "NONE"
	/** `"NONE"` is an order nobody has chosen a method for yet. */
	method?: ShopFulfillmentMethod | "NONE"
	/** Exclusive. */
	placedBefore?: Date
	/** Inclusive, from the start of this instant. */
	placedFrom?: Date
	stage?: ShopFulfillmentStage
	/** The order's own status, so pending and fulfilled can be told apart within one stage. */
	status?: ShopOrderStatus
}

/** The latest card attempt on an order, if it has one. Older attempts are history; the sheet acts on the newest. */
export interface FulfillmentGrantCardRow {
	amountCents: number
	error: string | null
	grantCardMerchantIds: readonly string[]
	hcbCardGrantId: string | null
	id: string
	status: Models.public_HcbShopGrantCard["status"]
}

/** One row of the fulfilment sheet: the order with its resolved stage, dollar total and buyer. */
export interface FulfillmentOrderRow {
	cancellationReason: string | null
	cancelledAt: Date | null
	country: string | null
	deliveryPreference: ShopDeliveryPreference | null
	fulfilledAt: Date | null
	fulfillmentMethod: ShopFulfillmentMethod | null
	fulfillmentStage: ShopFulfillmentStage
	grantCard: FulfillmentGrantCardRow | null
	grantCardCents: Models.public_ShopOrder["grantCardCents"]
	grantCardMerchantIds: readonly string[]
	holdReason: string | null
	id: string
	itemNameSnapshot: string
	orderNumber: number
	placedAt: Date
	quantity: number
	rejectionReason: string | null
	/** The catalogue item this order is for, so the sheet can link back to it. */
	shopItemId: string
	status: ShopOrderStatus
	totalUsd: number | null
	trackingCarrier: string | null
	trackingNumber: string | null
	user: { id: string; name: string | null }
}

/** One row as it comes out of the database, before the sheet's own arithmetic. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns. */
export interface FulfillmentOrderModel {
	cancellationReason: string | null
	cancelledAt: string | null
	deliveryPreference: Models.public_ShopOrder["deliveryPreference"]
	fulfilledAt: string | null
	fulfillmentMethod: Models.public_ShopOrder["fulfillmentMethod"]
	fulfillmentStage: Models.public_ShopOrder["fulfillmentStage"]
	grantCardCents: Models.public_ShopOrder["grantCardCents"]
	grantCardMerchantIds: readonly string[]
	grantCards: {
		amountCents: number
		error: string | null
		grantCardMerchantIds: readonly string[]
		hcbCardGrantId: string | null
		id: string
		status: Models.public_HcbShopGrantCard["status"]
	}[]
	holdReason: string | null
	id: string
	itemNameSnapshot: string
	orderNumber: number
	placedAt: Date
	quantity: number
	rejectionReason: string | null
	shopItem: { costUsd: number | null; id: string }
	status: Models.public_ShopOrder["status"]
	trackingCarrier: string | null
	trackingNumber: string | null
	unitCostUsd: number | null
	user: { displayName: string | null; encryptedAddressCountry: string | null; id: string; name: string | null }
}

/**
 * Orders for the fulfilment sheet, with each buyer's country.
 *
 * The country is the one on their HCA profile now, not at order time: it is what the parcel will actually be addressed to. It is decrypted here and only the plain country leaves this function – never the ciphertext.
 */
export async function listFulfillmentOrders(
	filters: FulfillmentFilters,
	opts: { cursor?: string; limit: number },
): Promise<{ items: FulfillmentOrderRow[]; nextCursor: string | null }> {
	// Every filter ANDs, as the old AND array did: the cursor pages within the filtered list rather than cancelling a filter out.
	const { delivery, method, placedBefore, placedFrom, stage, status } = filters
	let filtered = db.orm.public.ShopOrder.where(order => order.status.in(FULFILLMENT_ORDER_STATUSES)).orderBy([
		order => order.placedAt.desc(),
		order => order.id.desc(),
	])
	if (placedFrom || placedBefore)
		filtered = filtered.where(order =>
			and(
				...(placedFrom ? [order.placedAt.gte(formatDbTimestamp(placedFrom))] : []),
				...(placedBefore ? [order.placedAt.lt(formatDbTimestamp(placedBefore))] : []),
			),
		)
	if (delivery === "NONE") filtered = filtered.where(order => order.deliveryPreference.isNull())
	else if (delivery) filtered = filtered.where({ deliveryPreference: delivery })
	if (method === "NONE") filtered = filtered.where(order => order.fulfillmentMethod.isNull())
	else if (method) filtered = filtered.where({ fulfillmentMethod: method })
	if (stage)
		filtered = filtered.where(order =>
			// A cancelled order shows as cancelled, so it matches no other stage.
			stage === ShopFulfillmentStage.CANCELLED
				? or(order.status.eq(ShopOrderStatus.CANCELLED), order.fulfillmentStage.eq(ShopFulfillmentStage.CANCELLED))
				: and(order.fulfillmentStage.eq(stage), order.status.neq(ShopOrderStatus.CANCELLED)),
		)
	if (status) filtered = filtered.where({ status })
	const position = readCursor(opts.cursor)
	// The sheet is a page rather than an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
	const paged =
		position?.at === undefined || position?.at === null
			? filtered
			: filtered.cursor({ id: position.id, placedAt: formatDbTimestamp(position.at) })
	const rows = await paged
		.limit(opts.limit + 1)
		.select(
			"cancellationReason",
			"cancelledAt",
			"deliveryPreference",
			"fulfilledAt",
			"fulfillmentMethod",
			"fulfillmentStage",
			"grantCardCents",
			"grantCardMerchantIds",
			"holdReason",
			"id",
			"itemNameSnapshot",
			"orderNumber",
			"placedAt",
			"quantity",
			"rejectionReason",
			"status",
			"trackingCarrier",
			"trackingNumber",
			"unitCostUsd",
		)
		.include("grantCards", cards =>
			cards
				.select("amountCents", "error", "grantCardMerchantIds", "hcbCardGrantId", "id", "status")
				// The sheet acts on the newest attempt; older failures and cancellations stay as its history.
				.orderBy([card => card.createdAt.desc(), card => card.id.desc()]),
		)
		.include("shopItem", item => item.select("costUsd", "id"))
		.include("user", user => user.select("displayName", "encryptedAddressCountry", "id", "name"))
		.all()
	const models = rows.slice(0, opts.limit).map(row => {
		if (!row.shopItem) throw new Error(`order ${row.id} has no item`)
		if (!row.user) throw new Error(`order ${row.id} has no buyer`)
		return {
			cancellationReason: row.cancellationReason,
			cancelledAt: row.cancelledAt,
			deliveryPreference: row.deliveryPreference,
			fulfilledAt: row.fulfilledAt,
			fulfillmentMethod: row.fulfillmentMethod,
			fulfillmentStage: row.fulfillmentStage,
			grantCardCents: row.grantCardCents,
			grantCardMerchantIds: row.grantCardMerchantIds,
			grantCards: row.grantCards,
			holdReason: row.holdReason,
			id: row.id,
			itemNameSnapshot: row.itemNameSnapshot,
			orderNumber: row.orderNumber,
			placedAt: parseDbTimestamp(row.placedAt),
			quantity: row.quantity,
			rejectionReason: row.rejectionReason,
			shopItem: row.shopItem,
			status: row.status,
			trackingCarrier: row.trackingCarrier,
			trackingNumber: row.trackingNumber,
			unitCostUsd: row.unitCostUsd,
			user: row.user,
		}
	})
	const last = models.at(-1)

	const items = models.map(({ grantCards, shopItem, user, unitCostUsd, ...order }) => {
		// Orders from before the item had a cost fall back to today's.
		const unit = unitCostUsd ?? shopItem.costUsd
		return Object.assign(order, {
			cancelledAt: parseNullableTimestamp(order.cancelledAt),
			country: safeDecrypt(user.encryptedAddressCountry),
			fulfilledAt: parseNullableTimestamp(order.fulfilledAt),
			fulfillmentStage: fulfillmentStageOf(order),
			grantCard: grantCards[0] ?? null,
			shopItemId: shopItem.id,
			totalUsd: unit === null ? null : unit * order.quantity,
			user: { id: user.id, name: displayName(user) },
		})
	})
	return {
		items,
		nextCursor: rows.length > opts.limit && last ? encodeCursor({ at: last.placedAt, id: last.id }) : null,
	}
}
