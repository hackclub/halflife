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
	// HCB reports the amount unsigned, with the direction only in the memo, so the memo is what tells a return apart.
	const returned = disbursements.find(
		d => d.memo?.startsWith(GRANT_RETURN_MEMO_PREFIX) && typeof d.createdAt === "string",
	)
	return returned?.createdAt ?? null
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
const LIVE_CARD_STATUSES = [HcbGrantCardStatus.PENDING, HcbGrantCardStatus.ISSUED, HcbGrantCardStatus.AMBIGUOUS]

type CardTable = "project" | "shop"

interface LiveCardRef {
	id: string
	table: CardTable
}

/**
 * Record that the maker handed a card back. The money has left the card, so the row is finished either way: it is no
 * longer live, and a returned card is never reissued by the system (both issue paths refuse a settled card).
 */
export async function markCardReturned(table: CardTable, id: string, returnedAt: string): Promise<void> {
	const error = "The maker returned this grant on HCB; its balance went back to the organisation"
	const update = {
		error,
		hcbStatus: "returned",
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
	await markCardReturned(table, id, returnedAt)
	throw new HttpError(
		"CONFLICT",
		"The maker already returned this grant on HCB, so it cannot be cancelled. It is now marked returned",
	)
}

export interface BufferTopUpSyncResult {
	alreadyRecorded: number
	dryRun: boolean
	grantsScanned: number
	recorded: number
	/** Live project or shop card rows the sync marked RETURNED. */
	returnedMarked: number
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
	const returned: { id: string; returnedAt: string; table: CardTable }[] = []
	for (const grant of list.rows) {
		const read = await listCardGrantDisbursements(grant.id)
		if (read.kind === "unreadable")
			throw new HttpError(
				"INTERNAL",
				`HCB's disbursements for grant ${bareGrantId(grant.id)} could not be read, so nothing was synced`,
			)
		const returnedAt = grantReturnedAt(read.rows)
		const liveCardId = liveCards.get(bareGrantId(grant.id))
		if (returnedAt !== null && liveCardId) returned.push({ id: liveCardId.id, returnedAt, table: liveCardId.table })
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
		for (const card of returned) await markCardReturned(card.table, card.id, card.returnedAt)

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
		dryRun: input.dryRun,
		grantsScanned: list.rows.length,
		recorded: input.dryRun ? 0 : fresh.length,
		returnedMarked: input.dryRun ? 0 : returned.length,
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
