import { describe, expect, test } from "bun:test"
import {
	isKitCountry,
	KIT_PCB_CARD_USD,
	paidSoFarUsd,
	STARTER_KIT_STATUS,
	type StarterFundingInput,
	starterFundingFor,
	starterPartsCapUsd,
} from "@/lib/starter-funding"

const deadline = new Date("2026-11-14T00:00:00Z")
const beforeDeadline = new Date("2026-11-12T12:00:00Z")
const afterDeadline = new Date("2026-11-15T12:00:00Z")

function row(overrides: Partial<StarterFundingInput> = {}): StarterFundingInput {
	return {
		approved: true,
		bomTotalUsd: 29.9,
		country: "GB",
		fundingGivenUsd: 0,
		kitOfferDeadline: deadline,
		kitStatus: null,
		now: beforeDeadline,
		submitted: true,
		tier: 1,
		...overrides,
	}
}

describe("starter funding routing", () => {
	test("a kit country with nothing bought gets a kit and the PCB card", () => {
		const out = starterFundingFor(row({ bomTotalUsd: 40, country: "US" }))
		expect(out.fulfilment).toBe("KIT_WITH_PCB_CARD")
		expect(out.cardUsd).toBe(KIT_PCB_CARD_USD)
		expect(out.owedUsd).toBe(10)
	})

	test("the PCB card is only owed for what is still unpaid", () => {
		expect(starterFundingFor(row({ country: "CA", fundingGivenUsd: 10 })).owedUsd).toBe(0)
		expect(starterFundingFor(row({ country: "MX", fundingGivenUsd: 4 })).owedUsd).toBe(6)
	})

	test("a maker who bought only a PCB gets a kit and no card", () => {
		const out = starterFundingFor(row({ country: "US", kitStatus: STARTER_KIT_STATUS.pcbOnlySendKit }))
		expect(out.fulfilment).toBe("KIT_ONLY")
		expect(out.cardUsd).toBe(0)
		expect(out.owedUsd).toBe(0)
	})

	test("a maker who cancelled their parts order gets a kit and no card, because the PCB was ordered separately", () => {
		const out = starterFundingFor(row({ country: "CA", kitStatus: STARTER_KIT_STATUS.cancelledPartsSendKit }))
		expect(out.fulfilment).toBe("KIT_ONLY")
		expect(out.owedUsd).toBe(0)
	})

	test("a maker who hasn't replied waits until the deadline", () => {
		const out = starterFundingFor(row({ country: "CA", kitStatus: STARTER_KIT_STATUS.noResponse }))
		expect(out.fulfilment).toBe("WAIT")
		expect(out.owedUsd).toBe(0)
	})

	test("a maker who hasn't replied by the deadline is flagged for the operator to expire", () => {
		const out = starterFundingFor(row({ country: "CA", kitStatus: STARTER_KIT_STATUS.noResponse, now: afterDeadline }))
		expect(out.fulfilment).toBe("FLAG")
		expect(out.reason).toContain("expired")
	})

	test("declined, expired and don't-offer-kit makers get nothing more", () => {
		for (const kitStatus of [
			STARTER_KIT_STATUS.declined,
			STARTER_KIT_STATUS.expired,
			STARTER_KIT_STATUS.dontOfferKit,
		]) {
			const out = starterFundingFor(row({ country: "US", kitStatus }))
			expect(out.fulfilment).toBe("NONE")
			expect(out.owedUsd).toBe(0)
		}
	})

	test("a maker outside the kit countries gets one parts card, capped at $33", () => {
		const cheap = starterFundingFor(row({ bomTotalUsd: 29.9, country: "GB" }))
		expect(cheap.fulfilment).toBe("PARTS_CARD")
		expect(cheap.cardUsd).toBe(29.9)
		expect(cheap.owedUsd).toBe(29.9)

		const dear = starterFundingFor(row({ bomTotalUsd: 40, country: "GB" }))
		expect(dear.cardUsd).toBe(33)
		expect(dear.owedUsd).toBe(33)
	})

	test("the parts card is reduced by anything already sent", () => {
		expect(starterFundingFor(row({ bomTotalUsd: 29.9, country: "GB", fundingGivenUsd: 29.9 })).owedUsd).toBe(0)
		expect(starterFundingFor(row({ bomTotalUsd: 40, country: "AE", fundingGivenUsd: 20 })).owedUsd).toBe(13)
	})

	test("the UAE gets a parts card, since it isn't a kit country", () => {
		expect(starterFundingFor(row({ country: "AE" })).fulfilment).toBe("PARTS_CARD")
	})

	test("a kit status outside the kit countries is flagged, never paid", () => {
		const out = starterFundingFor(row({ country: "GB", kitStatus: STARTER_KIT_STATUS.pcbOnlySendKit }))
		expect(out.fulfilment).toBe("FLAG")
		expect(out.owedUsd).toBe(0)
	})
})

describe("starter funding guards", () => {
	test("an unapproved design is not owed anything", () => {
		expect(starterFundingFor(row({ approved: false })).fulfilment).toBe("NONE")
	})

	test("a row that never reached the unified database is held, not paid", () => {
		const out = starterFundingFor(row({ submitted: false }))
		expect(out.fulfilment).toBe("HOLD")
		expect(out.owedUsd).toBe(0)
	})

	test("a project that is not Tier 1 is flagged", () => {
		expect(starterFundingFor(row({ tier: 2 })).fulfilment).toBe("FLAG")
		expect(starterFundingFor(row({ tier: null })).fulfilment).toBe("FLAG")
	})

	test("a missing or malformed country is flagged", () => {
		expect(starterFundingFor(row({ country: null })).fulfilment).toBe("FLAG")
		expect(starterFundingFor(row({ country: "USA" })).fulfilment).toBe("FLAG")
		expect(starterFundingFor(row({ country: "us" })).fulfilment).toBe("FLAG")
	})

	test("an unknown kit status is flagged", () => {
		expect(starterFundingFor(row({ country: "US", kitStatus: "something else" })).fulfilment).toBe("FLAG")
	})

	test("a zero BOM is flagged rather than paying nothing silently", () => {
		expect(starterFundingFor(row({ bomTotalUsd: 0, country: "GB" })).fulfilment).toBe("FLAG")
	})
})

describe("starter funding helpers", () => {
	test("the kit countries are the US, Canada and Mexico only", () => {
		expect(isKitCountry("US")).toBe(true)
		expect(isKitCountry("CA")).toBe(true)
		expect(isKitCountry("MX")).toBe(true)
		expect(isKitCountry("AE")).toBe(false)
		expect(isKitCountry("GB")).toBe(false)
	})

	test("the parts cap is the Tier 1 grant plus the BOM margin", () => {
		expect(starterPartsCapUsd()).toBe(33)
	})
})

describe("money already paid", () => {
	test("the operator's record and the recorded card are not added together", () => {
		expect(paidSoFarUsd(10, 10)).toBe(10)
	})

	test("a recorded card counts when the operator has not entered one", () => {
		expect(paidSoFarUsd(0, 33)).toBe(33)
	})

	test("an operator total above the card wins, so a top-up is not lost", () => {
		expect(paidSoFarUsd(40, 33)).toBe(40)
	})

	test("nothing recorded and nothing entered is nothing paid", () => {
		expect(paidSoFarUsd(0, null)).toBe(0)
	})
})
