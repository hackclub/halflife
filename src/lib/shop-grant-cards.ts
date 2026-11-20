import "server-only"
import { AuditAction, logAuditTx, requestInfo } from "@/lib/audit"
import { lockUserCredit } from "@/lib/currency"
import { HcbGrantCardStatus, PayoutSource, ShopOrderStatus } from "@/lib/enums"
import { HttpError, messageOf } from "@/lib/errors"
import { merchantIdsEqual, normalizeMerchantIds } from "@/lib/grant-card-policy"
import { ABANDONED_CARD_ATTEMPT_MS, claimedGrantIds } from "@/lib/grant-cards"
import { isIdentityVerified } from "@/lib/hca-profile"
import {
	cancelCardGrant,
	createCardGrant,
	isHcbConfigured,
	listOrganizationCardGrants,
	readCardGrantSpend,
	readOrganizationBalanceCents,
	reconcileCardGrantIssue,
} from "@/lib/hcb"
import { lockKey } from "@/lib/locks"
import { payoutBlockReason } from "@/lib/moderation"
import { formatUsd } from "@/lib/money"
import db, { type DbOrTx, isUniqueViolation } from "@/lib/prisma8"
import { getProgramSettings } from "@/lib/program"
import {
	shopGrantCardBlockReason,
	shopGrantCardInstructions,
	shopGrantCardInviteMessage,
	shopGrantCardPurpose,
} from "@/lib/shop-grant-card-policy"
import { isLiveShopCard, isSettledShopCard } from "@/lib/shop-order"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"
import { isRecord } from "@/lib/unknown"

/**
 * Issue the HCB card grant an order asked for instead of shipping.
 *
 * One order, one card. The order is the funding decision, so there is no preview to freeze: the order row already holds the amount, and the live-card index stops a second card for the same order. The mechanics around the HCB call are the parts batch's: claim before paying, reconcile a lost response, audit, and never retry blindly.
 */

export interface ShopGrantCardOutcome {
	amountCents: number
	error: string | null
	hcbCardGrantId: string | null
	id: string
	/** The merchant allowlist this card was issued with. Empty means unrestricted. */
	merchantIds: readonly string[]
	orderId: string
	status: HcbGrantCardStatus
}

interface Admin {
	email: string | null
	id: string
}

interface RequestInfo {
	ip: string | null
	userAgent: string | null
}

/** The order fields a card needs, with the account checks read fresh. */
function loadOrder(client: DbOrTx, orderId: string) {
	return client.orm.public.ShopOrder.whereUnique({ id: orderId })
		.select(
			"deliveryPreference",
			"grantCardCents",
			"grantCardMerchantIds",
			"id",
			"itemNameSnapshot",
			"orderNumber",
			"status",
			"userId",
		)
		.include("user", user => user.select("bannedAt", "email", "fraudFlagged", "id", "name", "suspendedUntil"))
		.first()
}

function listCards(client: DbOrTx, orderId: string) {
	// Newest first, so the outcome a caller sees is the latest attempt rather than an old failed one.
	return client.orm.public.HcbShopGrantCard.where({ shopOrderId: orderId })
		.orderBy([card => card.createdAt.desc(), card => card.id.desc()])
		.all()
}

type ShopGrantCardRow = Awaited<ReturnType<typeof listCards>>[number]

async function assertReadyToIssue(): Promise<void> {
	const settings = await getProgramSettings()
	if (settings.payoutSource !== PayoutSource.HCB)
		throw new HttpError("CONFLICT", "Payouts are not set to HCB card grants")
	if (!isHcbConfigured()) throw new HttpError("NOT_CONFIGURED", "HCB is not configured on this deployment")
}

function hcbStatusOf(err: unknown): number | null {
	if (!(err instanceof HttpError) || !isRecord(err.details)) return null
	const status = err.details.hcbStatus
	return typeof status === "number" ? status : null
}

