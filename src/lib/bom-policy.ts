/**
 * What a parts list asks against the tier being asked for, and when that turns into partial funding.
 *
 * One module for a rule that is read in three places that must not disagree: the BOM editor on the project page, the submit sheet, and the gate in `submitPhase`. The last of those only started enforcing this at all once partial funding became allowed – until then the margin was a client-side `canAdvance`, which meant the one number the maker picked a tier against was a number nothing held them to.
 *
 * It says nothing about how much a grant pays. A design's funding is the tier's flat `grantUsd` and always was; what this decides is whether a cart that outruns it can still be handed in, and what the maker has to be told before they do.
 */

import { round2 } from "@/lib/money"

/** A BOM line as far as the money is concerned – what both the database rows and the API's own type satisfy. */
export interface PricedLine {
	quantity: number
	unitCostUsd: number
}

/**
 * What the list costs, tax and shipping included: a cart charges those once for the order rather than per part.
 *
 * Rounded to the cent here, because this is the number shown to the maker, frozen as what they agreed to, and compared against the tier – and a sum of unit costs lands somewhere like $0.999999, which each of those three would then have to round again to agree.
 */
export function bomTotalUsd(items: readonly PricedLine[], taxShippingUsd: number | null | undefined): number {
	return round2(items.reduce((n, l) => n + l.quantity * l.unitCostUsd, 0) + (taxShippingUsd ?? 0))
}

/**
 * How far past a tier's funding a cart may run before handing it in means partial funding and has to be agreed to. Within it, an over-budget cart is a warning and nothing more.
 */
export const BOM_MARGIN_USD = 3

export interface PartsFunding {
	/** What the parts list costs. */
	totalUsd: number
	/** What the tier funds. This is the whole grant, not a share of one. */
	capUsd: number
	/** What the maker pays out of their own pocket. Zero unless the list is over. */
	shortfallUsd: number
	/**
	 * Past the margin, so submitting it means accepting a grant that covers only part of the cart. Handing one in without agreeing to that is refused, because "I will cover the rest myself" is something the maker has to say rather than something we assume.
	 */
	needsAgreement: boolean
}

/** The rule, in one place: a cart against a tier's grant. */
export function partsFunding(totalUsd: number, capUsd: number): PartsFunding {
	const shortfallUsd = Math.max(0, round2(totalUsd - capUsd))
	return { totalUsd, capUsd, shortfallUsd, needsAgreement: shortfallUsd > BOM_MARGIN_USD }
}
