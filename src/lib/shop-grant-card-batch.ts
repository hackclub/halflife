import "server-only"
import { displayName } from "@/lib/display-name"
import { HcbGrantCardStatus, ShopDeliveryPreference, ShopOrderStatus } from "@/lib/enums"
import { HttpError, messageOf } from "@/lib/errors"
import { normalizeMerchantIds } from "@/lib/grant-card-policy"
import { payoutBlockReason } from "@/lib/moderation"
import db from "@/lib/prisma8"
import { SHOP_GRANT_CARD_BATCH_MAX } from "@/lib/schemas/admin"
import { NO_AMOUNT_REASON, shopGrantCardBatchBlockReason } from "@/lib/shop-grant-card-policy"
import { issueShopGrantCard } from "@/lib/shop-grant-cards"
import { grantCardCentsFor, isLiveShopCard, isSettledShopCard } from "@/lib/shop-order"
import { parseDbTimestamp } from "@/lib/time"

/**
 * The bulk card send: every pending or held order that asked for a grant card, grouped by the item it bought.
 *
 * The order is still the funding decision, so this adds nothing to what a card pays. It only runs the single-order issue over a whole item at once, with one merchant allowlist filled in for the group – the part that was too slow to type per order and too easy to leave empty.
 */

export interface BatchOrder {
	amountCents: number
	id: string
	orderNumber: number
	/** ISO, because this crosses to the browser as JSON. */
	placedAt: string
	user: { id: string; name: string }
}

/** One item's ready orders, with the allowlist its cards will carry. */
export interface BatchGroup {
	/** What the catalogue item holds now, so the field opens filled in when somebody has set it before. */
	configuredMerchantIds: string[]
	itemName: string
	/** The merchants the item links to, by name, so the page can say where its cards may be spent. */
	merchantNames: string[]
	orders: BatchOrder[]
	shopItemId: string
	totalCents: number
}

/** An order that asked for a card but cannot be sent, and why. It stays on the page rather than disappearing from the sheet. */
export interface BatchBlockedOrder {
	/** Whether the fill action can give this order an amount: it has none, and its item has a cost to take one from. */
	fillable: boolean
	itemName: string
	orderId: string
	orderNumber: number
	reason: string
	shopItemId: string
	user: { id: string; name: string }
}

export interface ShopGrantCardBatch {
	blocked: BatchBlockedOrder[]
	groups: BatchGroup[]
}

export interface BatchSendOutcome {
	/** The attempt's own reason when HCB did not confirm, or the refusal the issue raised. */
	error: string | null
	orderId: string
	orderNumber: number
	sent: boolean
}

interface Admin {
	email: string | null
	id: string
}

const CANDIDATE_STATUSES: ShopOrderStatus[] = [ShopOrderStatus.PENDING, ShopOrderStatus.ON_HOLD]

/**
 * Every order the batch could pay, split into item groups and the ones it cannot.
 *
 * Only orders whose buyer chose a card are read at all, so shipping orders cannot be swept in by a wide filter later. A card that is live or settled blocks its order here; a failed or skipped attempt does not, because that is exactly what a retry is for.
 */
