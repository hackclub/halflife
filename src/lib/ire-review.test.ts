import { afterEach, describe, expect, test } from "bun:test"
import { ReviewResult } from "@/lib/enums"
import { ireLive, ireMode, isIreConfigured } from "@/lib/ire-platform"
import { defaultIreFeedback } from "@/lib/ire-review"

const previous = {
	api: process.env.IRE_API_URL,
	mode: process.env.IRE_MODE,
	program: process.env.IRE_PROGRAM,
	secret: process.env.IRE_SIGNING_SECRET,
	webhook: process.env.IRE_WEBHOOK_SECRET,
}

afterEach(() => {
	for (const [key, value] of Object.entries(previous)) {
		const name = `IRE_${key === "api" ? "API_URL" : key === "mode" ? "MODE" : key === "program" ? "PROGRAM" : key === "secret" ? "SIGNING_SECRET" : "WEBHOOK_SECRET"}`
		if (value === undefined) delete process.env[name]
		else process.env[name] = value
	}
})

describe("ireLive", () => {
	test("needs all three credentials plus live mode", () => {
		process.env.IRE_API_URL = "https://ire.example.com"
		process.env.IRE_PROGRAM = "half-life"
		process.env.IRE_SIGNING_SECRET = "s"
		process.env.IRE_MODE = "live"
		expect(ireMode()).toBe("live")
		expect(isIreConfigured()).toBe(true)
		expect(ireLive()).toBe(true)
	})

	test("shadow mode is never live, even when configured", () => {
		process.env.IRE_API_URL = "https://ire.example.com"
		process.env.IRE_PROGRAM = "half-life"
		process.env.IRE_SIGNING_SECRET = "s"
		process.env.IRE_MODE = "shadow"
		expect(ireLive()).toBe(false)
	})

	test("unset mode defaults to shadow", () => {
		delete process.env.IRE_MODE
		process.env.IRE_API_URL = "https://ire.example.com"
		process.env.IRE_PROGRAM = "half-life"
		process.env.IRE_SIGNING_SECRET = "s"
		expect(ireMode()).toBe("shadow")
		expect(ireLive()).toBe(false)
	})

	test("live mode without credentials is not live", () => {
		delete process.env.IRE_API_URL
		delete process.env.IRE_SIGNING_SECRET
		process.env.IRE_PROGRAM = "half-life"
		process.env.IRE_MODE = "live"
		expect(isIreConfigured()).toBe(false)
		expect(ireLive()).toBe(false)
	})
})

describe("defaultIreFeedback", () => {
	test("names Ire, not Ari", () => {
		expect(defaultIreFeedback(ReviewResult.APPROVED)).toBe("Approved by Ire.")
		expect(defaultIreFeedback(ReviewResult.RETURNED)).toBe("Ire asked for changes before this can be approved.")
		expect(defaultIreFeedback(ReviewResult.REJECTED)).toBe("Ire rejected this submission.")
	})
})
