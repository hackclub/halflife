import { describe, expect, test } from "bun:test"
import { grantReturnBreakdown, grantReturnCoins, isMakerCancel, returnCreditDecision } from "@/lib/grant-card-return"

describe("grantReturnCoins", () => {
	test("an unspent small card pays the whole funded block, as declining would", () => {
		// Tier 1 funds 6 hours, which is 30 coins. A $15 BOM card returned untouched pays all 30.
		expect(grantReturnCoins({ amountCents: 1500, fundingHours: 6, spentCents: 0 })).toBe(30)
	})

	test("spend comes off the block", () => {
		expect(grantReturnCoins({ amountCents: 1500, fundingHours: 6, spentCents: 500 })).toBe(25)
	})

	test("a card larger than the block pays only the block, not the BOM above it", () => {
		expect(grantReturnCoins({ amountCents: 5000, fundingHours: 6, spentCents: 0 })).toBe(30)
	})

	test("spending the whole block pays nothing", () => {
		expect(grantReturnCoins({ amountCents: 3000, fundingHours: 6, spentCents: 3000 })).toBe(0)
	})

	test("a small card fully spent still leaves the unfunded part of the block", () => {
		// $15 card spent on $15 of parts: the other $15 of the block was never given, so it pays.
		expect(grantReturnCoins({ amountCents: 1500, fundingHours: 6, spentCents: 1500 })).toBe(15)
	})

	test("spend beyond the BOM-sized grant came from buffer money and does not reduce the block", () => {
		// $15 BOM, $40 spent: the first $15 is the BOM, so $15 of the $30 block is left. The other $25 was buffer money.
		expect(grantReturnCoins({ amountCents: 1500, fundingHours: 6, spentCents: 4000 })).toBe(15)
	})

	test("cents below a whole coin are floored", () => {
		// $30 block, $0.99 spent: 29.01 coins, so 29.
		expect(grantReturnCoins({ amountCents: 3000, fundingHours: 6, spentCents: 99 })).toBe(29)
	})

	test("a larger tier uses its own block", () => {
		// Tier 2 funds 13 hours, which is 65 coins.
		expect(grantReturnCoins({ amountCents: 6500, fundingHours: 13, spentCents: 0 })).toBe(65)
	})

	test("cents left over from the block are reported, not paid", () => {
		// $30 block, $0.99 spent: 29 whole coins, and 1 cent of the block is left over.
		expect(grantReturnBreakdown({ amountCents: 3000, fundingHours: 6, spentCents: 99 })).toEqual({
			blockCents: 3000,
			coins: 29,
			leftoverCents: 1,
			spentFromBlockCents: 99,
		})
	})
})

describe("isMakerCancel", () => {
	test("the maker cancelling their own grant counts, whatever the case of the email", () => {
		expect(isMakerCancel("Maker@Example.com", "maker@example.com")).toBe(true)
	})

	test("an admin cancelling the grant does not count", () => {
		expect(isMakerCancel("admin@hackclub.com", "maker@example.com")).toBe(false)
	})

	test("an unknown canceller is never the maker", () => {
		expect(isMakerCancel(null, "maker@example.com")).toBe(false)
	})

	test("a card with no recorded maker email cannot be matched", () => {
		expect(isMakerCancel("maker@example.com", null)).toBe(false)
	})
})

describe("returnCreditDecision", () => {
	test("a maker return is credited", () => {
		expect(
			returnCreditDecision({
				alreadyCredited: false,
				canceledByEmail: "maker@example.com",
				makerEmail: "maker@example.com",
			}),
		).toBe("credit")
	})

	test("an admin cancel is held, never credited", () => {
		expect(
			returnCreditDecision({
				alreadyCredited: false,
				canceledByEmail: "admin@hackclub.com",
				makerEmail: "maker@example.com",
			}),
		).toBe("held")
	})

	test("a return whose canceller is not known yet is held", () => {
		expect(
			returnCreditDecision({ alreadyCredited: false, canceledByEmail: null, makerEmail: "maker@example.com" }),
		).toBe("held")
	})

	test("a return already credited is never paid again, even from the maker", () => {
		expect(
			returnCreditDecision({
				alreadyCredited: true,
				canceledByEmail: "maker@example.com",
				makerEmail: "maker@example.com",
			}),
		).toBe("already")
	})
})
