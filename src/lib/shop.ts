import "server-only"
import type { Prisma, ShopItem, ShopOrder } from "@/app/generated/prisma/client"
import { CoinBucket, LedgerKind, PhaseStatus, ShopItemCategory, ShopOrderStatus } from "@/app/generated/prisma/enums"
import { THEMES_REQUIRED_FOR_PRINTER } from "@/lib/config/program"
import { appendLedgerEntry, type Balances, getBalances, lockUserCredit, spendableFor } from "@/lib/currency"
import { HttpError } from "@/lib/errors"
import { getPrinterQualification } from "@/lib/printer"
import prisma from "@/lib/prisma"
import { getShopAccess, SHOP_CLOSED_MESSAGE } from "@/lib/program"
import { countryOfTimezone } from "@/lib/regions"

/**
 * The catalogue row as a participant sees it.
 *
 * `costUsd` is deliberately absent: it is what Hack Club pays for the item, not what it costs the buyer. The old `...item` spread shipped it to the browser in the RSC payload even though nothing rendered it.
 */
export type ShopItemPublic = Omit<ShopItem, "costUsd">

/**
 * The buyer's own view of an order, shared by the purchase response and the order list so the two cannot drift. `unitCostUsd` (what Hack Club pays), the encrypted address/phone and `lastActorId` are staff-side and never selected.
 */
export const shopOrderPublicSelect = {
	id: true,
	orderNumber: true,
	shopItemId: true,
	quantity: true,
	unitCredits: true,
	totalCredits: true,
	itemNameSnapshot: true,
	status: true,
	holdReason: true,
	rejectionReason: true,
	trackingNumber: true,
	trackingCarrier: true,
	fulfillmentMethod: true,
	fulfillmentStage: true,
	fulfillmentUpdatedAt: true,
	placedAt: true,
	heldAt: true,
	rejectedAt: true,
	fulfilledAt: true,
} satisfies Prisma.ShopOrderSelect

export type ShopOrderPublic = Prisma.ShopOrderGetPayload<{ select: typeof shopOrderPublicSelect }>

/**
 * What a FULFILL_ORDERS surface may see. `unitCostUsd` (what Hack Club pays) is needed to price a shipment, but the encrypted address/phone and `lastActorId` are not, and a route that returns a whole row ships them by accident.
 */
export const shopOrderStaffSelect = {
	id: true,
	orderNumber: true,
	userId: true,
	shopItemId: true,
	quantity: true,
	unitCredits: true,
	totalCredits: true,
	itemNameSnapshot: true,
	unitCostUsd: true,
	status: true,
	holdReason: true,
	rejectionReason: true,
	trackingNumber: true,
	trackingCarrier: true,
	fulfillmentMethod: true,
	fulfillmentStage: true,
	fulfillmentUpdatedAt: true,
	placedAt: true,
	heldAt: true,
	rejectedAt: true,
	fulfilledAt: true,
} satisfies Prisma.ShopOrderSelect

export type ShopOrderStaff = Prisma.ShopOrderGetPayload<{ select: typeof shopOrderStaffSelect }>

export interface ShopItemView extends ShopItemPublic {
	/** Against the pot this item may be paid from, not against the total. */
	affordable: boolean
	locked: boolean
	lockReason: string | null
	ownedCount: number
}

/** Regions staff sell to, for the shop's price picker. Active only. */
export interface ShopRegionOption {
	id: string
	name: string
}

export async function listActiveShopRegions(): Promise<ShopRegionOption[]> {
	return prisma.shopRegion.findMany({
		where: { active: true },
		orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
		select: { id: true, name: true },
	})
}

/**
 * The region whose prices a participant sees and pays, and the country their timezone places them in.
 *
 * One read of the user row for both: the shop needs the region for pricing and the country for the printer notice,
 * and asking twice for the same row is a query the page does not need to spend. A region deactivated after being
 * picked reads as base, so flipping one off never strands anyone on prices that no longer exist.
 */
async function shopContextFor(userId: string): Promise<{ regionId: string | null; country: string }> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { timezone: true, shopRegion: { select: { id: true, active: true } } },
	})
	return {
		regionId: user?.shopRegion?.active ? user.shopRegion.id : null,
		country: countryOfTimezone(user?.timezone),
	}
}