function toOutcome(row: {
	amountCents: number
	error: string | null
	grantCardMerchantIds: readonly string[]
	hcbCardGrantId: string | null
	id: string
	shopOrderId: string
	status: HcbGrantCardStatus
}): ShopGrantCardOutcome {
	return {
		amountCents: row.amountCents,
		error: row.error,
		hcbCardGrantId: row.hcbCardGrantId,
		id: row.id,
		merchantIds: row.grantCardMerchantIds,
		orderId: row.shopOrderId,
		status: row.status,
	}
}

/** A merchant lock in words, for a reason an admin has to act on. */
function merchantLockLabel(ids: readonly string[] | null): string {
	if (ids === null) return "a merchant lock Half Life could not read"
	return ids.length === 0 ? "no merchant lock" : ids.join(", ")
}

/** Why HCB's answer does not carry the lock this order asked for, or null when it does. */
function merchantMismatchReason(
	grant: { allowedMerchants: string[] | null; id: string; merchantLock: string[] | null },
	expected: readonly string[],
): string | null {
	if (grant.merchantLock === null || grant.allowedMerchants === null)
		return `HCB did not report the merchant lock for grant ${grant.id}. Check it on HCB before retrying`
	if (!merchantIdsEqual(expected, grant.merchantLock))
		return `HCB issued grant ${grant.id} with ${merchantLockLabel(grant.merchantLock)} instead of ${merchantLockLabel(expected)}. Check it on HCB before retrying`
	if (!expected.every(id => grant.allowedMerchants?.includes(id)))
		return `HCB's allowlist for grant ${grant.id} does not include every merchant this order asked for. Check it on HCB before retrying`
	return null
}

async function markFailed(id: string, reason: string): Promise<void> {
	await db.orm.public.HcbShopGrantCard.where({ id }).update({
		error: reason,
		status: HcbGrantCardStatus.FAILED,
	})
}

async function markAmbiguous(id: string, reason: string): Promise<void> {
	await db.orm.public.HcbShopGrantCard.where({ id }).update({
		error: reason,
		status: HcbGrantCardStatus.AMBIGUOUS,
	})
}

/**
 * Record the grant HCB made, and mark the order fulfilled, in one transaction: a card that exists on HCB always has its row, and an issued card always means a fulfilled order.
 *
 * The order's owner is fixed at purchase, so reading it before the transaction is safe. The credit lock is what serialises this with a refund or a shipment. The order update is conditional on it still being open. If it is not, the card is still recorded, because the money has already moved, and the audit says the order was not fulfilled.
 */
async function markIssued(
	claimed: { amountCents: number; grantCardMerchantIds: readonly string[]; id: string; purpose: string | null },
	orderId: string,
	grant: { cardId: string | null; id: string; status: string | null },
	purpose: string,
	admin: Admin,
	request: RequestInfo,
): Promise<void> {
	const { userId } = await db.orm.public.ShopOrder.whereUnique({ id: orderId }).select("userId").firstOrThrow()
	await db.transaction(async tx => {
		await lockUserCredit(tx, userId)
		await tx.orm.public.HcbShopGrantCard.where({ id: claimed.id }).update({
			cardId: grant.cardId,
			error: null,
			hcbCardGrantId: grant.id,
			hcbStatus: grant.status,
			issuedAt: formatDbTimestamp(new Date()),
			status: HcbGrantCardStatus.ISSUED,
		})
		const fulfilled = await tx.orm.public.ShopOrder.where({ id: orderId })
			.where(order => order.status.in([ShopOrderStatus.PENDING, ShopOrderStatus.ON_HOLD]))
			.updateAndCount({
				fulfilledAt: formatDbTimestamp(new Date()),
				lastActorId: admin.id,
				status: ShopOrderStatus.FULFILLED,
			})
		await logAuditTx(tx, {
			action: AuditAction.ADMIN_ISSUE_GRANT_CARD,
			actorEmail: admin.email,
			actorId: admin.id,
			ip: request.ip,
			metadata: {
				amountCents: claimed.amountCents,
				cardId: grant.cardId,
				fulfilled: fulfilled === 1,
				grantId: grant.id,
				merchantIds: [...claimed.grantCardMerchantIds],
				orderId,
				purpose,
			},
			targetId: orderId,
			targetType: "ShopOrder",
			userAgent: request.userAgent,
		})
	})
}

