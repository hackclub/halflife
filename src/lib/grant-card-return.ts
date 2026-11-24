import { COINS_PER_HOUR } from "@/lib/config/program"

export interface GrantReturnInput {
	amountCents: number
	fundingHours: number
	spentCents: number
}

export interface GrantReturnBreakdown {
	/** The tier's funded block, in cents. */
	blockCents: number
	/** Whole coins paid, floored. */
	coins: number
	/** Cents of the block that were not paid, because a return pays whole coins only. */
	leftoverCents: number
	/** Spend that counts against the block, in cents. */
	spentFromBlockCents: number
}

/**
 * How a returned parts card's coins are worked out, step by step, for the ledger note and the tests.
 *
 * Measured against the tier's funded block, not the card's leftover. Approval already pays only hours past the block whatever the card's size, so a card smaller than the block leaves part of the block unpaid, and this pays that part. Spend beyond the BOM-sized grant came from buffer top-ups, so it does not reduce the block.
 */
export function grantReturnBreakdown(input: GrantReturnInput): GrantReturnBreakdown {
	const blockCents = input.fundingHours * COINS_PER_HOUR * 100
	const spentFromBlockCents = Math.min(Math.max(0, input.spentCents), Math.max(0, input.amountCents))
	const unpaidCents = Math.max(0, blockCents - spentFromBlockCents)
	return {
		blockCents,
		coins: Math.floor(unpaidCents / 100),
		leftoverCents: unpaidCents % 100,
		spentFromBlockCents,
	}
}

/** What a returned parts card pays, in whole coins. With nothing spent this equals what declining the funding would have paid. */
export const grantReturnCoins = (input: GrantReturnInput): number => grantReturnBreakdown(input).coins

/**
 * Whether a return was cancelled by the maker themselves. Both identities must be known and match, ignoring case; an unknown canceller is never treated as the maker.
 */
export function isMakerCancel(canceledByEmail: string | null, makerEmail: string | null): boolean {
	if (canceledByEmail === null || makerEmail === null) return false
	return canceledByEmail.trim().toLowerCase() === makerEmail.trim().toLowerCase()
}

export type ReturnCreditDecision = "credit" | "held" | "already"

/**
 * Whether a returned card's coins should be paid now.
 *
 * A return already credited is never paid again. A return the maker did not cancel is held: recorded, uncredited, and left for a later sync to retry once its canceller is known.
 */
export function returnCreditDecision(input: {
	alreadyCredited: boolean
	canceledByEmail: string | null
	makerEmail: string | null
}): ReturnCreditDecision {
	if (input.alreadyCredited) return "already"
	return isMakerCancel(input.canceledByEmail, input.makerEmail) ? "credit" : "held"
}
