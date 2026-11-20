import "server-only"
import { and } from "@prisma/orm-postgres/orm-client"
import { LegacyShopDmStatus, type ShopDeliveryPreference, ShopOrderStatus } from "@/lib/enums"
import {
	groupLegacyShopBuyers,
	type LegacyShopBuyer,
	type LegacyShopLine,
	type LegacyShopOrderRow,
	legacyShopMessage,
} from "@/lib/legacy-shop-dm-policy"
import db, { isUniqueViolation } from "@/lib/prisma8"
import { openDirectMessage, postMessage, type SlackBlock } from "@/lib/site/slack"
import { formatDbTimestamp } from "@/lib/time"

/**
 * The legacy-order DMs: orders placed before the delivery choice existed, which stay on no delivery preference until the fulfilment rules are settled. The admin tab previews and sends them, and a buyer's button press records their answer here.
 *
 * Every send is claimed in the database before Slack is called. A claimed order is PENDING or SENT, and the partial unique index on `LegacyShopDmOrder.shopOrderId` refuses a second claim, so a repeated send or a second admin cannot message the same order twice. A send that fails releases its orders.
 */

const OPEN_STATUSES = [ShopOrderStatus.PENDING, ShopOrderStatus.ON_HOLD]
const LIVE_DM_STATUSES = [LegacyShopDmStatus.PENDING, LegacyShopDmStatus.SENT]

/** How many past DMs the tab lists. */
const HISTORY_LIMIT = 200

const TEST_LINES: LegacyShopLine[] = [{ choice: null, itemName: "Sample item", orderId: null, orderNumber: null }]

export interface LegacyShopDmOrderRecord {
	choice: ShopDeliveryPreference | null
	choiceAt: string | null
	itemName: string
	orderId: string
	orderNumber: number
	status: LegacyShopDmStatus
}

export interface LegacyShopDmRecord {
	createdAt: string
	error: string | null
	id: string
	orders: LegacyShopDmOrderRecord[]
	sentAt: string | null
	slackId: string
	status: LegacyShopDmStatus
	test: boolean
	userId: string | null
}

export interface LegacyShopPreview {
	buyers: LegacyShopBuyer[]
	history: LegacyShopDmRecord[]
}

export interface LegacyShopSendOutcome {
	reason: string | null
	status: "FAILED" | "SENT" | "SKIPPED"
	userId: string
}

/** Every open order with no delivery preference that no live DM lists, grouped by buyer. */
async function eligibleBuyers(): Promise<LegacyShopBuyer[]> {
	const open = await db.orm.public.ShopOrder.where(order =>
		and(order.deliveryPreference.isNull(), order.status.in(OPEN_STATUSES)),
	)
		.select("id", "itemNameSnapshot", "orderNumber", "userId")
		.all()
	const listed = await db.orm.public.LegacyShopDmOrder.where(row => row.status.in(LIVE_DM_STATUSES))
		.select("shopOrderId")
		.all()
	const userIds = [...new Set(open.map(order => order.userId))]
	const users =
		userIds.length === 0
			? []
			: await db.orm.public.User.where(user => user.id.in(userIds))
					.select("id", "slackId")
					.all()
	const slackIds = new Map(users.map(user => [user.id, user.slackId] as const))
	const rows: LegacyShopOrderRow[] = open.map(order => ({
		itemName: order.itemNameSnapshot,
		orderId: order.id,
		orderNumber: order.orderNumber,
		userId: order.userId,
	}))
	return groupLegacyShopBuyers(rows, new Set(listed.map(row => row.shopOrderId)), slackIds)
}

/** The most recent DMs, each with the orders it listed and what the buyer chose. */
async function recentLegacyShopDms(): Promise<LegacyShopDmRecord[]> {
	const dms = await db.orm.public.LegacyShopDm.where({})
		.orderBy([dm => dm.createdAt.desc()])
		.limit(HISTORY_LIMIT)
		.select("createdAt", "error", "id", "sentAt", "slackId", "status", "test", "userId")
		.all()
	if (dms.length === 0) return []

	const rows = await db.orm.public.LegacyShopDmOrder.where(row => row.dmId.in(dms.map(dm => dm.id)))
		.select("choice", "choiceAt", "dmId", "shopOrderId", "status")
		.include("shopOrder", order => order.select("itemNameSnapshot", "orderNumber"))
		.all()

	return dms.map(dm => ({
		createdAt: dm.createdAt,
		error: dm.error,
		id: dm.id,
		orders: rows
			.filter(row => row.dmId === dm.id && row.shopOrder)
			.map(row => ({
				choice: row.choice,
				choiceAt: row.choiceAt,
				itemName: row.shopOrder?.itemNameSnapshot ?? "",
				orderId: row.shopOrderId,
				orderNumber: row.shopOrder?.orderNumber ?? 0,
				status: row.status,
			}))
			.sort((a, b) => a.orderNumber - b.orderNumber),
		sentAt: dm.sentAt,
		slackId: dm.slackId,
		status: dm.status,
		test: dm.test,
		userId: dm.userId,
	}))
}