export async function getShopItemsFor(userId: string): Promise<{
	items: ShopItemView[]
	balances: Balances
	regions: ShopRegionOption[]
	regionId: string | null
	/** The country the account's timezone places it in, for the printer notice. */
	country: string
}> {
	const [items, balances, qualification, orders, regions, context] = await Promise.all([
		// Explicit `select`, never the whole row: a new internal column added to ShopItem must not silently start reaching participants. Printers are not sold in the shop. They stay in the catalogue – the goal tracker and printer awards read them – but never reach this list.
		prisma.shopItem.findMany({
			where: { active: true, category: { not: ShopItemCategory.PRINTER } },
			orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
			select: {
				id: true,
				name: true,
				description: true,
				imageUrl: true,
				category: true,
				priceCredits: true,
				maxPerUser: true,
				stock: true,
				requiresPrinterQualified: true,
				active: true,
				sortOrder: true,
				createdAt: true,
				updatedAt: true,
				regionPrices: { select: { regionId: true, priceCredits: true } },
			},
		}),
		prisma.$transaction((tx) => getBalances(tx, userId)),
		getPrinterQualification(userId),
		prisma.shopOrder.groupBy({
			by: ["shopItemId"],
			where: { userId, status: { notIn: [ShopOrderStatus.REJECTED, ShopOrderStatus.CANCELLED] } },
			_sum: { quantity: true },
		}),
		listActiveShopRegions(),
		shopContextFor(userId),
	])

	const owned = new Map(orders.map((o) => [o.shopItemId, o._sum.quantity ?? 0]))

	return {
		balances,
		regions,
		regionId: context.regionId,
		country: context.country,
		items: items.map((item) => {
			const ownedCount = owned.get(item.id) ?? 0
			let locked = false
			let lockReason: string | null = null

			if (item.requiresPrinterQualified && !qualification.qualified) {
				locked = true
				lockReason = `Ship all ${qualification.required} themes to unlock (${qualification.shippedCount} so far)`
			} else if (item.maxPerUser > 0 && ownedCount >= item.maxPerUser) {
				locked = true
				lockReason = "You already have this"
			} else if (item.stock !== null && item.stock <= 0) {
				locked = true
				lockReason = "Out of stock"
			}

			// A regional override replaces the base price wherever this participant is concerned – display and purchase read the same number, so the shelf can never advertise a price the till refuses.
			const { regionPrices, ...base } = item
			const priceCredits =
				context.regionId !== null
					? (regionPrices.find((r) => r.regionId === context.regionId)?.priceCredits ?? item.priceCredits)
					: item.priceCredits

			// Every coin is spendable on anything, so affordability compares the whole balance against the price – display and purchase read the same number, so the shelf can never advertise a price the till refuses.
			const payableFrom = spendableFor(balances, item.category)
			return {
				...base,
				priceCredits,
				ownedCount,
				affordable: payableFrom >= priceCredits,
				locked,
				lockReason,
			}
		}),
	}
}

/**
 * Buy something.
 *
 * The whole thing runs under a per-user advisory lock. The ledger's `@@unique([shopOrderId, kind, bucket])` only stops one order being charged twice – two concurrent purchases mint two different order ids and collide with nothing, so without the lock ten parallel requests all read the same balance and all succeed.
 */
