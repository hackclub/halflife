import "server-only"
import { or } from "@prisma/orm-postgres/orm-client"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { THEMES_REQUIRED_FOR_PRINTER } from "@/lib/config/program"
import { appendLedgerEntry, type Balances, getBalances, lockUserCredit, spendableFor } from "@/lib/currency"
import { CoinBucket, LedgerKind, PhaseStatus, ShopItemCategory, ShopOrderStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { isIdentityVerified } from "@/lib/hca-profile"
import { getPrinterQualification } from "@/lib/printer"
import db from "@/lib/prisma8"
import { getShopAccess, SHOP_CLOSED_MESSAGE, shopGraceAccess } from "@/lib/program"
import { countryOfTimezone } from "@/lib/regions"
import { sanitize } from "@/lib/sanitize"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

/**
 * The catalogue row as a participant sees it.
 *
 * `costUsd` is deliberately absent: it is what Hack Club pays for the item, not what it costs the buyer. The old `...item` spread shipped it to the browser in the RSC payload even though nothing rendered it.
 */
export type ShopItemPublic = Omit<Models.public_ShopItem, "costUsd" | "orders" | "regionPrices">

/**
 * The buyer's own view of an order, shared by the purchase response and the order list so the two cannot drift. `unitCostUsd` (what Hack Club pays), the encrypted address/phone and `lastActorId` are staff-side and never selected. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns.
 */
export interface ShopOrderPublic {
	fulfilledAt: Date | null
	fulfillmentMethod: Models.public_ShopOrder["fulfillmentMethod"]
	fulfillmentStage: Models.public_ShopOrder["fulfillmentStage"]
	fulfillmentUpdatedAt: Date | null
	heldAt: Date | null
	holdReason: string | null
	id: string
	itemNameSnapshot: string
	orderNumber: number
	placedAt: Date
	quantity: number
	rejectedAt: Date | null
	rejectionReason: string | null
	shopItemId: string
	status: Models.public_ShopOrder["status"]
	totalCredits: number
	trackingCarrier: string | null
	trackingNumber: string | null
	unitCredits: number
}

/** The fields of the buyer's view, for selects. */
export const shopOrderPublicFields = [
	"fulfilledAt",
	"fulfillmentMethod",
	"fulfillmentStage",
	"fulfillmentUpdatedAt",
	"heldAt",
	"holdReason",
	"id",
	"itemNameSnapshot",
	"orderNumber",
	"placedAt",
	"quantity",
	"rejectedAt",
	"rejectionReason",
	"shopItemId",
	"status",
	"totalCredits",
	"trackingCarrier",
	"trackingNumber",
	"unitCredits",
] as const

/**
 * What a FULFILL_ORDERS surface may see. `unitCostUsd` (what Hack Club pays) is needed to price a shipment, but the encrypted address/phone and `lastActorId` are not, and a route that returns a whole row ships them by accident.
 *
 * What the buyer wrote about the order. Staff are the ones who fulfil it, so it is theirs to read; the buyer's own view above leaves it out, because it is a note to staff rather than part of the order's state.
 */
export const shopOrderStaffFields = [
	"fulfilledAt",
	"fulfillmentMethod",
	"fulfillmentStage",
	"fulfillmentUpdatedAt",
	"heldAt",
	"holdReason",
	"id",
	"itemNameSnapshot",
	"orderNumber",
	"placedAt",
	"quantity",
	"rejectedAt",
	"rejectionReason",
	"shopItemId",
	"status",
	"totalCredits",
	"trackingCarrier",
	"trackingNumber",
	"unitCostUsd",
	"unitCredits",
	"userId",
] as const

/** One staff-view row as Prisma 8 reads it: timestamps stay text until each reader parses them. */
export type ShopOrderStaffRow = Pick<
	Models.public_ShopOrder,
	| "fulfilledAt"
	| "fulfillmentMethod"
	| "fulfillmentStage"
	| "fulfillmentUpdatedAt"
	| "heldAt"
	| "holdReason"
	| "id"
	| "itemNameSnapshot"
	| "orderNumber"
	| "placedAt"
	| "quantity"
	| "rejectedAt"
	| "rejectionReason"
	| "shopItemId"
	| "status"
	| "totalCredits"
	| "trackingCarrier"
	| "trackingNumber"
	| "unitCostUsd"
	| "unitCredits"
	| "userId"
> & { notes: { authorId: string; body: string; createdAt: string }[] }

export interface ShopOrderStaffView
	extends Omit<
		ShopOrderStaffRow,
		"fulfilledAt" | "fulfillmentUpdatedAt" | "heldAt" | "placedAt" | "rejectedAt" | "notes"
	> {
	fulfilledAt: Date | null
	fulfillmentUpdatedAt: Date | null
	heldAt: Date | null
	notes: { authorId: string; body: string; createdAt: Date }[]
	placedAt: Date
	rejectedAt: Date | null
}

export function toShopOrderStaffView(row: ShopOrderStaffRow): ShopOrderStaffView {
	const parse = (value: string | null): Date | null => (value === null ? null : parseDbTimestamp(value))
	return {
		...row,
		fulfilledAt: parse(row.fulfilledAt),
		fulfillmentUpdatedAt: parse(row.fulfillmentUpdatedAt),
		heldAt: parse(row.heldAt),
		notes: row.notes.map(note => ({ ...note, createdAt: parseDbTimestamp(note.createdAt) })),
		placedAt: parseDbTimestamp(row.placedAt),
		rejectedAt: parse(row.rejectedAt),
	}
}

/** One staff-view row, for the fulfilment console and the decision response. */
export async function getStaffOrder(id: string): Promise<ShopOrderStaffView | null> {
	const row = await db.orm.public.ShopOrder.whereUnique({ id })
		.select(...shopOrderStaffFields)
		.include("notes", notes => notes.select("authorId", "body", "createdAt").orderBy(note => note.createdAt.asc()))
		.first()
	return row ? toShopOrderStaffView(row) : null
}

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
	const rows = await db.orm.public.ShopRegion.where({ active: true })
		.orderBy([region => region.sortOrder.asc(), region => region.name.asc()])
		.select("id", "name")
		.all()
	return rows
}