export async function listLegacyShopPreview(): Promise<LegacyShopPreview> {
	const [buyers, history] = await Promise.all([eligibleBuyers(), recentLegacyShopDms()])
	return { buyers, history }
}

function errorText(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}

/** Opens the buyer's DM and posts the message, answering the channel and timestamp a later click needs. */
async function postDirect(
	slackId: string,
	message: { blocks: SlackBlock[]; text: string },
): Promise<{ channel: string; ts: string }> {
	const channel = await openDirectMessage(slackId)
	const posted = await postMessage(channel, message.text, { blocks: message.blocks })
	if (!posted.ok || !posted.ts) throw new Error(`chat.postMessage failed: ${posted.error ?? "no timestamp"}`)
	return { channel, ts: posted.ts }
}

/** Records the outcome of a send: the DM and its orders become SENT with the message's coordinates, or FAILED with the reason, which releases the orders. */
async function settleLegacyShopDm(
	dmId: string,
	outcome: { channel: string; ts: string } | { error: string },
): Promise<void> {
	await db.transaction(async tx => {
		if ("error" in outcome) {
			await tx.orm.public.LegacyShopDm.where({ id: dmId }).update({
				error: outcome.error,
				status: LegacyShopDmStatus.FAILED,
			})
			await tx.orm.public.LegacyShopDmOrder.where({ dmId }).update({ status: LegacyShopDmStatus.FAILED })
			return
		}
		await tx.orm.public.LegacyShopDm.where({ id: dmId }).update({
			channel: outcome.channel,
			sentAt: formatDbTimestamp(new Date()),
			status: LegacyShopDmStatus.SENT,
			ts: outcome.ts,
		})
		await tx.orm.public.LegacyShopDmOrder.where({ dmId }).update({ status: LegacyShopDmStatus.SENT })
	})
}

/** Claims the buyer's orders in one row before Slack is called. Null when a live DM already holds one of them. */
async function claimLegacyShopDm(buyer: LegacyShopBuyer, sentById: string): Promise<string | null> {
	try {
		return await db.transaction(async tx => {
			const dm = await tx.orm.public.LegacyShopDm.create({
				sentById,
				slackId: buyer.slackId ?? "",
				test: false,
				userId: buyer.userId,
			})
			for (const order of buyer.orders)
				await tx.orm.public.LegacyShopDmOrder.create({ dmId: dm.id, shopOrderId: order.orderId })
			return dm.id
		})
	} catch (err) {
		if (isUniqueViolation(err)) return null
		throw err
	}
}

async function sendToBuyer(buyer: LegacyShopBuyer, sentById: string): Promise<LegacyShopSendOutcome> {
	if (buyer.skipReason || !buyer.slackId) return { reason: buyer.skipReason, status: "SKIPPED", userId: buyer.userId }

	const dmId = await claimLegacyShopDm(buyer, sentById)
	if (!dmId) return { reason: "Already messaged", status: "SKIPPED", userId: buyer.userId }

	const lines: LegacyShopLine[] = buyer.orders.map(order => ({
		choice: null,
		itemName: order.itemName,
		orderId: order.orderId,
		orderNumber: order.orderNumber,
	}))

	let posted: { channel: string; ts: string }
	try {
		posted = await postDirect(buyer.slackId, legacyShopMessage(lines, false))
	} catch (err) {
		const error = errorText(err)
		await settleLegacyShopDm(dmId, { error })
		return { reason: error, status: "FAILED", userId: buyer.userId }
	}
	// Outside the try: a database error here must not turn a message that was delivered into a failure, which would release its orders to be messaged again.
	await settleLegacyShopDm(dmId, posted)
	return { reason: null, status: "SENT", userId: buyer.userId }
}