export interface ShopGrantCardIssueOptions {
	/**
	 * The merchant allowlist this send chose, for a bulk batch that fills it in per item. Omitted, the order's own snapshot is used, which is what the single-order panel does. It is stored on the attempt, so a later reconcile checks the lock the card was actually issued with.
	 */
	merchantIds?: readonly string[]
}

/**
 * Issue the card for one order.
 *
 * A double click resolves to the card that was already issued rather than making a second one. A card that was cancelled or returned stops the order being paid again here: that is an admin decision, not something a retry does on its own.
 */
export async function issueShopGrantCard(
	orderId: string,
	admin: Admin,
	options: ShopGrantCardIssueOptions = {},
): Promise<ShopGrantCardOutcome> {
	const overrideMerchantIds = options.merchantIds === undefined ? null : normalizeMerchantIds(options.merchantIds)
	// An empty override would quietly issue an unrestricted card, which is the opposite of what a batch asks for. The order's own snapshot may be empty – that has always meant "anywhere" – but an explicit list may not be.
	if (overrideMerchantIds !== null && overrideMerchantIds.length === 0)
		throw new HttpError("VALIDATION_FAILED", "A grant card needs at least one merchant ID")

	await assertReadyToIssue()

	const order = await loadOrder(db, orderId)
	if (!order) throw new HttpError("NOT_FOUND", "Order not found")
	if (!order.user) throw new HttpError("CONFLICT", "The buyer's account no longer exists")

	const cards = await listCards(db, orderId)
	const issued = cards.find(card => card.status === HcbGrantCardStatus.ISSUED)
	if (issued) return toOutcome(issued)
	const inFlight = cards.find(card => isLiveShopCard(card.status))
	if (inFlight)
		throw new HttpError(
			"CONFLICT",
			inFlight.status === HcbGrantCardStatus.PENDING
				? "A card grant for this order is already in progress"
				: "This order's card grant is ambiguous. Check it against HCB first",
		)
	const settled = cards.find(card => isSettledShopCard(card.status))
	if (settled)
		throw new HttpError(
			"CONFLICT",
			settled.status === HcbGrantCardStatus.CANCELED
				? "An earlier card for this order was cancelled. Check HCB before issuing another"
				: "The buyer returned an earlier card for this order",
		)

	const verified = await isIdentityVerified(order.userId)
	const block = shopGrantCardBlockReason(order, payoutBlockReason(order.user), verified)
	if (block) throw new HttpError("CONFLICT", block)
	const amountCents = order.grantCardCents
	if (amountCents === null || amountCents <= 0) throw new HttpError("CONFLICT", "This order has no grant card amount")

	const balanceCents = await readOrganizationBalanceCents()
	if (balanceCents < amountCents)
		throw new HttpError(
			"CONFLICT",
			`HCB holds ${formatUsd(balanceCents / 100)}, less than this card's ${formatUsd(amountCents / 100)}. Nothing was created`,
		)

	const { email } = order.user
	const purpose = shopGrantCardPurpose(order.itemNameSnapshot)
	const { ip, userAgent } = await requestInfo()
	const now = new Date()

	// The claim is the guard: the lock serializes every issuer, and the live-card index is the second check for a
	// second tab or a stale page. Everything the card will pay is re-read here, not trusted from above.
	const claimed = await db
		.transaction(async tx => {
			// The credit lock is the one a refund, a cancellation and a shipment take, so none of them can run between this check and the claim.
			await lockUserCredit(tx, order.userId)
			await lockKey(tx, "grant-cards:issue")
			const fresh = await loadOrder(tx, orderId)
			if (!fresh?.user) throw new HttpError("CONFLICT", "The buyer's account no longer exists")
			const freshBlock = shopGrantCardBlockReason(fresh, payoutBlockReason(fresh.user), verified)
			if (freshBlock) throw new HttpError("CONFLICT", freshBlock)
			const freshCards = await tx.orm.public.HcbShopGrantCard.where({ shopOrderId: orderId }).select("status").all()
			if (freshCards.some(card => isLiveShopCard(card.status) || isSettledShopCard(card.status)))
				throw new HttpError("CONFLICT", "This order already has a card grant")
			const freshAmount = fresh.grantCardCents
			if (freshAmount === null || freshAmount <= 0)
				throw new HttpError("CONFLICT", "This order has no grant card amount")
			return tx.orm.public.HcbShopGrantCard.create({
				amountCents: freshAmount,
				claimedAt: formatDbTimestamp(now),
				email,
				grantCardMerchantIds: overrideMerchantIds ?? fresh.grantCardMerchantIds,
				purpose,
				shopOrderId: orderId,
			})
		})
		.catch(err => {
			if (isUniqueViolation(err)) throw new HttpError("CONFLICT", "This order already has a card grant")
			throw err
		})

	let grant: Awaited<ReturnType<typeof createCardGrant>>
	try {
		grant = await createCardGrant({
			amountCents: claimed.amountCents,
			email,
			instructions: shopGrantCardInstructions(order.orderNumber, order.itemNameSnapshot),
			inviteMessage: shopGrantCardInviteMessage(order.itemNameSnapshot),
			merchantIds: claimed.grantCardMerchantIds,
			purpose,
		})
	} catch (err) {
		return handleCreateFailure(claimed, err, admin, { ip, userAgent }, purpose)
	}

	const responseEmail = grant.email?.trim().toLowerCase()
	const wrongAmount = grant.amountCents !== claimed.amountCents
	const wrongOwner = !responseEmail || responseEmail !== email.trim().toLowerCase()
	const merchantMismatch = merchantMismatchReason(grant, claimed.grantCardMerchantIds)
	if (wrongAmount || wrongOwner || merchantMismatch) {
		// The money has moved. Cancel it if HCB will let us, and never let this look like a clean issue. The grant id
		// stays in the reason so a cancel HCB refused is still findable after the page is reloaded.
		await cancelCardGrant(grant.id).catch(() => undefined)
		const reason = wrongAmount
			? `HCB issued grant ${grant.id} for ${formatUsd(grant.amountCents / 100)} instead of ${formatUsd(claimed.amountCents / 100)}. Check it on HCB before retrying`
			: wrongOwner
				? `HCB reported a different owner for grant ${grant.id}. Cancel it on HCB and check before retrying`
				: (merchantMismatch
					?? `HCB issued grant ${grant.id} without the merchant lock this order asked for. Check it on HCB before retrying`)
		await markAmbiguous(claimed.id, reason)
		return toOutcome({ ...claimed, error: reason, status: HcbGrantCardStatus.AMBIGUOUS })
	}

	await markIssued(claimed, orderId, grant, purpose, admin, { ip, userAgent })
	return toOutcome({ ...claimed, hcbCardGrantId: grant.id, status: HcbGrantCardStatus.ISSUED })
}

