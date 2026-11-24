import "server-only"
import { getTier } from "@/lib/config/tiers"
import { appendLedgerEntry, lockUserCredit } from "@/lib/currency"
import { HcbGrantCardStatus, LedgerKind } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { grantReturnBreakdown, returnCreditDecision } from "@/lib/grant-card-return"
import { readCardGrantSpend } from "@/lib/hcb"
import db from "@/lib/prisma8"
import { formatDbTimestamp } from "@/lib/time"

export type ReturnCreditOutcome = "credited" | "held" | "already" | "unpriced"

export interface ReturnCreditTally {
	credited: number
	held: number
	unpriced: number
}

/**
 * Pay the coins a returned parts card is worth to its maker, if the maker cancelled it and its spend can be read.
 *
 * Only a return the maker cancelled is credited (see `returnCreditDecision`). A return that cannot be priced because HCB did not report its spend stays uncredited, so the next sync retries it. The ledger row and the card's `coinsCreditedAt` are written in one transaction under the maker's credit lock.
 */
export async function creditReturnedGrantCard(
	cardId: string,
	canceledByEmail: string | null,
): Promise<ReturnCreditOutcome> {
	const card = await db.orm.public.HcbGrantCard.whereUnique({ id: cardId })
		.select("amountCents", "coinsCreditedAt", "email", "hcbCardGrantId", "themeProjectId", "userId")
		.include("themeProject", project => project.select("tier", "title"))
		.first()
	if (!card) throw new HttpError("NOT_FOUND", "That grant card does not exist")

	const decision = returnCreditDecision({
		alreadyCredited: card.coinsCreditedAt !== null,
		canceledByEmail,
		makerEmail: card.email,
	})
	if (decision === "already") return "already"
	if (decision === "held") return "held"

	const tier = getTier(card.themeProject?.tier ?? 0)
	if (!tier || !card.hcbCardGrantId) return "unpriced"
	const spend = await readCardGrantSpend(card.hcbCardGrantId)
	if (spend.spentCents === null) return "unpriced"

	const breakdown = grantReturnBreakdown({
		amountCents: card.amountCents,
		fundingHours: tier.fundingHours,
		spentCents: spend.spentCents,
	})
	const outcome = await writeReturnCredit({
		cardId,
		coins: breakdown.coins,
		leftoverCents: breakdown.leftoverCents,
		projectId: card.themeProjectId,
		title: card.themeProject?.title ?? "your project",
		unpaidCents: breakdown.blockCents - breakdown.spentFromBlockCents,
		userId: card.userId,
	})
	return outcome
}

export interface ReturnCreditWrite {
	cardId: string
	coins: number
	leftoverCents: number
	projectId: string
	title: string
	/** The part of the funded block that was not spent on parts, in cents. */
	unpaidCents: number
	userId: string
}

/**
 * Record a return's coins: one ledger row (when there are any) and the card's credit stamp, in one transaction under the maker's credit lock.
 *
 * Idempotent. A card already stamped is left alone. A project whose return was already credited on another card pays nothing more here, and this card is stamped with 0 so the sync stops retrying it.
 */
export function writeReturnCredit(write: ReturnCreditWrite): Promise<"credited" | "already"> {
	return db.transaction(async tx => {
		await lockUserCredit(tx, write.userId)
		const fresh = await tx.orm.public.HcbGrantCard.whereUnique({ id: write.cardId })
			.select("coinsCreditedAt")
			.firstOrThrow()
		if (fresh.coinsCreditedAt !== null) return "already"

		const projectPaid = await tx.orm.public.LedgerEntry.where({
			kind: LedgerKind.GRANT_CARD_RETURN,
			themeProjectId: write.projectId,
		})
			.select("id")
			.all()
		const credited = projectPaid.length === 0
		if (credited && write.coins > 0)
			await appendLedgerEntry(tx, {
				amount: write.coins,
				kind: LedgerKind.GRANT_CARD_RETURN,
				note: returnNote(write.title, write.unpaidCents, write.coins, write.leftoverCents),
				themeProjectId: write.projectId,
				userId: write.userId,
			})
		await tx.orm.public.HcbGrantCard.where({ id: write.cardId }).update({
			coinsCreditedAt: formatDbTimestamp(new Date()),
			returnCoins: credited ? write.coins : 0,
		})
		return credited ? "credited" : "already"
	})
}

const returnNote = (title: string, unpaidCents: number, coins: number, leftoverCents: number): string =>
	`Returned parts card on ${title}: $${(unpaidCents / 100).toFixed(2)} of the funded block was not spent on parts, so it pays ${coins} coins (${leftoverCents}¢ left over)`

/**
 * Credit every return the sync has not yet paid, and count the outcomes.
 *
 * HCB's "Canceled by" field is not verified yet (see docs/GRANT_CARDS.md), so no canceller is passed: every return is held and nothing is paid until that is confirmed.
 */
export async function creditPendingReturns(): Promise<ReturnCreditTally> {
	const tally: ReturnCreditTally = { credited: 0, held: 0, unpriced: 0 }
	const pending = await db.orm.public.HcbGrantCard.where({ coinsCreditedAt: null, status: HcbGrantCardStatus.RETURNED })
		.select("id")
		.all()
	for (const card of pending) {
		const outcome = await creditReturnedGrantCard(card.id, null)
		if (outcome === "credited") tally.credited++
		if (outcome === "held") tally.held++
		if (outcome === "unpriced") tally.unpriced++
	}
	return tally
}