/**
 * The region whose prices a participant sees and pays, and the country their timezone places them in.
 *
 * One read of the user row for both: the shop needs the region for pricing and the country for the printer notice,
 * and asking twice for the same row is a query the page does not need to spend. A region deactivated after being
 * picked reads as base, so flipping one off never strands anyone on prices that no longer exist.
 */
async function shopContextFor(userId: string): Promise<{ regionId: string | null; country: string }> {
	const user = await db.orm.public.User.whereUnique({ id: userId })
		.select("timezone")
		.include("shopRegion", region => region.select("active", "id"))
		.first()
	return {
		country: countryOfTimezone(user?.timezone),
		regionId: user?.shopRegion?.active ? user.shopRegion.id : null,
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
		db.orm.public.ShopItem.where({ active: true })
			.where(item => item.category.neq(ShopItemCategory.PRINTER))
			.orderBy([item => item.sortOrder.asc(), item => item.name.asc()])
			.select(
				"active",
				"category",
				"createdAt",
				"description",
				"id",
				"imageUrl",
				"maxPerUser",
				"name",
				"priceCredits",
				"requiresPrinterQualified",
				"sortOrder",
				"stock",
				"updatedAt",
			)
			.include("regionPrices", prices => prices.select("priceCredits", "regionId"))
			.all(),
		db.transaction(tx => getBalances(tx, userId)),
		getPrinterQualification(userId),
		db.orm.public.ShopOrder.where({ userId })
			.where(order => order.status.notIn([ShopOrderStatus.REJECTED, ShopOrderStatus.CANCELLED]))
			.groupBy("shopItemId")
			.aggregate(group => ({ quantity: group.sum("quantity") })),
		listActiveShopRegions(),
		shopContextFor(userId),
	])

	const owned = new Map(orders.map(o => [o.shopItemId, o.quantity ?? 0]))

	const view = items.map(item => {
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
				? (regionPrices.find(r => r.regionId === context.regionId)?.priceCredits ?? item.priceCredits)
				: item.priceCredits

		// Every coin is spendable on anything, so affordability compares the whole balance against the price – display and purchase read the same number, so the shelf can never advertise a price the till refuses.
		const payableFrom = spendableFor(balances, item.category)
		return Object.assign(base, {
			affordable: payableFrom >= priceCredits,
			locked,
			lockReason,
			ownedCount,
			priceCredits,
		})
	})

	// The sticker sheet is the one item pinned above the shelf order: it is the cheap add-on people put in alongside a real order, and an admin's sort order should not bury it.
	const stickerSheet = (item: (typeof view)[number]) => `${item.id} ${item.name}`.toLowerCase().includes("sticker")

	return {
		balances,
		country: context.country,
		items: [...view.filter(stickerSheet), ...view.filter(item => !stickerSheet(item))],
		regionId: context.regionId,
		regions,
	}
}