export async function purchase(
	userId: string,
	shopItemId: string,
	quantity: number,
	idempotencyKey?: string,
): Promise<ShopOrderPublic> {
	const access = await getShopAccess(userId)
	if (!access.open) throw new HttpError("SHOP_CLOSED", SHOP_CLOSED_MESSAGE)

	const item = await prisma.shopItem.findUnique({ where: { id: shopItemId } })
	if (!item?.active) throw new HttpError("NOT_FOUND", "Item not found")

	if (item.requiresPrinterQualified) {
		const qualification = await getPrinterQualification(userId)
		if (!qualification.qualified) {
			throw new HttpError("ITEM_LOCKED", `Ship all ${qualification.required} themes to unlock this`)
		}
	}

	return prisma.$transaction(async (tx) => {
		await lockUserCredit(tx, userId)

		// Re-checked inside the transaction: the pre-check above ran against reads taken before the lock, so a shop-close or a qualification-revoke in between must not still complete. Read off the transaction so this sees a consistent snapshot.
		const settings = await tx.programSettings.findUnique({ where: { id: "singleton" } })
		if (!settings?.shopOpen) throw new HttpError("SHOP_CLOSED", SHOP_CLOSED_MESSAGE)
		if (settings.shopClosesAt && settings.shopClosesAt <= new Date()) {
			const [awaitingReview, lastReview] = await Promise.all([
				tx.themeProject.count({
					where: { userId, deletedAt: null, OR: [{ designStatus: "in_review" }, { buildStatus: "in_review" }] },
				}),
				tx.themeProject.aggregate({
					where: { userId, deletedAt: null },
					_max: { designReviewedAt: true, buildReviewedAt: true },
				}),
			])
			let inGrace = awaitingReview > 0
			if (!inGrace) {
				const reviewedAt = [lastReview._max.designReviewedAt, lastReview._max.buildReviewedAt]
					.filter((d): d is Date => !!d)
					.sort((a, b) => b.getTime() - a.getTime())[0]
				inGrace = !!reviewedAt && reviewedAt.getTime() + settings.shopGraceDays * 86_400_000 > Date.now()
			}
			if (!inGrace) throw new HttpError("SHOP_CLOSED", SHOP_CLOSED_MESSAGE)
		}
		if (item.requiresPrinterQualified) {
			const shipped = await tx.themeProject.count({
				where: {
					userId,
					deletedAt: null,
					designStatus: PhaseStatus.approved,
					buildStatus: PhaseStatus.approved,
				},
			})
			if (shipped < THEMES_REQUIRED_FOR_PRINTER)
				throw new HttpError("ITEM_LOCKED", "This item is locked for your account")
		}

		// The buyer's region, re-read here rather than trusted from the shelf: the price on the order is whatever this resolves to, so display and charge cannot drift apart.
		const buyer = await tx.user.findUnique({
			where: { id: userId },
			select: { shopRegion: { select: { id: true, active: true } } },
		})
		const buyerRegionId = buyer?.shopRegion?.active ? buyer.shopRegion.id : null
		const regional =
			buyerRegionId !== null
				? await tx.shopItemRegionPrice.findUnique({
						where: { shopItemId_regionId: { shopItemId, regionId: buyerRegionId } },
						select: { priceCredits: true },
					})
				: null
		// A retried request – double-tap, proxy retry, two tabs sharing one key – resolves to the order it already made rather than charging again. The same per-user lock serializes the two, so the loser always sees the winner's row.
		if (idempotencyKey) {
			const existing = await tx.shopOrder.findFirst({
				where: { userId, idempotencyKey },
				select: shopOrderPublicSelect,
			})
			if (existing) return existing
		}

		// Re-read stock inside the transaction; the catalogue page may be stale.
		const fresh = await tx.shopItem.findUnique({ where: { id: shopItemId } })
		// A printer is hidden from the shop, so it is as good as not there: a request for one by id is refused the same way a retired item is.
		if (!fresh?.active || fresh.category === ShopItemCategory.PRINTER)
			throw new HttpError("NOT_FOUND", "Item not found")
		if (fresh.stock !== null && fresh.stock < quantity) throw new HttpError("OUT_OF_STOCK", "Not enough stock left")

		if (fresh.maxPerUser > 0) {
			const owned = await tx.shopOrder.aggregate({
				where: {
					userId,
					shopItemId,
					status: { notIn: [ShopOrderStatus.REJECTED, ShopOrderStatus.CANCELLED] },
				},
				_sum: { quantity: true },
			})
			if ((owned._sum.quantity ?? 0) + quantity > fresh.maxPerUser) {
				throw new HttpError("PURCHASE_LIMIT", `Limit ${fresh.maxPerUser} per person`)
			}
		}

		const unitPrice = regional?.priceCredits ?? fresh.priceCredits
		const totalCredits = unitPrice * quantity
		const balances = await getBalances(tx, userId)
		const payableFrom = spendableFor(balances, fresh.category)
		if (payableFrom < totalCredits) {
			throw new HttpError("INSUFFICIENT_CREDIT", `You need ${totalCredits - payableFrom} more to buy this`)
		}

		const order = await tx.shopOrder.create({
			data: {
				userId,
				shopItemId,
				quantity,
				unitCredits: unitPrice,
				totalCredits,
				itemNameSnapshot: fresh.name,
				unitCostUsd: fresh.costUsd,
				idempotencyKey: idempotencyKey ?? null,
			},
			// Only the buyer's fields come back; `unitCostUsd` is stored for fulfillment but must not leave the server.
			select: shopOrderPublicSelect,
		})

		// Every coin is spendable on anything, so a purchase is paid out of the whole balance.
		if (totalCredits > 0) {
			await appendLedgerEntry(tx, {
				userId,
				kind: LedgerKind.SHOP_PURCHASE,
				bucket: CoinBucket.SPENDABLE,
				amount: -totalCredits,
				note: `${quantity}× ${fresh.name}`,
				shopOrderId: order.id,
				createdById: userId,
			})
		}

		if (fresh.stock !== null) {
			// Conditional, so stock cannot go negative even if two people buy the last unit at once – the loser's update matches nothing and rolls back.
			const claimed = await tx.shopItem.updateMany({
				where: { id: shopItemId, stock: { gte: quantity } },
				data: { stock: { decrement: quantity } },
			})
			if (claimed.count !== 1) throw new HttpError("OUT_OF_STOCK", "Not enough stock left")
		}

		return order
	})
}

