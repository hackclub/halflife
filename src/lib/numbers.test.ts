import { describe, expect, test } from "bun:test"
import { fmtHours, fmtInt, pctOf, round1 } from "@/lib/numbers"

describe("round1", () => {
	test("rounds to one decimal place", () => {
		expect(round1(2.05)).toBe(2.1)
		expect(round1(2.04)).toBe(2)
		expect(round1(0)).toBe(0)
	})
})

describe("pctOf", () => {
	test("converts a share to a one-decimal percentage", () => {
		expect(pctOf(1, 2)).toBe(50)
		expect(pctOf(1, 3)).toBe(33.3)
		expect(pctOf(2, 3)).toBe(66.7)
	})

	test("treats an empty whole as zero rather than NaN", () => {
		expect(pctOf(0, 0)).toBe(0)
		expect(pctOf(5, 0)).toBe(0)
	})
})

describe("fmtInt", () => {
	test("groups thousands", () => {
		expect(fmtInt(1234)).toBe("1,234")
		expect(fmtInt(0)).toBe("0")
	})
})

describe("fmtHours", () => {
	test("formats with at most two decimals and an h suffix", () => {
		expect(fmtHours(7.5)).toBe("7.5h")
		expect(fmtHours(9)).toBe("9h")
		expect(fmtHours(9.55)).toBe("9.55h")
		expect(fmtHours(9.555)).toBe("9.56h")
	})
})