/** Decide what a failed create left behind. A 4xx is a refusal; anything else may have committed, so HCB is asked before a retry. */
async function handleCreateFailure(
	claimed: ShopGrantCardRow,
	err: unknown,
	admin: Admin,
	request: RequestInfo,
	expectedPurpose: string,
): Promise<ShopGrantCardOutcome> {
	const status = hcbStatusOf(err)
	const message = messageOf(err)
	if (status !== null && status >= 400 && status < 500) {
		await markFailed(claimed.id, message)
		return toOutcome({ ...claimed, error: message, status: HcbGrantCardStatus.FAILED })
	}

	const list = await listOrganizationCardGrants().catch(() => null)
	if (!list) {
		const reason = `${message}. HCB could not be read afterwards`
		await markAmbiguous(claimed.id, reason)
		return toOutcome({ ...claimed, error: reason, status: HcbGrantCardStatus.AMBIGUOUS })
	}
	const purpose = claimed.purpose ?? expectedPurpose
	const reconciled = reconcileCardGrantIssue(
		list,
		{
			amountCents: claimed.amountCents,
			attemptedAt: parseDbTimestamp(claimed.claimedAt ?? claimed.createdAt),
			email: claimed.email,
			merchantIds: claimed.grantCardMerchantIds,
			purpose,
		},
		await claimedGrantIds(),
	)
	if (reconciled.kind === "landed") {
		const grant = list.kind === "listed" ? list.rows.find(row => row.id === reconciled.grantId) : undefined
		if (grant) {
			await markIssued(claimed, claimed.shopOrderId, grant, purpose, admin, request)
			return toOutcome({ ...claimed, hcbCardGrantId: grant.id, status: HcbGrantCardStatus.ISSUED })
		}
	}
	if (reconciled.kind === "absent") {
		const reason = `${message}. No matching grant landed`
		await markFailed(claimed.id, reason)
		return toOutcome({ ...claimed, error: reason, status: HcbGrantCardStatus.FAILED })
	}
	const reason = `${message}. Check the grant on HCB before retrying`
	await markAmbiguous(claimed.id, reason)
	return toOutcome({ ...claimed, error: reason, status: HcbGrantCardStatus.AMBIGUOUS })
}