/** Parse a public-view order row's timestamps. Prisma 8 reads them as PostgreSQL text. */
type ShopOrderPublicRow = Pick<Models.public_ShopOrder, (typeof shopOrderPublicFields)[number]>

export function toShopOrderPublic(row: ShopOrderPublicRow): ShopOrderPublic {
	const parse = (value: string | null): Date | null => (value === null ? null : parseDbTimestamp(value))
	return {
		...row,
		fulfilledAt: parse(row.fulfilledAt),
		fulfillmentUpdatedAt: parse(row.fulfillmentUpdatedAt),
		heldAt: parse(row.heldAt),
		placedAt: parseDbTimestamp(row.placedAt),
		rejectedAt: parse(row.rejectedAt),
	}
}

/**
 * Buy something.
 *
 * The whole thing runs under a per-user advisory lock. The ledger's `@@unique([shopOrderId, kind, bucket])` only stops one order being charged twice – two concurrent purchases mint two different order ids and collide with nothing, so without the lock ten parallel requests all read the same balance and all succeed.
 *
 * `note` is the buyer's own words for the staff who fulfil the order. It is written inside the transaction, against the order, with the buyer as its author – so a note that is accepted is a note that is kept, rather than one that is silently dropped on the floor.
 */
export async function purchase(
	userId: string,
	shopItemId: string,
	quantity: number,
	idempotencyKey?: string,
	note?: string | null,
): Promise<ShopOrderPublic> {
	const access = await getShopAccess(userId)
	if (!access.open) throw new HttpError("SHOP_CLOSED", SHOP_CLOSED_MESSAGE)

	// Spending is where identity is asked for. It used to be asked at submit, which turned the last step of a finished week into a wall for anyone who had not got round to verifying – and the shop is the one thing money and a shipping address are actually behind. Checked before the transaction rather than inside it: it is the buyer's own state, read fresh, and nothing concurrent here can undo it.
	if (!(await isIdentityVerified(userId)))
		throw new HttpError(
			"NOT_VERIFIED",
			"Identity verification is required to buy things. Verify at identity.hackclub.com.",
		)

	const item = await db.orm.public.ShopItem.whereUnique({ id: shopItemId }).first()
	if (!item?.active) throw new HttpError("NOT_FOUND", "Item not found")

	// The note is read as plain text, so its markup is stripped before anything is stored – outside the
	// transaction, because it is work that has nothing to do with the rows.
	const body = note ? sanitize(note) : null

	if (item.requiresPrinterQualified) {
		const qualification = await getPrinterQualification(userId)
		if (!qualification.qualified)
			throw new HttpError("ITEM_LOCKED", `Ship all ${qualification.required} themes to unlock this`)
	}

	return db.transaction(async tx => {
		await lockUserCredit(tx, userId)

		// Re-checked inside the transaction: the pre-check above ran against reads taken before the lock, so a shop-close or a qualification-revoke in between must not still complete. Read off the transaction so this sees a consistent snapshot.
		const settings = await tx.orm.public.ProgramSettings.whereUnique({ id: "singleton" }).first()
		if (!settings?.shopOpen) throw new HttpError("SHOP_CLOSED", SHOP_CLOSED_MESSAGE)
		if (settings.shopClosesAt && parseDbTimestamp(settings.shopClosesAt) <= new Date()) {
			const [awaitingReview, lastReview] = await Promise.all([
				tx.orm.public.ThemeProject.where({ deletedAt: null, userId })
					.where(project => or(project.designStatus.eq("in_review"), project.buildStatus.eq("in_review")))
					.aggregate(a => ({ count: a.count() })),
				tx.orm.public.ThemeProject.where({ deletedAt: null, userId }).aggregate(a => ({
					buildReviewedAt: a.max("buildReviewedAt"),
					designReviewedAt: a.max("designReviewedAt"),
				})),
			])
			const grace = shopGraceAccess(settings, {
				awaitingReview: awaitingReview.count,
				buildReviewedAt: lastReview.buildReviewedAt === null ? null : parseDbTimestamp(lastReview.buildReviewedAt),
				designReviewedAt: lastReview.designReviewedAt === null ? null : parseDbTimestamp(lastReview.designReviewedAt),
			})
			if (!grace.open) throw new HttpError("SHOP_CLOSED", SHOP_CLOSED_MESSAGE)
		}
		if (item.requiresPrinterQualified) {
			const shipped = await tx.orm.public.ThemeProject.where({
				buildStatus: PhaseStatus.approved,
				deletedAt: null,
				designStatus: PhaseStatus.approved,
				userId,
			}).aggregate(a => ({ count: a.count() }))
			if (shipped.count < THEMES_REQUIRED_FOR_PRINTER)
				throw new HttpError("ITEM_LOCKED", "This item is locked for your account")
		}

		// The buyer's region, re-read here rather than trusted from the shelf: the price on the order is whatever this resolves to, so display and charge cannot drift apart.
		const buyer = await tx.orm.public.User.whereUnique({ id: userId })
			.include("shopRegion", region => region.select("active", "id"))
			.first()
		const buyerRegionId = buyer?.shopRegion?.active ? buyer.shopRegion.id : null
		const regional =
			buyerRegionId !== null
				? await tx.orm.public.ShopItemRegionPrice.where({ regionId: buyerRegionId, shopItemId })
						.select("priceCredits")
						.first()
				: null
		// A retried request – double-tap, proxy retry, two tabs sharing one key – resolves to the order it already made rather than charging again. The same per-user lock serializes the two, so the loser always sees the winner's row.
		if (idempotencyKey) {
			const existing = await tx.orm.public.ShopOrder.where({ idempotencyKey, userId })
				.select(...shopOrderPublicFields)
				.first()
			if (existing) {
				// A key whose order was refused afterwards is not a success to hand back. The order was
				// rejected and refunded, this request creates nothing, and returning it as a fresh purchase
				// would tell the caller it owns a thing it never received.
				if (existing.status === ShopOrderStatus.REJECTED || existing.status === ShopOrderStatus.CANCELLED)
					throw new HttpError("CONFLICT", "That order has already been rejected or cancelled")
				return toShopOrderPublic(existing)
			}
		}

		// Re-read stock inside the transaction; the catalogue page may be stale.
		const fresh = await tx.orm.public.ShopItem.whereUnique({ id: shopItemId }).first()
		// A printer is hidden from the shop, so it is as good as not there: a request for one by id is refused the same way a retired item is.
		if (!fresh?.active || fresh.category === ShopItemCategory.PRINTER)
			throw new HttpError("NOT_FOUND", "Item not found")
		if (fresh.stock !== null && fresh.stock < quantity) throw new HttpError("OUT_OF_STOCK", "Not enough stock left")

		if (fresh.maxPerUser > 0) {
			const owned = await tx.orm.public.ShopOrder.where({ shopItemId, userId })
				.where(order => order.status.notIn([ShopOrderStatus.REJECTED, ShopOrderStatus.CANCELLED]))
				.aggregate(a => ({ quantity: a.sum("quantity") }))
			if ((owned.quantity ?? 0) + quantity > fresh.maxPerUser)
				throw new HttpError("PURCHASE_LIMIT", `Limit ${fresh.maxPerUser} per person`)
		}

		const unitPrice = regional?.priceCredits ?? fresh.priceCredits
		const totalCredits = unitPrice * quantity
		const balances = await getBalances(tx, userId)
		const payableFrom = spendableFor(balances, fresh.category)
		if (payableFrom < totalCredits)
			throw new HttpError("INSUFFICIENT_CREDIT", `You need ${totalCredits - payableFrom} more to buy this`)

		const created = await tx.orm.public.ShopOrder.create({
			idempotencyKey: idempotencyKey ?? null,
			itemNameSnapshot: fresh.name,
			quantity,
			shopItemId,
			// Whether this order takes stock off the shelf. The catalogue can change after the order is
			// placed – an item that was unlimited can be given a stock figure – so the reject path cannot
			// work it out from the item's stock later, and has to be told.
			stockDebited: fresh.stock !== null,
			totalCredits,
			unitCostUsd: fresh.costUsd,
			unitCredits: unitPrice,
			userId,
		})
		// Only the buyer's fields come back; `unitCostUsd` is stored for fulfillment but must not leave the server.
		const order = toShopOrderPublic(created)

		// The buyer's note, kept against the order with the buyer as its author. Written here, inside the
		// transaction, so it lands with the order it belongs to: a note that is accepted but not kept is
		// worse than no note at all, because the staff reading the order would have no way to know one was sent.
		if (body) await tx.orm.public.ShopOrderNote.create({ authorId: userId, body, orderId: order.id })

		// Every coin is spendable on anything, so a purchase is paid out of the whole balance – but the whole
		// balance is not in one pot. The debit follows the coins: the spendable pot first, then the legacy
		// banked pot for whatever is left. Writing the whole debit against SPENDABLE would drive that pot
		// negative whenever the coins happen to sit in BANKED, and a negative pot is a state nothing else in
		// the app is willing to create. The refund path reads these rows back, so each pot is given back
		// exactly what it paid.
		let remaining = totalCredits
		for (const bucket of [CoinBucket.SPENDABLE, CoinBucket.BANKED]) {
			if (remaining <= 0) break
			const available = bucket === CoinBucket.SPENDABLE ? balances.spendable : balances.banked
			const amount = Math.min(Math.max(available, 0), remaining)
			if (amount <= 0) continue
			await appendLedgerEntry(tx, {
				amount: -amount,
				bucket,
				createdById: userId,
				kind: LedgerKind.SHOP_PURCHASE,
				note: `${quantity}× ${fresh.name}`,
				shopOrderId: order.id,
				userId,
			})
			remaining -= amount
		}
		// Only reachable when a pot is already negative, which the combined check above cannot see. The
		// purchase is refused rather than deepening the hole.
		if (remaining > 0) throw new HttpError("INSUFFICIENT_CREDIT", `You need ${remaining} more to buy this`)

		if (fresh.stock !== null) {
			// Conditional, so stock cannot go negative even if two people buy the last unit at once – the loser matches no row and rolls back.
			const stockPlan = tx.raw
				.sql`UPDATE "shop_item" SET "stock" = "stock" - ${quantity} WHERE "id" = ${shopItemId} AND "stock" >= ${quantity}`
				.affectedCount()
				.build()
			const { affectedRows } = await tx.execute(stockPlan)
			if (affectedRows !== 1) throw new HttpError("OUT_OF_STOCK", "Not enough stock left")
		}

		return order
	})
}