/**
 * Reject an order and refund it.
 *
 * The refund is a new positive row, never an edit to the original debit: the ledger is append-only, and the history of a rejected order is part of the record.
 */
export async function rejectOrder(orderId: string, adminId: string, reason: string): Promise<ShopOrder> {
	const target = await prisma.shopOrder.findUnique({
		where: { id: orderId },
		select: { userId: true },
	})
	if (!target) throw new HttpError("NOT_FOUND", "Order not found")

	return prisma.$transaction(async (tx) => {
		await lockUserCredit(tx, target.userId)

		const order = await tx.shopOrder.findUnique({ where: { id: orderId } })
		if (!order) throw new HttpError("NOT_FOUND", "Order not found")
		if (order.status !== ShopOrderStatus.PENDING && order.status !== ShopOrderStatus.ON_HOLD)
			throw new HttpError("CONFLICT", "This order has already been decided")

		// Refund each pot exactly what it paid, by reading back the purchase rows rather than assuming. Refunding the whole total as spendable would turn a rejected printer order into a laundering step: coins that could only ever have bought a printer would come back as coins that can buy anything.
		const paid = await tx.ledgerEntry.groupBy({
			by: ["bucket"],
			where: { shopOrderId: order.id, kind: LedgerKind.SHOP_PURCHASE },
			_sum: { amount: true },
		})

		for (const row of paid) {
			// Purchases are negative; the refund is its mirror.
			const amount = -(row._sum.amount ?? 0)
			if (amount <= 0) continue
			await appendLedgerEntry(tx, {
				userId: order.userId,
				kind: LedgerKind.SHOP_REFUND,
				bucket: row.bucket,
				amount,
				note: `Refund for order #${order.orderNumber}: ${reason}`,
				shopOrderId: order.id,
				createdById: adminId,
			})
		}

		if (order.shopItemId) {
			await tx.shopItem.updateMany({
				where: { id: order.shopItemId, stock: { not: null } },
				data: { stock: { increment: order.quantity } },
			})
		}

		return tx.shopOrder.update({
			where: { id: orderId },
			data: {
				status: ShopOrderStatus.REJECTED,
				rejectionReason: reason,
				rejectedAt: new Date(),
				lastActorId: adminId,
			},
		})
	})
}

/**
 * Mark an order shipped.
 *
 * Serialized against `rejectOrder` on the same per-user credit lock, because a fulfill only reads the order and `rejectOrder` only mutates credit: without a shared lock the two interleave, the refund lands and the goods still ship. The conditional `updateMany` is the second guard, for a decision that landed between the lock being taken and the write.
 */
export async function fulfillOrder(
	orderId: string,
	adminId: string,
	tracking: { number?: string | null; carrier?: string | null },
): Promise<ShopOrder> {
	const target = await prisma.shopOrder.findUnique({
		where: { id: orderId },
		select: { userId: true },
	})
	if (!target) throw new HttpError("NOT_FOUND", "Order not found")

	return prisma.$transaction(async (tx) => {
		await lockUserCredit(tx, target.userId)

		const order = await tx.shopOrder.findUnique({ where: { id: orderId } })
		if (!order) throw new HttpError("NOT_FOUND", "Order not found")
		if (order.status === ShopOrderStatus.FULFILLED) throw new HttpError("CONFLICT", "This order is already fulfilled")
		if (order.status === ShopOrderStatus.REJECTED) throw new HttpError("CONFLICT", "This order was rejected")
		if (order.status === ShopOrderStatus.CANCELLED) throw new HttpError("CONFLICT", "This order was cancelled")

		const claimed = await tx.shopOrder.updateMany({
			where: { id: orderId, status: order.status },
			data: {
				status: ShopOrderStatus.FULFILLED,
				fulfilledAt: new Date(),
				trackingNumber: tracking.number ?? null,
				trackingCarrier: tracking.carrier ?? null,
				lastActorId: adminId,
			},
		})
		if (claimed.count !== 1) throw new HttpError("CONFLICT", "This order was decided by someone else")

		return tx.shopOrder.findUniqueOrThrow({ where: { id: orderId } })
	})
}
