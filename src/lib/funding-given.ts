import { round2 } from "@/lib/money"

/**
 * What each project's Airtable `Funding given` should say, from the payments the site can see.
 *
 * The field used to be written by the YSWS pipeline, so once payouts moved to HCB nothing wrote it for a project that was not a Week 1 starter. This works the total out from the payment records instead, and never lowers a value a person has already set.
 */

export interface PaidSourcesCents {
	/** A top-up made by hand on HCB into one of this project's grants. */
	bufferCents: number
	/** A card grant the maker kept: issued or awaiting reconciliation. A card they returned or that was cancelled is not counted, because the money came back. */
	cardCents: number
	/** A live HCB CSV import row, which is a card Half Life sent the file for. */
	exportCents: number
	/** A top-up Half Life sent through the site. */
	topUpCents: number
}

/**
 * The total paid to one project, in cents.
 *
 * The sources overlap: an export row and a card row can be two records of one payment, and a top-up can land on a card
 * that is already counted. Taking the largest source rather than their sum keeps one payment from being counted twice.
 */
export function paidCentsFromSources(sources: PaidSourcesCents): number {
	return Math.max(sources.cardCents, sources.exportCents, sources.topUpCents, sources.bufferCents)
}

/** The value to write: what was paid, in USD, or the value already there when that is higher. The field never goes down. */
export function fundingGivenTargetUsd(currentUsd: number, paidCents: number): number {
	return Math.max(round2(currentUsd), round2(paidCents / 100))
}