/**
 * Reject an order and refund it.
 *
 * The refund is a new positive row, never an edit to the original debit: the ledger is append-only, and the history of a rejected order is part of the record.
 */
/** One order row as writes return it: scalars only, no relations loaded. */
export type ShopOrderRow = Omit<Models.public_ShopOrder, "ledgerEntries" | "notes" | "shopItem" | "user">

export async function rejectOrder(orderId: string, adminId: string, reason: string): Promise<ShopOrderRow> {
	const target = await db.orm.public.ShopOrder.whereUnique({ id: orderId }).select("userId").first()
	if (!target) throw new HttpError("NOT_FOUND", "Order not found")

	return db.transaction(async tx => {
		await lockUserCredit(tx, target.userId)

		const order = await tx.orm.public.ShopOrder.whereUnique({ id: orderId }).first()
		if (!order) throw new HttpError("NOT_FOUND", "Order not found")
		if (order.status !== ShopOrderStatus.PENDING && order.status !== ShopOrderStatus.ON_HOLD)
			throw new HttpError("CONFLICT", "This order has already been decided")

		// Refund each pot exactly what it paid, by reading back the purchase rows rather than assuming. Refunding the whole total as spendable would turn a rejected printer order into a laundering step: coins that could only ever have bought a printer would come back as coins that can buy anything.
		const paid = await tx.orm.public.LedgerEntry.where({ kind: LedgerKind.SHOP_PURCHASE, shopOrderId: order.id })
			.groupBy("bucket")
			.aggregate(group => ({ total: group.sum("amount") }))

		for (const row of paid) {
			// Purchases are negative; the refund is its mirror.
			const amount = -(row.total ?? 0)
			if (amount <= 0) continue
			await appendLedgerEntry(tx, {
				amount,
				bucket: row.bucket,
				createdById: adminId,
				kind: LedgerKind.SHOP_REFUND,
				note: `Refund for order #${order.orderNumber}: ${reason}`,
				shopOrderId: order.id,
				userId: order.userId,
			})
		}

		// The stock goes back only if it was taken. The catalogue's stock figure can change after the
		// order was placed – an item that was unlimited can be given a figure – so the order carries the
		// answer rather than the item's stock now. Orders placed before that column existed do not carry
		// it, and are treated as having taken stock, which is what this path always did.
		const stockDebited = order.stockDebited ?? true
		if (stockDebited && order.shopItemId) {
			const restockPlan = tx.raw
				.sql`UPDATE "shop_item" SET "stock" = "stock" + ${order.quantity} WHERE "id" = ${order.shopItemId} AND "stock" IS NOT NULL`
				.affectedCount()
				.build()
			await tx.execute(restockPlan)
		}

		const [updated] = await tx.orm.public.ShopOrder.where({ id: orderId }).updateAll({
			lastActorId: adminId,
			rejectedAt: formatDbTimestamp(new Date()),
			rejectionReason: reason,
			status: ShopOrderStatus.REJECTED,
		})
		if (!updated) throw new HttpError("NOT_FOUND", "Order not found")
		return updated
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
): Promise<ShopOrderRow> {
	const target = await db.orm.public.ShopOrder.whereUnique({ id: orderId }).select("userId").first()
	if (!target) throw new HttpError("NOT_FOUND", "Order not found")

	return db.transaction(async tx => {
		await lockUserCredit(tx, target.userId)

		const order = await tx.orm.public.ShopOrder.whereUnique({ id: orderId }).first()
		if (!order) throw new HttpError("NOT_FOUND", "Order not found")
		if (order.status === ShopOrderStatus.FULFILLED) throw new HttpError("CONFLICT", "This order is already fulfilled")
		if (order.status === ShopOrderStatus.REJECTED) throw new HttpError("CONFLICT", "This order was rejected")
		if (order.status === ShopOrderStatus.CANCELLED) throw new HttpError("CONFLICT", "This order was cancelled")

		const claimed = await tx.orm.public.ShopOrder.where({ id: orderId, status: order.status }).updateAndCount({
			fulfilledAt: formatDbTimestamp(new Date()),
			lastActorId: adminId,
			status: ShopOrderStatus.FULFILLED,
			trackingCarrier: tracking.carrier ?? null,
			trackingNumber: tracking.number ?? null,
		})
		if (claimed !== 1) throw new HttpError("CONFLICT", "This order was decided by someone else")

		return tx.orm.public.ShopOrder.whereUnique({ id: orderId }).firstOrThrow()
	})
}
