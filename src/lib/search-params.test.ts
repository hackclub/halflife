import { describe, expect, test } from "bun:test"
import { firstValue, firstValues } from "@/lib/search-params"

describe("firstValue", () => {
	test("passes a single value through", () => {
		expect(firstValue("a")).toBe("a")
		expect(firstValue(undefined)).toBeUndefined()
	})

	test("keeps the first of a repeated parameter", () => {
		expect(firstValue(["a", "b"])).toBe("a")
		expect(firstValue([])).toBeUndefined()
	})
})

describe("firstValues", () => {
	test("reduces every parameter to a single value", () => {
		expect(firstValues({ page: "2", q: ["a", "b"], tag: undefined })).toEqual({
			page: "2",
			q: "a",
			tag: undefined,
		})
	})

	test("keeps the page's keys", () => {
		expect(firstValues({})).toEqual({})
	})
})
