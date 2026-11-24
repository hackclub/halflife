import { describe, expect, test } from "bun:test"
import { unionMerchantIds } from "./grant-card-merchants"

describe("unionMerchantIds", () => {
	test("no merchants means an unrestricted card", () => {
		expect(unionMerchantIds([])).toEqual([])
	})

	test("one merchant's IDs come through in order", () => {
		expect(unionMerchantIds([["B", "A", "C"]])).toEqual(["B", "A", "C"])
	})

	test("IDs shared between merchants appear once, at their first position", () => {
		expect(unionMerchantIds([["A", "B"], ["B", "C"], ["A"]])).toEqual(["A", "B", "C"])
	})

	test("a merchant with no IDs adds nothing", () => {
		expect(unionMerchantIds([[], ["X"]])).toEqual(["X"])
	})
})
