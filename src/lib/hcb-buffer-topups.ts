import "server-only"
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

/** HCB's card grant ids carry a `cdg_` prefix; the top-up table stores the bare hashid. Compare on the bare one. */
export const bareGrantId = (id: string): string => id.replace(/^cdg_/, "")

/** The identity of one HCB disbursement, so a re-run cannot record it twice. */
export function bufferTopUpKey(grantId: string, disbursement: GrantDisbursement): string {
	return `${bareGrantId(grantId)}|${disbursement.createdAt ?? ""}|${disbursement.amountCents}|${disbursement.memo ?? ""}`
}

export interface SitePayment {
	amountCents: number
	grantHashid: string
}

/**
 * The disbursements on one grant that are buffer top-ups.
 *
 * A positive top-up whose amount matches a payment Half Life sent into the same grant is that payment, not a buffer top-up, and is skipped. Anything else with the top-up memo counts.
 */
export function selectBufferTopUps(
	disbursements: readonly GrantDisbursement[],
	sitePayments: readonly SitePayment[],
	grantId: string,
): GrantDisbursement[] {
	const bare = bareGrantId(grantId)
	return disbursements.filter(d => {
		if (d.amountCents <= 0) return false
		if (!d.memo?.startsWith(BUFFER_TOPUP_MEMO_PREFIX)) return false
		return !sitePayments.some(
			payment => bareGrantId(payment.grantHashid) === bare && payment.amountCents === d.amountCents,
		)
	})
}

export interface BufferTopUpSyncResult {
	alreadyRecorded: number
	dryRun: boolean
	grantsScanned: number
	recorded: number
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
		.select("amountCents", "grantHashid")
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
	let topUpsFound = 0
	let alreadyRecorded = 0
	for (const grant of list.rows) {
		const read = await listCardGrantDisbursements(grant.id)
		if (read.kind === "unreadable")
			throw new HttpError(
				"INTERNAL",
				`HCB's disbursements for grant ${bareGrantId(grant.id)} could not be read, so nothing was synced`,
			)
		for (const disbursement of selectBufferTopUps(read.rows, sitePayments, grant.id)) {
			topUpsFound++
			const key = bufferTopUpKey(grant.id, disbursement)
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