export async function listShopGrantCardBatch(): Promise<ShopGrantCardBatch> {
	const rows = await db.orm.public.ShopOrder.where({ deliveryPreference: ShopDeliveryPreference.GRANT_CARD })
		.where(order => order.status.in(CANDIDATE_STATUSES))
		.orderBy([order => order.placedAt.asc(), order => order.id.asc()])
		.select(
			"deliveryPreference",
			"grantCardCents",
			"id",
			"itemNameSnapshot",
			"orderNumber",
			"placedAt",
			"quantity",
			"status",
		)
		.include("grantCards", cards => cards.select("status"))
		.include("shopItem", item => item.select("costUsd", "grantCardMerchantIds", "id", "name"))
		.include("user", user => user.select("bannedAt", "displayName", "fraudFlagged", "id", "name", "suspendedUntil"))
		.all()

	const groups = new Map<string, BatchGroup>()
	const blocked: BatchBlockedOrder[] = []
	const merchantNames = new Map<string, string[]>()
	const links = await db.orm.public.ShopItemGrantCardMerchant.select("merchantId", "shopItemId")
		.include("merchant", merchant => merchant.select("name"))
		.all()
	for (const link of links) {
		if (!link.merchant) continue
		merchantNames.set(link.shopItemId, [...(merchantNames.get(link.shopItemId) ?? []), link.merchant.name])
	}

	for (const row of rows) {
		if (!row.shopItem) throw new Error(`order ${row.id} has no item`)
		if (!row.user) throw new Error(`order ${row.id} has no buyer`)

		const hasLiveCard = row.grantCards.some(card => isLiveShopCard(card.status))
		const hasSettledCard = row.grantCards.some(card => isSettledShopCard(card.status))
		const reason = shopGrantCardBatchBlockReason({ ...row, hasLiveCard, hasSettledCard }, payoutBlockReason(row.user))
		if (reason) {
			blocked.push({
				fillable: reason === NO_AMOUNT_REASON && grantCardCentsFor(row.shopItem.costUsd, row.quantity) !== null,
				itemName: row.shopItem.name,
				orderId: row.id,
				orderNumber: row.orderNumber,
				reason,
				shopItemId: row.shopItem.id,
				user: { id: row.user.id, name: displayName(row.user, "Unknown") },
			})
			continue
		}

		const group = groups.get(row.shopItem.id) ?? {
			configuredMerchantIds: [...row.shopItem.grantCardMerchantIds],
			itemName: row.shopItem.name,
			merchantNames: merchantNames.get(row.shopItem.id) ?? [],
			orders: [],
			shopItemId: row.shopItem.id,
			totalCents: 0,
		}
		const amountCents = row.grantCardCents ?? 0
		group.orders.push({
			amountCents,
			id: row.id,
			orderNumber: row.orderNumber,
			placedAt: parseDbTimestamp(row.placedAt).toISOString(),
			user: { id: row.user.id, name: displayName(row.user, "Unknown") },
		})
		group.totalCents += amountCents
		groups.set(row.shopItem.id, group)
	}

	return {
		blocked,
		groups: [...groups.values()].toSorted((a, b) => a.itemName.localeCompare(b.itemName)),
	}
}

/**
 * Send one item's cards, and keep the allowlist if asked.
 *
 * Every order is issued in turn through the single-order path, so each keeps its own claim, audit row and fulfilment in one transaction. One order failing does not stop the rest: the caller gets an outcome per order and the page shows the ones that remain. Two guards are per group, because the caller chose the group: every order must belong to the item, and the allowlist must name at least one merchant.
 */
export async function sendShopGrantCardBatch(
	input: {
		grantCardMerchantIds: readonly string[]
		orderIds: readonly string[]
		shopItemId: string
	},
	admin: Admin,
): Promise<BatchSendOutcome[]> {
	const merchantIds = normalizeMerchantIds(input.grantCardMerchantIds)
	if (merchantIds.length === 0) throw new HttpError("VALIDATION_FAILED", "Enter at least one merchant ID")
	const orderIds = [...new Set(input.orderIds)]
	if (orderIds.length === 0) throw new HttpError("VALIDATION_FAILED", "Select at least one order")
	if (orderIds.length > SHOP_GRANT_CARD_BATCH_MAX)
		throw new HttpError("VALIDATION_FAILED", `Send at most ${SHOP_GRANT_CARD_BATCH_MAX} cards at a time`)

	const item = await db.orm.public.ShopItem.whereUnique({ id: input.shopItemId })
		.select("grantCardMerchantIds", "id", "name")
		.first()
	if (!item) throw new HttpError("NOT_FOUND", "Item not found")

	const orders = await db.orm.public.ShopOrder.where(order => order.id.in(orderIds))
		.select("id", "orderNumber", "shopItemId", "status")
		.all()
	if (orders.length !== orderIds.length)
		throw new HttpError("VALIDATION_FAILED", "One of these orders no longer exists. Reload and try again")
	for (const order of orders) {
		if (order.shopItemId !== item.id)
			throw new HttpError("VALIDATION_FAILED", "Every order in a send must be for the same item")
		if (!CANDIDATE_STATUSES.includes(order.status))
			throw new HttpError(
				"CONFLICT",
				`Order #${order.orderNumber} is no longer waiting for a card. Reload and try again`,
			)
	}

	const outcomes: BatchSendOutcome[] = []
	// In turn rather than together: HCB is per-grant and the balance check each issue makes should see the cards before it, not race them.
	for (const orderId of orderIds) {
		const order = orders.find(candidate => candidate.id === orderId)
		if (!order) continue
		try {
			const outcome = await issueShopGrantCard(orderId, admin, { merchantIds })
			const sent = outcome.status === HcbGrantCardStatus.ISSUED
			outcomes.push({
				error: sent ? null : (outcome.error ?? "HCB did not confirm the card. Check it on HCB before retrying"),
				orderId,
				orderNumber: order.orderNumber,
				sent,
			})
		} catch (err) {
			outcomes.push({
				error: messageOf(err),
				orderId,
				orderNumber: order.orderNumber,
				sent: false,
			})
		}
	}
	return outcomes
}
