import { describe, expect, test } from "bun:test"
import { grantReturnCoins } from "@/lib/grant-return-coins"

describe("grantReturnCoins", () => {
	test("the unissued part of the cap and the returned balance both pay", () => {
		// A $30 cap, a $10 card with $1 spent: $20 never issued plus $9 returned.
		expect(grantReturnCoins(30, 1000, 100)).toBe(29)
		// A $30 cap, a $20 card with $1 spent: $10 never issued plus $19 returned.
		expect(grantReturnCoins(30, 2000, 100)).toBe(29)
	})

	test("top-ups add nothing: the cap less the spend, whatever was topped up", () => {
		// A $30 cap, a $30 card topped up to $33, $27 spent: $3 left, measured against the cap.
		expect(grantReturnCoins(30, 3000, 2700)).toBe(3)
	})

	test("an unspent card pays the whole cap", () => {
		expect(grantReturnCoins(30, 3000, 0)).toBe(30)
	})

	test("spend past what was issued, from a top-up, pays nothing beyond the unissued part", () => {
		expect(grantReturnCoins(30, 3000, 3300)).toBe(0)
	})

	test("only whole coins are paid", () => {
		// $30 cap, $0.50 spent: $29.50 left, which pays 29 coins.
		expect(grantReturnCoins(30, 3000, 50)).toBe(29)
	})
})
