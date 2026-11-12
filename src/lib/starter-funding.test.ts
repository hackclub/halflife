import { describe, expect, test } from "bun:test"
import {
	paidSoFarUsd,
	STARTER_KIT_STATUS,
	type StarterFundingInput,
	starterAction,
	starterFundingFor,
	starterPartsCapUsd,
} from "@/lib/starter-funding"

function row(overrides: Partial<StarterFundingInput> = {}): StarterFundingInput {
	return {
		approved: true,
		bomTotalUsd: 29.9,
		fundingGivenUsd: 0,
		kitStatus: null,
		submitted: true,
		tier: 1,
		...overrides,
	}
}

describe("starter funding routing", () => {
	test("the parts + PCB card is capped at the Tier 1 maximum, $33", () => {
		expect(starterPartsCapUsd()).toBe(33)
		const out = starterFundingFor(row({ bomTotalUsd: 40 }))
		expect(out.fulfilment).toBe("PARTS_CARD")
		expect(out.cardUsd).toBe(33)
		expect(out.owedUsd).toBe(33)
	})

	test("a BOM under the cap is paid in full", () => {
		const out = starterFundingFor(row({ bomTotalUsd: 29.9 }))
		expect(out.cardUsd).toBe(29.9)
		expect(out.owedUsd).toBe(29.9)
	})

	test("a maker who already has the $10 PCB card is topped up to the target", () => {
		expect(starterFundingFor(row({ bomTotalUsd: 40, fundingGivenUsd: 10 })).owedUsd).toBe(23)
		expect(starterFundingFor(row({ bomTotalUsd: 29.9, fundingGivenUsd: 10 })).owedUsd).toBe(19.9)
	})

	test("a maker already at the target is owed nothing", () => {
		const out = starterFundingFor(row({ bomTotalUsd: 29.9, fundingGivenUsd: 29.9 }))
		expect(out.fulfilment).toBe("NONE")
		expect(out.owedUsd).toBe(0)
	})

	test("a maker over the target is owed nothing and not clawed back", () => {
		expect(starterFundingFor(row({ bomTotalUsd: 29.9, fundingGivenUsd: 40 })).owedUsd).toBe(0)
	})

	test("there is one route for every starter, whatever their country", () => {
		const out = starterFundingFor(row({ bomTotalUsd: 40 }))
		expect(out.fulfilment).toBe("PARTS_CARD")
		expect(out.owedUsd).toBe(33)
	})

	test("the kit statuses that used to mean a kit now get the same parts + PCB card", () => {
		for (const kitStatus of [
			STARTER_KIT_STATUS.pcbOnlySendKit,
			STARTER_KIT_STATUS.cancelledPartsSendKit,
			STARTER_KIT_STATUS.noResponse,
		]) {
			const out = starterFundingFor(row({ bomTotalUsd: 40, kitStatus }))
			expect(out.fulfilment).toBe("PARTS_CARD")
			expect(out.owedUsd).toBe(33)
		}
	})

	test("a maker who declined, expired or was marked don't-offer is owed nothing more", () => {
		for (const kitStatus of [
			STARTER_KIT_STATUS.declined,
			STARTER_KIT_STATUS.expired,
			STARTER_KIT_STATUS.dontOfferKit,
		]) {
			const out = starterFundingFor(row({ kitStatus }))
			expect(out.fulfilment).toBe("NONE")
			expect(out.owedUsd).toBe(0)
		}
	})
})

describe("starter funding holds and flags", () => {
	test("a design that is not approved is owed nothing", () => {
		expect(starterFundingFor(row({ approved: false })).fulfilment).toBe("NONE")
	})

	test("a starter not yet in the unified database is held, not paid", () => {
		const out = starterFundingFor(row({ submitted: false }))
		expect(out.fulfilment).toBe("HOLD")
		expect(out.owedUsd).toBe(0)
	})

	test("a starter that is not Tier 1 is flagged", () => {
		expect(starterFundingFor(row({ tier: 2 })).fulfilment).toBe("FLAG")
		expect(starterFundingFor(row({ tier: null })).fulfilment).toBe("FLAG")
	})

	test("an unknown kit status is flagged, never guessed at", () => {
		const out = starterFundingFor(row({ kitStatus: "something else" }))
		expect(out.fulfilment).toBe("FLAG")
		expect(out.owedUsd).toBe(0)
	})

	test("a zero BOM is flagged", () => {
		expect(starterFundingFor(row({ bomTotalUsd: 0 })).fulfilment).toBe("FLAG")
	})
})

describe("starter action", () => {
	test("nothing owed is no action", () => {
		expect(starterAction(0, 10)).toBeNull()
		expect(starterAction(0, null)).toBeNull()
	})

	test("an amount owed with no live card recorded is a new card", () => {
		expect(starterAction(31.2, null)).toBe("NEW_CARD")
	})

	test("an amount owed with a live card recorded is a top-up", () => {
		expect(starterAction(23, 10)).toBe("TOP_UP")
	})

	test("money already spent with no live card is still a new card, for the rest owed", () => {
		// A PCB bought on a cancelled grant: $19.79 has gone out, so $5.97 is owed on a new card.
		expect(starterAction(5.97, null)).toBe("NEW_CARD")
	})
})

describe("paid so far", () => {
	test("the larger of Funding given and the recorded card is used, never their sum", () => {
		expect(paidSoFarUsd(10, 10)).toBe(10)
		expect(paidSoFarUsd(33, 10)).toBe(33)
		expect(paidSoFarUsd(0, 33)).toBe(33)
	})

	test("nothing recorded counts as nothing paid", () => {
		expect(paidSoFarUsd(0, null)).toBe(0)
	})
})
