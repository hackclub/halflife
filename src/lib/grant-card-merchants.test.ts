import { describe, expect, test } from "bun:test"
import { diffMerchantLinks, merchantSlug, unionMerchantIds } from "./grant-card-merchants"

describe("diffMerchantLinks", () => {
	test("adds the wanted merchants that are not linked yet", () => {
		expect(diffMerchantLinks([], ["a", "b"])).toEqual({ add: ["a", "b"], remove: [] })
	})

	test("removes links no longer wanted and keeps the rest", () => {
		expect(diffMerchantLinks(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] })
	})

	test("does nothing when the links already match", () => {
		expect(diffMerchantLinks(["a", "b"], ["b", "a"])).toEqual({ add: [], remove: [] })
	})

	test("clearing every link removes them all", () => {
		expect(diffMerchantLinks(["a", "b"], [])).toEqual({ add: [], remove: ["a", "b"] })
	})
})

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

describe("merchantSlug", () => {
	test("lowercases and hyphenates a name", () => {
		expect(merchantSlug("Costco Wholesale")).toBe("costco-wholesale")
		expect(merchantSlug("Robu.in")).toBe("robu-in")
	})

	test("drops accents and edge punctuation", () => {
		expect(merchantSlug("  Café Déjà!  ")).toBe("cafe-deja")
	})

	test("falls back to a fixed key when nothing is left", () => {
		expect(merchantSlug("!!!")).toBe("merchant")
	})
})
