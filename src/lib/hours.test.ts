import { describe, expect, test } from "bun:test"
import { buildCoinsFor, designCoinsFor } from "@/lib/hours"

describe("designCoinsFor", () => {
	test("pays only the hours above the tier's funded block", () => {
		// Tier 1 funds 6h, so 11h is five paid hours.
		expect(designCoinsFor(1, 11)).toEqual({ banked: 0, spendable: 25, total: 25 })
	})

	test("a declined grant pays the funded hours too", () => {
		// No grant means no hours bought parts, so all 11 pay – declining must not also cost the work.
		expect(designCoinsFor(1, 11, { fundedHours: 0 })).toEqual({ banked: 0, spendable: 55, total: 55 })
	})

	test("a declined grant pays nothing for no hours", () => {
		expect(designCoinsFor(1, 0, { fundedHours: 0 }).spendable).toBe(0)
	})

	test("an override that puts the grant back restores its funded block", () => {
		expect(designCoinsFor(1, 11, { fundedHours: 6 }).spendable).toBe(25)
	})

	test("an undeclined approval at the funded floor still earns nothing", () => {
		expect(designCoinsFor(1, 6).spendable).toBe(0)
	})

	test("a fraction over the funded block mints the coins it is worth, not one more", () => {
		// 7.4 - 6 is 1.4000000000000004 as a float, which used to tip 7 coins over into 8.
		expect(designCoinsFor(1, 7.4).spendable).toBe(7)
		expect(designCoinsFor(1, 6.2).spendable).toBe(1)
	})
})

describe("buildCoinsFor", () => {
	test("every build hour pays", () => {
		expect(buildCoinsFor(5)).toEqual({ banked: 0, spendable: 25, total: 25 })
	})
})
