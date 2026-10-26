import { describe, expect, test } from "bun:test"
import { Phase } from "@/lib/enums"
import { boundedText, cuid, httpsUrl, isTimeZone, phaseBodySchema, phaseSchema } from "@/lib/schemas/common"

describe("cuid / phaseSchema / phaseBodySchema", () => {
	test("accepts ids and phases, rejects the rest", () => {
		expect(cuid.safeParse("abc").success).toBe(true)
		expect(cuid.safeParse("").success).toBe(false)
		expect(phaseSchema.safeParse(Phase.DESIGN).success).toBe(true)
		expect(phaseSchema.safeParse("nope").success).toBe(false)
		expect(phaseBodySchema.safeParse({ phase: Phase.BUILD }).success).toBe(true)
		expect(phaseBodySchema.safeParse({ extra: 1, phase: Phase.BUILD }).success).toBe(false)
	})
})

describe("httpsUrl", () => {
	test("accepts https and trims", () => {
		expect(httpsUrl.safeParse("https://example.com/x").success).toBe(true)
		expect(httpsUrl.safeParse("  https://example.com/x  ").success).toBe(true)
	})

	test("rejects other schemes, prose and the unparseable", () => {
		expect(httpsUrl.safeParse("http://example.com/x").success).toBe(false)
		const scheme = ["java", "script:"].join("")
		expect(httpsUrl.safeParse(`${scheme}alert(1)`).success).toBe(false)
		expect(httpsUrl.safeParse("not a url").success).toBe(false)
		expect(httpsUrl.safeParse("https://exa mple.com").success).toBe(false)
	})
})

describe("boundedText / isTimeZone", () => {
	test("trims and bounds", () => {
		const schema = boundedText(5, 1)
		expect(schema.safeParse("  hi  ").success).toBe(true)
		expect(schema.safeParse("").success).toBe(false)
		expect(schema.safeParse("toolong").success).toBe(false)
		expect(boundedText(5).safeParse("").success).toBe(true)
	})

	test("knows the zones this runtime knows", () => {
		expect(isTimeZone("America/New_York")).toBe(true)
		expect(isTimeZone("Mars/Olympus")).toBe(false)
	})
})
