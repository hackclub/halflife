import "server-only"
import { HcbGrantCardStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { type GrantDisbursement, listCardGrantDisbursements, listOrganizationCardGrants } from "@/lib/hcb"
import db from "@/lib/prisma8"
import { formatDbTimestamp } from "@/lib/time"

/**
 * Buffer top-ups: money added by hand on HCB straight into an existing card grant, outside Half Life.
 *
 * A buffer top-up never blocks a card and never counts against a maker's entitlement, so nothing pays from it. It is recorded so the reconciler can tell that a grant's HCB amount is bigger than the amount it was issued for. Money Half Life sent itself (`HcbGrantTopUp`) is a payment and is left to that table.
 */

/** HCB's memo for a top-up into a grant. Withdrawals and returns use other memos and are not buffer top-ups. */
export const BUFFER_TOPUP_MEMO_PREFIX = "Topup of grant to "

/** HCB's memo for the balance going back to the organisation, after the grant was cancelled. */
export const GRANT_RETURN_MEMO_PREFIX = "Returning canceled grant to "

/**
 * When a grant's unspent balance went back to the organisation, or null when it did not.
 *
 * The money has left the card, so the card is finished either way. Who cancelled it is HCB's business; the site records that the grant was returned, and that the project has been paid once.
 */
export function grantReturnedAt(disbursements: readonly GrantDisbursement[]): string | null {
	const found = grantReturn(disbursements)
	return found !== null && !found.expired ? (found.disbursement.createdAt ?? null) : null
}

/** HCB's memo for the balance going back to the organisation, after the grant expired. Seen in the sync's report, never acted on. */
export const GRANT_EXPIRY_MEMO_PREFIX = "Returning expired grant to "

export interface GrantReturn {
	disbursement: GrantDisbursement
	/** True when the money came back because the grant expired, not because the maker handed it back. */
	expired: boolean
}

/** HCB's memo for a balance returned without a cancel, as an admin cancelling a grant before it was activated sees it. */
export const GRANT_FUNDS_RETURN_MEMO_PREFIX = "Return of funds from grant to "

/** The status a grant's row takes when the maker themselves handed the balance back. Only a maker's own return is paid. */
export const MAKER_RETURN_STATUS = "canceled by maker"

/**
 * The status a returned grant's row takes. A grant cancelled before activation and a maker's own return are payable.
 * Anything else, such as an admin cancel or a conversion to a reimbursement, keeps HCB's own status and is held.
 */
export function returnHcbStatus(input: {
	grantStatus: string | null
	makerRequested: boolean
	preActivation: boolean
}): string | null {
	if (input.preActivation) return PRE_ACTIVATION_STATUS
	if (input.makerRequested && input.grantStatus === "canceled") return MAKER_RETURN_STATUS
	return input.grantStatus
}

/** The status a grant's row takes when HCB cancelled it before its card was activated, so nothing was ever spent. */
export const PRE_ACTIVATION_STATUS = "canceled before activation"

/** The disbursement that returned a grant's balance under HCB's funds-return memo, or null when there is none. */
export function fundsReturn(disbursements: readonly GrantDisbursement[]): GrantDisbursement | null {
	return (
		disbursements.find(d => d.memo?.startsWith(GRANT_FUNDS_RETURN_MEMO_PREFIX) && typeof d.createdAt === "string")
		?? null
	)
}

/**
 * The disbursement that returned a grant's balance, preferring a hand-back to an expiry. HCB reports the amount
 * unsigned, with the direction only in the memo, so the memo is what tells a return apart.
 */
export function grantReturn(disbursements: readonly GrantDisbursement[]): GrantReturn | null {
	const dated = disbursements.filter(d => typeof d.createdAt === "string")
	const canceled = dated.find(d => d.memo?.startsWith(GRANT_RETURN_MEMO_PREFIX))
	if (canceled) return { disbursement: canceled, expired: false }
	const expired = dated.find(d => d.memo?.startsWith(GRANT_EXPIRY_MEMO_PREFIX))
	return expired ? { disbursement: expired, expired: true } : null
}

export type ReturnedBy = "maker" | "other" | "unknown"

/**
 * The same question as `returnedBy`, asked of HCB's user ids rather than emails. An email is only present when HCB sends
 * one, so this is the check to trust once the ids are seen to match.
 */
export function returnedById(senderId: string | null, ownerId: string | null): ReturnedBy {
	if (senderId === null || ownerId === null) return "unknown"
	return senderId === ownerId ? "maker" : "other"
}

/**
 * HCB's own system account. When a maker returns a grant through HCB, HCB sends the balance back under this account, so a
 * return it sends counts as the maker's. Matched by id: the name "HCB" is not something an account can be trusted to keep.
 */
export const HCB_SYSTEM_USER_ID = "usr_ZBtVvG"

/**
 * Whether a return counts as the maker's: sent from the grant's own account, or from HCB's system account. An admin's own
 * account is neither, so an admin cancel stays held.
 */
export function returnedByMaker(senderId: string | null, ownerId: string | null): boolean {
	if (senderId === HCB_SYSTEM_USER_ID) return true
	return returnedById(senderId, ownerId) === "maker"
}

/**
 * Who asked HCB for the return: the maker themselves, someone else, or HCB did not say. Only the email is compared, so
 * nothing else about the sender is kept.
 */
export function returnedBy(senderEmail: string | null, grantEmail: string | null): ReturnedBy {
	if (senderEmail === null) return "unknown"
	return senderEmail.trim().toLowerCase() === grantEmail?.trim().toLowerCase() ? "maker" : "other"
}

/**
 * A disbursement's kind for the report: its memo without the name after "to" or "from", so "Grant to Ellie" reads as
 * "Grant". Null memos read as "no memo".
 */
export function memoKind(memo: string | null): string {
	if (memo === null) return "no memo"
	return memo.replace(/ (to|from) .*$/, "")
}

/** A canceled grant with no return disbursement. Carries no names or emails. */
export interface CanceledWithoutReturn {
	amountCents: number
	grantId: string
	memoKinds: string[]
}

/** One return HCB shows, for the sync's report. Carries no names or emails. */
export interface ReturnSeen {
	/** HCB's id for who requested the return, and the id of the grant's maker. Internal ids, no names or emails. */
	byId: ReturnedBy
	expired: boolean
	grantId: string
	grantStatus: string | null
	makerId: string | null
	returnedBy: ReturnedBy
	senderId: string | null
}

/** HCB's card grant ids carry a `cdg_` prefix; the top-up table stores the bare hashid. Compare on the bare one. */
export const bareGrantId = (id: string): string => id.replace(/^cdg_/, "")

/** The identity of one HCB disbursement, so a re-run cannot record it twice. */
export function bufferTopUpKey(grantId: string, disbursement: GrantDisbursement, index = 0): string {
	const base = `${bareGrantId(grantId)}|${disbursement.createdAt ?? ""}|${disbursement.amountCents}|${disbursement.memo ?? ""}`
	// Without a time, the transaction id is the stable half of the identity; two rows with neither are
	// indistinguishable by content and used to collapse into one record, so the position keeps them apart.
	if (disbursement.createdAt !== null) return base
	return `${base}|${disbursement.transactionId ?? String(index)}`
}

export interface SitePayment {
	amountCents: number
	grantHashid: string
	/** The HCB transaction the payment landed as. A disbursement sharing it is definitely this payment. */
	transactionId?: string | null
}

/**
 * The disbursements on one grant that are buffer top-ups.
 *
 * A positive top-up that is one of Half Life's own payments is that payment, not a buffer top-up. The pairing is
 * one-to-one: a payment can explain one disbursement, and the rest stay buffer top-ups. Matching by transaction id
 * first is exact; the amount is only a fallback for a payment with no id recorded. Dropping every disbursement that
 * merely matched an amount hid a hand top-up of the same size, and treating a landed-but-unsent payment as a buffer
 * top-up inflated the grant's original amount.
 */
export function selectBufferTopUps(
	disbursements: readonly GrantDisbursement[],
	sitePayments: readonly SitePayment[],
	grantId: string,
): GrantDisbursement[] {
	const bare = bareGrantId(grantId)
	const payments = sitePayments.filter(payment => bareGrantId(payment.grantHashid) === bare)
	const candidates = disbursements.filter(
		d => d.amountCents > 0 && Boolean(d.memo?.startsWith(BUFFER_TOPUP_MEMO_PREFIX)),
	)

	const unmatched = [...candidates]
	const byTransaction = unmatched.filter(d => d.transactionId !== null && d.transactionId !== undefined)
	for (const disbursement of byTransaction) {
		const index = payments.findIndex(payment => payment.transactionId === disbursement.transactionId)
		if (index === -1) continue
		payments.splice(index, 1)
		unmatched.splice(unmatched.indexOf(disbursement), 1)
	}

	// What is left could still be a payment whose id the site never recorded. Pair by amount, one for one.
	for (const disbursement of unmatched.slice()) {
		const index = payments.findIndex(payment => payment.amountCents === disbursement.amountCents)
		if (index === -1) continue
		payments.splice(index, 1)
		unmatched.splice(unmatched.indexOf(disbursement), 1)
	}
	return unmatched
}

/** Card rows that still count as live on our side, so a return HCB shows can be matched to the row that paid it. */
// Returned rows stay in the scan so their HCB status is refreshed: a row returned before the status was stored has none.
const LIVE_CARD_STATUSES = [
	HcbGrantCardStatus.PENDING,
	HcbGrantCardStatus.ISSUED,
	HcbGrantCardStatus.AMBIGUOUS,
	HcbGrantCardStatus.RETURNED,
]

type CardTable = "project" | "shop"

interface LiveCardRef {
	id: string
	table: CardTable
}

/**
 * Record that the maker handed a card back. The money has left the card, so the row is finished either way: it is no
 * longer live, and a returned card is never reissued by the system (both issue paths refuse a settled card).
 */
export async function markCardReturned(
	table: CardTable,
	id: string,
	returnedAt: string,
	hcbStatus: string | null,
): Promise<void> {
	const error = "The maker returned this grant on HCB; its balance went back to the organisation"
	const update = {
		error,
		hcbStatus: hcbStatus ?? "returned",
		status: HcbGrantCardStatus.RETURNED,
	}
	if (table === "shop") {
		await db.orm.public.HcbShopGrantCard.where({ id }).update(update)
		return
	}
	await db.orm.public.HcbGrantCard.where({ id }).update({
		...update,
		returnedAt: formatDbTimestamp(new Date(returnedAt)),
	})
}

/**
 * Whether HCB shows this grant's balance going back to the organisation, read straight off the grant rather than
 * from the last sync. Null when it did not. Throws when HCB's disbursements cannot be read, so the caller can tell
 * "not returned" from "could not check".
 */
export async function returnedAtForGrant(grantHashid: string): Promise<string | null> {
	const read = await listCardGrantDisbursements(grantHashid)
	if (read.kind === "unreadable")
		throw new HttpError("INTERNAL", `HCB's disbursements for grant ${bareGrantId(grantHashid)} could not be read`)
	return grantReturnedAt(read.rows)
}

/**
 * What to do when HCB refuses to cancel a card grant. HCB's refusal does not say why, so the grant is read back: if its
 * disbursements show the maker already handed the balance back, the return is recorded and the caller is told that,
 * and the row stops being live. Any other refusal, or a grant that cannot be read back, is rethrown unchanged.
 */
export async function refuseCancelOrRecordReturn(
	error: unknown,
	table: CardTable,
	id: string,
	grantHashid: string,
): Promise<never> {
	let returnedAt: string | null
	try {
		returnedAt = await returnedAtForGrant(grantHashid)
	} catch {
		throw error
	}
	if (returnedAt === null) throw error
	await markCardReturned(table, id, returnedAt, null)
	throw new HttpError(
		"CONFLICT",
		"The maker already returned this grant on HCB, so it cannot be cancelled. It is now marked returned",
	)
}

/** A project card a live run would mark RETURNED, with the HCB status it would store. A dry run hands these to the coin pass as a preview. */
export interface PendingReturn {
	hcbStatus: string | null
	id: string
}

export interface BufferTopUpSyncResult {
	alreadyRecorded: number
	/** Canceled grants with no return disbursement at all. Only a dry run reports them. */
	canceledWithoutReturn: CanceledWithoutReturn[]
	dryRun: boolean
	/** How many grants HCB reports under each status, so the values a return can take can be read off a live run. */
	grantStatuses: { [_: string]: number }
	grantsScanned: number
	/** The project cards a dry run would mark RETURNED, so the coin pass can preview what a live run pays. Empty on a live run, which writes them first. */
	pendingReturns: PendingReturn[]
	recorded: number
	/** Live project or shop card rows the sync marked RETURNED. */
	returnedMarked: number
	/** Every return HCB shows, with who asked for it. Only a dry run reports them, so a live run keeps its response small. */
	returnsSeen: ReturnSeen[]
	topUpsFound: number
}

/**
 * Read every card grant's disbursements from HCB and record any buffer top-up not already stored.
 *
 * Fails closed: an unreadable grant stops the run before anything is written, so a half-read list can never make a top-up look absent.
 */
export async function syncBufferTopUps(input: { dryRun: boolean }): Promise<BufferTopUpSyncResult> {
	const list = await listOrganizationCardGrants()
	if (list.kind === "unreadable")
		throw new HttpError("INTERNAL", "HCB's card grant list could not be read, so nothing was synced")

	const sitePayments = await db.orm.public.HcbGrantTopUp.where(topUp => topUp.sentAt.isNotNull())
		.select("amountCents", "grantHashid", "transactionId")
		.all()
	const known = new Set(
		(await db.orm.public.HcbBufferTopUp.where({}).select("disbursementKey").all()).map(row => row.disbursementKey),
	)

	const fresh: {
		amountCents: number
		disbursementKey: string
		hcbCardGrantId: string
		hcbCreatedAt: string | null
		memo: string | null
	}[] = []
	// Every card row still counted as live, so a return found on HCB can be matched to the row that paid it. Project and
	// shop cards share one HCB grant space, so one map holds both, each marked with the table its row lives in.
	const liveCards = new Map<string, LiveCardRef>()
	for (const card of await db.orm.public.HcbGrantCard.where({})
		.where(row => row.status.in(LIVE_CARD_STATUSES))
		.select("hcbCardGrantId", "id")
		.all())
		if (card.hcbCardGrantId) liveCards.set(bareGrantId(card.hcbCardGrantId), { id: card.id, table: "project" })
	for (const card of await db.orm.public.HcbShopGrantCard.where({})
		.where(row => row.status.in(LIVE_CARD_STATUSES))
		.select("hcbCardGrantId", "id")
		.all())
		if (card.hcbCardGrantId) liveCards.set(bareGrantId(card.hcbCardGrantId), { id: card.id, table: "shop" })

	let topUpsFound = 0
	let alreadyRecorded = 0
	const returned: { hcbStatus: string | null; id: string; returnedAt: string; table: CardTable }[] = []
	const grantStatuses: { [_: string]: number } = {}
	const returnsSeen: ReturnSeen[] = []
	const canceledWithoutReturn: CanceledWithoutReturn[] = []
	for (const grant of list.rows) {
		const statusKey = grant.status ?? "unreported"
		grantStatuses[statusKey] = (grantStatuses[statusKey] ?? 0) + 1
		const read = await listCardGrantDisbursements(grant.id)
		if (read.kind === "unreadable")
			throw new HttpError(
				"INTERNAL",
				`HCB's disbursements for grant ${bareGrantId(grant.id)} could not be read, so nothing was synced`,
			)
		// A grant cancelled before its card was activated never had a card, so nothing was spent. HCB returns its balance under
		// its own memo, which a hand-back and a conversion never use.
		const beforeActivation = grant.status === "canceled" && grant.cardId === null ? fundsReturn(read.rows) : null
		const found: GrantReturn | null =
			grantReturn(read.rows) ?? (beforeActivation === null ? null : { disbursement: beforeActivation, expired: false })
		const hcbStatus = returnHcbStatus({
			grantStatus: grant.status,
			makerRequested: found !== null && !found.expired && returnedByMaker(found.disbursement.senderId, grant.ownerId),
			preActivation: beforeActivation !== null && found?.disbursement === beforeActivation,
		})
		if (found?.disbursement.createdAt)
			returnsSeen.push({
				byId: returnedById(found.disbursement.senderId, grant.ownerId),
				expired: found.expired,
				grantId: bareGrantId(grant.id),
				grantStatus: grant.status,
				makerId: grant.ownerId,
				returnedBy: returnedBy(found.disbursement.senderEmail, grant.email),
				senderId: found.disbursement.senderId,
			})
		if (found === null && grant.status === "canceled")
			canceledWithoutReturn.push({
				amountCents: grant.amountCents,
				grantId: bareGrantId(grant.id),
				memoKinds: [...new Set(read.rows.map(d => memoKind(d.memo)))],
			})
		const returnedAt = found !== null && !found.expired ? found.disbursement.createdAt : null
		const liveCardId = liveCards.get(bareGrantId(grant.id))
		if (returnedAt !== null && liveCardId)
			returned.push({ hcbStatus, id: liveCardId.id, returnedAt, table: liveCardId.table })
		for (const [index, disbursement] of selectBufferTopUps(read.rows, sitePayments, grant.id).entries()) {
			topUpsFound++
			const key = bufferTopUpKey(grant.id, disbursement, index)
			if (known.has(key)) {
				alreadyRecorded++
				continue
			}
			known.add(key)
			fresh.push({
				amountCents: disbursement.amountCents,
				disbursementKey: key,
				hcbCardGrantId: bareGrantId(grant.id),
				hcbCreatedAt: disbursement.createdAt,
				memo: disbursement.memo,
			})
		}
	}

	if (!input.dryRun && returned.length > 0)
		for (const card of returned) await markCardReturned(card.table, card.id, card.returnedAt, card.hcbStatus)

	if (!input.dryRun && fresh.length > 0)
		await db.orm.public.HcbBufferTopUp.createAll(
			fresh.map(row => ({
				amountCents: row.amountCents,
				disbursementKey: row.disbursementKey,
				hcbCardGrantId: row.hcbCardGrantId,
				hcbCreatedAt: row.hcbCreatedAt === null ? null : formatDbTimestamp(new Date(row.hcbCreatedAt)),
				memo: row.memo,
			})),
		)

	return {
		alreadyRecorded,
		canceledWithoutReturn: input.dryRun ? canceledWithoutReturn : [],
		dryRun: input.dryRun,
		grantStatuses,
		grantsScanned: list.rows.length,
		pendingReturns: input.dryRun
			? returned.filter(r => r.table === "project").map(r => ({ hcbStatus: r.hcbStatus, id: r.id }))
			: [],
		recorded: input.dryRun ? 0 : fresh.length,
		returnedMarked: input.dryRun ? 0 : returned.length,
		returnsSeen: input.dryRun ? returnsSeen : [],
		topUpsFound,
	}
}

/** Recorded buffer top-up cents per HCB grant, keyed by the bare hashid. The reconciler adds these back to a grant's amount before matching it to a CSV row. */
export async function bufferTopUpCentsByGrant(): Promise<Map<string, number>> {
	const totals = new Map<string, number>()
	for (const row of await db.orm.public.HcbBufferTopUp.where({}).select("amountCents", "hcbCardGrantId").all())
		totals.set(row.hcbCardGrantId, (totals.get(row.hcbCardGrantId) ?? 0) + row.amountCents)
	return totals
}
