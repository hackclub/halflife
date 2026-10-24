import { describe, expect, test } from "bun:test"
import { containsPattern, escapeLikePattern, preview } from "@/lib/text"

describe("preview", () => {
	test("collapses whitespace and trims", () => {
		expect(preview("  hello   world  ")).toBe("hello world")
		expect(preview("a\nb\tc")).toBe("a b c")
	})

	test("leaves short text alone", () => {
		expect(preview("hello")).toBe("hello")
		expect(preview("")).toBe("")
	})

	test("cuts long text to max characters with an ellipsis", () => {
		expect(preview("a".repeat(100))).toBe(`${"a".repeat(89)}…`)
		expect(preview("a".repeat(100), 10)).toBe(`${"a".repeat(9)}…`)
		expect(preview("a".repeat(90), 90)).toBe("a".repeat(90))
	})

	test("respects a custom max", () => {
		expect(preview("hello world", 5)).toBe("hell…")
	})
})

describe("escapeLikePattern", () => {
	test("escapes LIKE wildcards and the escape itself", () => {
		expect(escapeLikePattern("100%_\\test")).toBe(String.raw`100\%\_\\test`)
	})

	test("leaves plain text alone", () => {
		expect(escapeLikePattern("hello")).toBe("hello")
		expect(escapeLikePattern("")).toBe("")
	})
})

describe("containsPattern", () => {
	test("wraps the escaped value in wildcards", () => {
		expect(containsPattern("hello")).toBe("%hello%")
		expect(containsPattern("a%b_c\\d")).toBe("%a\\%b\\_c\\\\d%")
	})
})
