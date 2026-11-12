import { BOM_MARGIN_USD } from "@/lib/bom-policy"
import { getTier } from "@/lib/config/tiers"
import { round2 } from "@/lib/money"

/**
 * What each Week 1 starter (Starbie) is owed: one parts + PCB grant at the target, for every starter that is in the unified database.
 *
 * Pure, so the routing can be tested without Airtable, HCB or the database. The export reads the rows and calls this for each one. Nothing here decides a payment on its own: an unknown value is flagged, never guessed at.
 *
 * Kits are not offered any more, so the country a maker lives in does not change what they are owed.
 */

/** Starbie is Tier 1, so its grant is capped at the Tier 1 grant plus the BOM margin. */
export const STARTER_TIER_ID = 1

/** The `Kit status` options, exactly as they appear on the Airtable single select. */
export const STARTER_KIT_STATUS = Object.freeze({
	cancelledPartsSendKit: "Cancelled parts order, send kit",
	declined: "Ordered parts, declined kit",
	dontOfferKit: "Ordered parts, don't offer kit",
	expired: "Ordered parts, kit offer expired",
	noResponse: "Ordered parts, no response to kit offer yet",
	pcbOnlySendKit: "Ordered PCB only, send kit",
} as const)

/** Statuses that mean nothing more is owed, whatever the maker bought. */
const NOTHING_MORE_STATUSES: readonly string[] = Object.freeze([
	STARTER_KIT_STATUS.declined,
	STARTER_KIT_STATUS.dontOfferKit,
	STARTER_KIT_STATUS.expired,
])

const KIT_STATUSES: readonly string[] = Object.values(STARTER_KIT_STATUS)

export type StarterFulfilment = "PARTS_CARD" | "NONE" | "HOLD" | "FLAG"

export interface StarterFunding {
	/** The card amount this maker is entitled to in total, in USD. Zero when no card is owed. */
	cardUsd: number
	fulfilment: StarterFulfilment
	/** What is still to send: `cardUsd` less what has already left HCB, never below zero. */
	owedUsd: number
	reason: string
}

export interface StarterFundingInput {
	approved: boolean
	bomTotalUsd: number
	/** The total that has already left HCB for this maker, in USD. */
	fundingGivenUsd: number
	/** The Airtable `Kit status`. Null when blank. Only the "nothing more" statuses change the answer. */
	kitStatus: string | null
	/** True when the row is in the unified database (`Automation - Status` is submitted). */
	submitted: boolean
	tier: number | null
}

/** The most a starter's parts + PCB grant may pay: the Tier 1 grant plus the BOM margin, so $33. */
export function starterPartsCapUsd(): number {
	return (getTier(STARTER_TIER_ID)?.grantUsd ?? 0) + BOM_MARGIN_USD
}

function result(fulfilment: StarterFulfilment, cardUsd: number, owedUsd: number, reason: string): StarterFunding {
	return { cardUsd, fulfilment, owedUsd, reason }
}

function flag(reason: string): StarterFunding {
	return result("FLAG", 0, 0, reason)
}

/**
 * The one place the routing is decided. Every condition is checked in order, and anything not covered is flagged.
 *
 * A starter that is not yet in the unified database is held, not paid: the grant waits until it is.
 */
export function starterFundingFor(input: StarterFundingInput): StarterFunding {
	if (!input.approved) return result("NONE", 0, 0, "design is not approved")
	if (!input.submitted) return result("HOLD", 0, 0, "not in the unified database yet")
	if (input.tier !== STARTER_TIER_ID) return flag("project is not Tier 1")
	if (input.kitStatus !== null && !KIT_STATUSES.includes(input.kitStatus))
		return flag(`unknown kit status: ${input.kitStatus}`)
	if (input.kitStatus !== null && NOTHING_MORE_STATUSES.includes(input.kitStatus))
		return result("NONE", 0, 0, "nothing more is owed")
	if (input.bomTotalUsd <= 0) return flag("BOM total is zero")

	const cardUsd = round2(Math.min(input.bomTotalUsd, starterPartsCapUsd()))
	const owedUsd = Math.max(0, round2(cardUsd - input.fundingGivenUsd))
	if (owedUsd === 0) return result("NONE", cardUsd, 0, "already at the target")
	return result("PARTS_CARD", cardUsd, owedUsd, "parts + PCB card, capped at the tier maximum")
}

/** The PATCH body that sets `Funding given` on one design row. Rounded to cents, so Airtable gets the same figure the site recorded. */
export function fundingGivenPatch(recordId: string, fieldName: string, totalUsd: number): string {
	return JSON.stringify({
		records: [{ fields: { [fieldName]: Math.round(totalUsd * 100) / 100 }, id: recordId }],
		typecast: false,
	})
}

/**
 * Whether an amount still owed is a new card or a top-up. A live card recorded on the site means a top-up. No live card means a new card, even when money has already gone out for something else, such as a PCB bought on a cancelled grant.
 */
export function starterAction(owedUsd: number, recordedCardUsd: number | null): "NEW_CARD" | "TOP_UP" | null {
	if (owedUsd <= 0) return null
	return recordedCardUsd === null ? "NEW_CARD" : "TOP_UP"
}

/**
 * What has already left HCB for a maker, in USD: the operator's `Funding given` or the live card recorded for the project, whichever is larger.
 *
 * The two can describe the same card, and the operator often enters the card amount in `Funding given` after the import, so they are never added together. A top-up the operator records as a total is larger than the card, so it wins.
 */
export function paidSoFarUsd(fundingGivenUsd: number, recordedCardUsd: number | null): number {
	return Math.max(fundingGivenUsd, recordedCardUsd ?? 0)
}
