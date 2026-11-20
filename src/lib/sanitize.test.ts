import { describe, expect, test } from "bun:test"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"

describe("sanitize", () => {
	test("strips all markup and trims", () => {
		expect(sanitize("<b>hi</b>")).toBe("hi")
		expect(sanitize("  hello  ")).toBe("hello")
		expect(sanitize("<script>alert(1)</script>hi")).toBe("hi")
	})

	test("drops event handlers and styles with the tag", () => {
		expect(sanitize('<a href="https://x.com" onclick="evil()">l</a>')).toBe("l")
	})

	test("returns plain text, not HTML", () => {
		expect(sanitize("PCB Design & Fabrication")).toBe("PCB Design & Fabrication")
		expect(sanitize("To move the legs <3")).toBe("To move the legs <3")
		expect(sanitize("microSD card <=32GB")).toBe("microSD card <=32GB")
		expect(sanitize("SaludWatch <09/30/26 - 10/02/26>")).toBe("SaludWatch <09/30/26 - 10/02/26>")
		expect(sanitize("x > y")).toBe("x > y")
	})

	test("decodes text that was stored escaped", () => {
		expect(sanitize("PCB Design &amp; Fabrication")).toBe("PCB Design & Fabrication")
		expect(sanitize("a starbie variant!! &lt;3")).toBe("a starbie variant!! <3")
	})
})

describe("sanitizeOptional", () => {
	test("passes null and undefined through as null", () => {
		expect(sanitizeOptional(null)).toBeNull()
		expect(sanitizeOptional(undefined)).toBeNull()
	})

	test("maps blank input to null", () => {
		expect(sanitizeOptional("   ")).toBeNull()
		expect(sanitizeOptional("<script>alert(1)</script>")).toBeNull()
	})

	test("returns cleaned text otherwise", () => {
		expect(sanitizeOptional("<b>x</b>")).toBe("x")
	})
})
