import { describe, expect, test } from "bun:test"
import { redactForLog } from "@/lib/redact"

describe("redactForLog", () => {
	test("masks email addresses", () => {
		expect(redactForLog("contact me@example.com please")).toBe("contact [email] please")
	})

	test("masks bearer-like tokens but keeps the scheme", () => {
		expect(redactForLog("auth Bearer abcdef12345 failed")).toBe("auth Bearer [redacted] failed")
	})

	test("passes non-strings through untouched", () => {
		expect(redactForLog(null)).toBeNull()
		expect(redactForLog(42)).toBe(42)
		expect(redactForLog(undefined)).toBeUndefined()
	})

	test("truncates very long lines instead of scanning them whole", () => {
		const line = `start ${"x".repeat(5_000)}`
		const out = redactForLog(line)
		expect(typeof out).toBe("string")
		if (typeof out !== "string") throw new Error("expected a string")
		expect(out.length).toBeLessThan(line.length)
		expect(out.startsWith("start ")).toBe(true)
	})

	test("leaves clean lines alone", () => {
		expect(redactForLog("all good")).toBe("all good")
	})
})
