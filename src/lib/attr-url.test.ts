import { describe, expect, test } from "bun:test"
import { attrUrl } from "@/lib/attr-url"

describe("attrUrl", () => {
	test("percent-encodes the four HTML meta-characters", () => {
		expect(attrUrl("<\">'")).toBe("%3C%22%3E%27")
		expect(attrUrl("a<b>c\"d'e")).toBe("a%3Cb%3Ec%22d%27e")
	})

	test("leaves ordinary URLs, queries and escapes alone", () => {
		expect(attrUrl("https://example.com/a?b=1&c=2")).toBe("https://example.com/a?b=1&c=2")
		expect(attrUrl("https://example.com/a%20b")).toBe("https://example.com/a%20b")
		expect(attrUrl("")).toBe("")
	})
})
