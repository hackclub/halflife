import { COINS_PER_HOUR } from "@/lib/config/program"

/**
 * What a returned parts card pays, in whole coins.
 *
 * Measured against the tier's funded block, not the card's leftover. Approval already pays only hours past the block whatever the card's size, so a card smaller than the block leaves part of the block unpaid, and this pays that part. Spend beyond the BOM-sized grant came from buffer top-ups, so it does not reduce the block.
 *
 * With nothing spent this equals what declining the funding would have paid, and cents below a whole coin stay with the organisation.
 */
export function grantReturnCoins(input: { amountCents: number; fundingHours: number; spentCents: number }): number {
	const blockCents = input.fundingHours * COINS_PER_HOUR * 100
	const spentFromBlock = Math.min(Math.max(0, input.spentCents), Math.max(0, input.amountCents))
	return Math.floor(Math.max(0, blockCents - spentFromBlock) / 100)
}