/**
 * Re-read an ambiguous or failed attempt against HCB.
 *
 * A pending row is only checkable once its claim is old enough to count as abandoned: otherwise this would race the
 * request that is creating the grant and mark it failed while HCB issues it.
 */
export async function reconcileShopGrantCard(id: string, admin: Admin): Promise<ShopGrantCardOutcome> {
	const row = await db.orm.public.HcbShopGrantCard.whereUnique({ id }).first()
	if (!row) throw new HttpError("NOT_FOUND", "Card grant not found")
	if (
		row.status === HcbGrantCardStatus.ISSUED
		|| row.status === HcbGrantCardStatus.CANCELED
		|| row.status === HcbGrantCardStatus.RETURNED
	)
		return toOutcome(row)

	const cutoff = new Date(Date.now() - ABANDONED_CARD_ATTEMPT_MS)
	const abandoned =
		row.status === HcbGrantCardStatus.PENDING && row.claimedAt !== null && parseDbTimestamp(row.claimedAt) < cutoff
	if (row.status !== HcbGrantCardStatus.AMBIGUOUS && row.status !== HcbGrantCardStatus.FAILED && !abandoned)
		throw new HttpError("CONFLICT", "Only an ambiguous or failed grant can be checked against HCB")

	const order =
		row.purpose === null
			? await db.orm.public.ShopOrder.whereUnique({ id: row.shopOrderId }).select("itemNameSnapshot").first()
			: null
	const purpose = row.purpose ?? shopGrantCardPurpose(order?.itemNameSnapshot ?? "")
	const list = await listOrganizationCardGrants()
	const reconciled = reconcileCardGrantIssue(
		list,
		{
			amountCents: row.amountCents,
			attemptedAt: parseDbTimestamp(row.claimedAt ?? row.createdAt),
			email: row.email,
			merchantIds: row.grantCardMerchantIds,
			purpose,
		},
		await claimedGrantIds(),
	)
	if (reconciled.kind === "landed") {
		const grant = list.kind === "listed" ? list.rows.find(candidate => candidate.id === reconciled.grantId) : undefined
		if (!grant) throw new HttpError("CONFLICT", "HCB named a grant Half Life could not read")
		const { ip, userAgent } = await requestInfo()
		await markIssued(row, row.shopOrderId, grant, purpose, admin, { ip, userAgent })
		return toOutcome({ ...row, hcbCardGrantId: grant.id, status: HcbGrantCardStatus.ISSUED })
	}
	if (reconciled.kind === "absent") {
		const reason = "No matching grant landed. It is safe to retry"
		await markFailed(row.id, reason)
		return toOutcome({ ...row, error: reason, status: HcbGrantCardStatus.FAILED })
	}
	const reason = "More than one matching grant, or HCB could not be read. Check HCB before retrying"
	await markAmbiguous(row.id, reason)
	return toOutcome({ ...row, error: reason, status: HcbGrantCardStatus.AMBIGUOUS })
}

