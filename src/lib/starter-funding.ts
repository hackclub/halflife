import { BOM_MARGIN_USD } from "@/lib/bom-policy"
import { getTier } from "@/lib/config/tiers"
import { round2 } from "@/lib/money"

/**
 * What each Week 1 starter (Starbie) is owed now, from the operator's Airtable record and the verified address.
 *
 * Pure, so the routing can be tested without Airtable, HCB or the database. The export reads the rows and calls this for each one. Nothing here decides a payment on its own: an unknown value is flagged, never guessed at.
 */

/** The countries a kit can be shipped to. Anywhere else gets a parts card instead. */
export const KIT_COUNTRIES: readonly string[] = Object.freeze(["US", "CA", "MX"])

/** Starbie is Tier 1, so its parts card is capped at the Tier 1 grant plus the BOM margin. */
export const STARTER_TIER_ID = 1

/** The PCB card a kit recipient is owed, in USD. The kit itself doesn't include the PCB. */
export const KIT_PCB_CARD_USD = 10

/** The `Kit status` options, exactly as they appear on the Airtable single select. */
export const STARTER_KIT_STATUS = Object.freeze({
	cancelledPartsSendKit: "Cancelled parts order, send kit",
	declined: "Ordered parts, declined kit",
	dontOfferKit: "Ordered parts, don't offer kit",
	expired: "Ordered parts, kit offer expired",
	noResponse: "Ordered parts, no response to kit offer yet",
	pcbOnlySendKit: "Ordered PCB only, send kit",
} as const)

export type StarterKitStatus = (typeof STARTER_KIT_STATUS)[keyof typeof STARTER_KIT_STATUS]

export type StarterFulfilment = "KIT_WITH_PCB_CARD" | "KIT_ONLY" | "PARTS_CARD" | "WAIT" | "NONE" | "HOLD" | "FLAG"

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
	/** The verified address country, as a capital two-letter code. Null when there is no verified address. */
	country: string | null
	/** The total that has already left HCB for this maker, in USD. */
	fundingGivenUsd: number
	/** When the kit offer closes for this maker. Past it, a no-response maker is flagged for the operator to expire. */
	kitOfferDeadline: Date
	/** The Airtable `Kit status`. Null when blank, which means nothing has been bought. */
	kitStatus: string | null
	now: Date
	/** True when the row is in the unified database (`Automation - Status` is submitted). */
	submitted: boolean
	tier: number | null
}

const KIT_STATUSES: readonly string[] = Object.values(STARTER_KIT_STATUS)

function isStarterKitStatus(value: string): value is StarterKitStatus {
	return KIT_STATUSES.includes(value)
}

/** Whether a kit can be shipped to this country. */
export function isKitCountry(country: string): boolean {
	return KIT_COUNTRIES.includes(country)
}

/** The most a parts card may pay: the Tier 1 grant plus the BOM margin, so $33. */
export function starterPartsCapUsd(): number {
	return (getTier(STARTER_TIER_ID)?.grantUsd ?? 0) + BOM_MARGIN_USD
}

function result(fulfilment: StarterFulfilment, cardUsd: number, owedUsd: number, reason: string): StarterFunding {
	return { cardUsd, fulfilment, owedUsd, reason }
}

function flag(reason: string): StarterFunding {
	return result("FLAG", 0, 0, reason)
}

function owedAfter(cardUsd: number, fundingGivenUsd: number): number {
	return Math.max(0, round2(cardUsd - fundingGivenUsd))
}

function kitWithPcbCard(input: StarterFundingInput): StarterFunding {
	return result(
		"KIT_WITH_PCB_CARD",
		KIT_PCB_CARD_USD,
		owedAfter(KIT_PCB_CARD_USD, input.fundingGivenUsd),
		"kit, and a PCB card",
	)
}

function partsCard(input: StarterFundingInput): StarterFunding {
	if (input.bomTotalUsd <= 0) return flag("BOM total is zero")
	const cardUsd = round2(Math.min(input.bomTotalUsd, starterPartsCapUsd()))
	return result(
		"PARTS_CARD",
		cardUsd,
		owedAfter(cardUsd, input.fundingGivenUsd),
		"parts card, capped at the tier maximum",
	)
}

function routeBlank(input: StarterFundingInput, country: string): StarterFunding {
	return isKitCountry(country) ? kitWithPcbCard(input) : partsCard(input)
}

function routeKitStatus(input: StarterFundingInput, country: string, status: StarterKitStatus): StarterFunding {
	const inKitCountry = isKitCountry(country)
	switch (status) {
		case STARTER_KIT_STATUS.dontOfferKit:
		case STARTER_KIT_STATUS.declined:
		case STARTER_KIT_STATUS.expired:
			return result("NONE", 0, 0, "nothing more is owed")
		case STARTER_KIT_STATUS.noResponse:
			if (!inKitCountry) return flag("a kit offer outside the kit countries")
			if (input.now < input.kitOfferDeadline) return result("WAIT", 0, 0, "waiting for a reply to the kit offer")
			return flag("the kit offer deadline has passed; set the status to expired")
		case STARTER_KIT_STATUS.pcbOnlySendKit:
		case STARTER_KIT_STATUS.cancelledPartsSendKit:
			if (!inKitCountry) return flag("a kit status outside the kit countries")
			return result("KIT_ONLY", 0, 0, "kit only; they already have the PCB")
	}
}

/** The one place the routing is decided. Every row of the routing table has a branch here, and anything else is flagged. */
export function starterFundingFor(input: StarterFundingInput): StarterFunding {
	if (!input.approved) return result("NONE", 0, 0, "design is not approved")
	if (!input.submitted) return result("HOLD", 0, 0, "not in the unified database yet")
	if (input.tier !== STARTER_TIER_ID) return flag("project is not Tier 1")
	if (input.country === null) return flag("no verified address country")
	if (!/^[A-Z]{2}$/.test(input.country)) return flag(`country is not a two-letter code: ${input.country}`)
	if (input.kitStatus === null) return routeBlank(input, input.country)
	if (!isStarterKitStatus(input.kitStatus)) return flag(`unknown kit status: ${input.kitStatus}`)
	return routeKitStatus(input, input.country, input.kitStatus)
}

/**
 * What has already left HCB for a maker, in USD: the operator's `Funding given` or the live card recorded for the project, whichever is larger.
 *
 * The two can describe the same card, and the operator often enters the card amount in `Funding given` after the import, so they are never added together. A top-up or reimbursement the operator records as a total is larger than the card, so it wins.
 */
export function paidSoFarUsd(fundingGivenUsd: number, recordedCardUsd: number | null): number {
	return Math.max(fundingGivenUsd, recordedCardUsd ?? 0)
}
