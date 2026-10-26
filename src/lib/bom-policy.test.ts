import { describe, expect, test } from "bun:test"
import { BOM_MARGIN_USD, bomTotalUsd, partsFunding } from "@/lib/bom-policy"

describe("bomTotalUsd", () => {
	test("sums lines plus one flat tax/shipping charge", () => {
		const items = [
			{ quantity: 2, unitCostUsd: 1.5 },
			{ quantity: 1, unitCostUsd: 0.99 },
		]
		expect(bomTotalUsd(items, 2)).toBe(5.99)
		expect(bomTotalUsd(items, null)).toBe(3.99)
		expect(bomTotalUsd([], 2)).toBe(2)
	})

	test("rounds the float dust away", () => {
		expect(bomTotalUsd([{ quantity: 3, unitCostUsd: 0.1 }], 0)).toBe(0.3)
	})
})

describe("partsFunding", () => {
	test("a cart within budget needs nothing", () => {
		expect(partsFunding(25, 30)).toEqual({ capUsd: 30, needsAgreement: false, shortfallUsd: 0, totalUsd: 25 })
	})

	test("a cart within the margin warns but needs no agreement", () => {
		expect(partsFunding(30 + BOM_MARGIN_USD, 30).needsAgreement).toBe(false)
	})

	test("a cart past the margin needs agreement and names the shortfall", () => {
		const out = partsFunding(40, 30)
		expect(out.needsAgreement).toBe(true)
		expect(out.shortfallUsd).toBe(10)
	})
})