/**
 * Cancel a live grant, returning its remaining balance to the organisation.
 *
 * A cancelled shop card is never reissued automatically: the issue path refuses an order with a cancelled card, so
 * the part the buyer already spent cannot be paid a second time. Deciding what an order is owed after that is a
 * human's call, on the order itself.
 */
export async function cancelShopGrantCard(id: string, admin: Admin): Promise<ShopGrantCardOutcome> {
	const row = await db.orm.public.HcbShopGrantCard.whereUnique({ id }).first()
	if (!row) throw new HttpError("NOT_FOUND", "Card grant not found")
	if (!row.hcbCardGrantId) throw new HttpError("CONFLICT", "This grant has no HCB id to cancel")
	if (row.status === HcbGrantCardStatus.CANCELED) return toOutcome(row)
	if (row.status === HcbGrantCardStatus.RETURNED)
		throw new HttpError("CONFLICT", "The buyer already returned this grant")

	// Read the spend before cancelling: HCB returns the unspent balance to the org, so afterwards there is no way to
	// tell how much of the card was used. A number we cannot read is refused rather than recorded blind, because the
	// refund guard needs it to decide whether the order is safe to refund.
	const spend = await readCardGrantSpend(row.hcbCardGrantId)
	const spentCents =
		spend.spentCents
		?? (spend.amountCents !== null && spend.balanceCents !== null
			? Math.max(0, spend.amountCents - spend.balanceCents)
			: null)
	if (spentCents === null)
		throw new HttpError(
			"CONFLICT",
			"HCB could not say what this card has spent, so cancelling it would leave the order's refund unsafe. Try again once HCB answers.",
		)

	await cancelCardGrant(row.hcbCardGrantId)
	const { ip, userAgent } = await requestInfo()
	const { userId } = await db.orm.public.ShopOrder.whereUnique({ id: row.shopOrderId }).select("userId").firstOrThrow()
	await db.transaction(async tx => {
		await lockUserCredit(tx, userId)
		await tx.orm.public.HcbShopGrantCard.where({ id }).update({
			canceledAt: formatDbTimestamp(new Date()),
			hcbStatus: "canceled",
			spentCents,
			status: HcbGrantCardStatus.CANCELED,
		})
		// Nothing was used, so the buyer had no value from the card and the order is open again: staff or the buyer can then ship, refund or cancel it. A card that was used leaves the order fulfilled, because the buyer already had that value and an admin settles it.
		const reopened =
			spentCents === 0
				? await tx.orm.public.ShopOrder.where({ id: row.shopOrderId, status: ShopOrderStatus.FULFILLED })
						.where(order => order.trackingNumber.isNull())
						.updateAndCount({ fulfilledAt: null, lastActorId: admin.id, status: ShopOrderStatus.PENDING })
				: 0
		await logAuditTx(tx, {
			action: AuditAction.ADMIN_CANCEL_GRANT_CARD,
			actorEmail: admin.email,
			actorId: admin.id,
			ip,
			metadata: {
				amountCents: row.amountCents,
				grantId: row.hcbCardGrantId,
				orderId: row.shopOrderId,
				orderReopened: reopened === 1,
				spentCents,
			},
			targetId: row.shopOrderId,
			targetType: "ShopOrder",
			userAgent,
		})
	})
	return toOutcome({ ...row, status: HcbGrantCardStatus.CANCELED })
}