/**
 * Sends one DM to each named buyer who is still eligible. A buyer who is not eligible, or whose orders a live DM already lists, is reported as skipped rather than messaged again.
 */
export async function sendLegacyShopDms(
	userIds: readonly string[],
	sentById: string,
): Promise<LegacyShopSendOutcome[]> {
	const buyers = new Map((await eligibleBuyers()).map(buyer => [buyer.userId, buyer] as const))
	const outcomes: LegacyShopSendOutcome[] = []
	for (const userId of userIds) {
		const buyer = buyers.get(userId)
		if (!buyer) {
			outcomes.push({ reason: "Nothing open to message", status: "SKIPPED", userId })
			continue
		}
		outcomes.push(await sendToBuyer(buyer, sentById))
	}
	return outcomes
}

/** A test DM to any Slack ID. It lists no order and changes none, but it is recorded like the rest. */
export async function sendLegacyShopTest(
	slackId: string,
	sentById: string,
): Promise<{ error: string | null; status: "FAILED" | "SENT" }> {
	const dm = await db.orm.public.LegacyShopDm.create({ sentById, slackId, test: true, userId: null })

	let posted: { channel: string; ts: string }
	try {
		posted = await postDirect(slackId, legacyShopMessage(TEST_LINES, true))
	} catch (err) {
		const error = errorText(err)
		await settleLegacyShopDm(dm.id, { error })
		return { error, status: "FAILED" }
	}
	await settleLegacyShopDm(dm.id, posted)
	return { error: null, status: "SENT" }
}

export type LegacyShopChoiceOutcome =
	| { channel: string; message: { blocks: SlackBlock[]; text: string }; ok: true; ts: string }
	| { ok: false; reason: string }

const notOpen = (order: { deliveryPreference: ShopDeliveryPreference | null; status: ShopOrderStatus }): boolean =>
	order.deliveryPreference === null && OPEN_STATUSES.includes(order.status)

/**
 * Records the buyer's answer for one order and says what the DM should now show.
 *
 * Only the buyer the DM was sent to can answer, and only while the order is still open. The answer is kept on the DM's order row, not the order: the order's delivery preference stays null until fulfilment is settled.
 */
export async function recordLegacyShopChoice(input: {
	choice: ShopDeliveryPreference
	orderId: string
	slackUserId: string
}): Promise<LegacyShopChoiceOutcome> {
	const row = await db.orm.public.LegacyShopDmOrder.where({
		shopOrderId: input.orderId,
		status: LegacyShopDmStatus.SENT,
	}).first()
	if (!row) return { ok: false, reason: "This order is not on an open message." }

	const dm = await db.orm.public.LegacyShopDm.whereUnique({ id: row.dmId }).first()
	if (!dm?.channel || !dm.ts) return { ok: false, reason: "The message for this order cannot be found." }
	if (dm.slackId !== input.slackUserId)
		return { ok: false, reason: "Only the person this message was sent to can answer it." }

	const order = await db.orm.public.ShopOrder.whereUnique({ id: input.orderId })
		.select("deliveryPreference", "status")
		.first()
	if (!order || !notOpen(order))
		return { ok: false, reason: "This order is no longer open, so its choice cannot change." }

	await db.orm.public.LegacyShopDmOrder.where({ id: row.id }).update({
		choice: input.choice,
		choiceAt: formatDbTimestamp(new Date()),
	})

	const rows = await db.orm.public.LegacyShopDmOrder.where({ dmId: dm.id, status: LegacyShopDmStatus.SENT })
		.select("choice", "shopOrderId")
		.include("shopOrder", shopOrder => shopOrder.select("itemNameSnapshot", "orderNumber"))
		.all()
	const lines: LegacyShopLine[] = rows
		.filter(line => line.shopOrder)
		.map(line => ({
			choice: line.choice,
			itemName: line.shopOrder?.itemNameSnapshot ?? "",
			orderId: line.shopOrderId,
			orderNumber: line.shopOrder?.orderNumber ?? null,
		}))
		.sort((a, b) => (a.orderNumber ?? 0) - (b.orderNumber ?? 0))

	return { channel: dm.channel, message: legacyShopMessage(lines, false), ok: true, ts: dm.ts }
}
