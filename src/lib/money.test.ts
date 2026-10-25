import { describe, expect, test } from "bun:test"
import { dollars, formatUsd, round2 } from "@/lib/money"

describe("round2", () => {
	test("leaves whole numbers alone", () => {
		expect(round2(0)).toBe(0)
		expect(round2(10)).toBe(10)
		expect(round2(-3)).toBe(-3)
	})

	test("rounds to the cent", () => {
		expect(round2(1.234)).toBe(1.23)
		expect(round2(1.235)).toBe(1.24)
		expect(round2(2.675)).toBe(2.68)
		expect(round2(2.674)).toBe(2.67)
	})

	test("handles negatives without claiming symmetric halves", () => {
		expect(round2(-1.234)).toBe(-1.23)
	})
})

describe("dollars", () => {
	test("keeps null as not set", () => {
		expect(dollars(null)).toBeNull()
	})

	test("rounds non-null values", () => {
		expect(dollars(1.234)).toBe(1.23)
		expect(dollars(0)).toBe(0)
	})
})

describe("formatUsd", () => {
	test("formats with grouping and two decimals", () => {
		expect(formatUsd(0)).toBe("$0.00")
		expect(formatUsd(1234.5)).toBe("$1,234.50")
		expect(formatUsd(1_000_000)).toBe("$1,000,000.00")
	})

	test("formats negatives with the sign outside", () => {
		expect(formatUsd(-5)).toBe("-$5.00")
	})
})
