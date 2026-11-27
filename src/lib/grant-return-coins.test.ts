import { describe, expect, test } from "bun:test"
import { grantReturnCoins } from "@/lib/grant-return-coins"

describe("grantReturnCoins", () => {
	test("the cap less everything the grant spent is paid", () => {
		// A $30 cap with $1 spent: $29 left.
		expect(grantReturnCoins(30, 100)).toBe(29)
	})

	test("a $12 grant topped up by $10, with $17 spent and $5 back, pays 13 coins", () => {
		// The $10 top-up is spent along with the rest, so spend is $22 - $5 = $17; the cap is still $30.
		expect(grantReturnCoins(30, 1700)).toBe(13)
	})

	test("a grant given $2 over the tier pays the cap less spend, not the $2 back", () => {
		// $32 given, $22 back: $10 spent, so $30 - $10 = 20 coins.
		expect(grantReturnCoins(30, 1000)).toBe(20)
	})

	test("an unspent card pays the whole cap", () => {
		expect(grantReturnCoins(30, 0)).toBe(30)
	})

	test("spend past the cap pays nothing", () => {
		expect(grantReturnCoins(30, 3300)).toBe(0)
	})

	test("only whole coins are paid", () => {
		// $30 cap, $0.50 spent: $29.50 left, which pays 29 coins.
		expect(grantReturnCoins(30, 50)).toBe(29)
	})
})
