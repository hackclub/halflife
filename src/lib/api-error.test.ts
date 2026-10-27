import { describe, expect, test } from "bun:test"
import { errorCode, errorMessage, refusalMessage } from "@/lib/api-error"

describe("errorMessage", () => {
	test("quotes the route's message", () => {
		expect(errorMessage({ error: { message: "Project not found" } }, "fallback")).toBe("Project not found")
	})

	test("falls back for a body that is not the envelope", () => {
		expect(errorMessage(null, "fallback")).toBe("fallback")
		expect(errorMessage("<html>bad gateway</html>", "fallback")).toBe("fallback")
		expect(errorMessage({ error: "nope" }, "fallback")).toBe("fallback")
		expect(errorMessage({ error: { message: 42 } }, "fallback")).toBe("fallback")
	})
})

describe("errorCode", () => {
	test("reads the code out of the envelope", () => {
		expect(errorCode({ error: { code: "PURCHASE_LIMIT", message: "Limit 1 per person" } })).toBe("PURCHASE_LIMIT")
	})

	test("returns undefined for anything else", () => {
		expect(errorCode(null)).toBeUndefined()
		expect(errorCode("<html>bad gateway</html>")).toBeUndefined()
		expect(errorCode({ error: { message: "no code" } })).toBeUndefined()
		expect(errorCode({ error: { code: 42 } })).toBeUndefined()
	})
})

describe("refusalMessage", () => {
	test("a signed-out answer says to sign in", () => {
		expect(refusalMessage(401, "Could not check the repo")).toBe(
			"You are signed out. Refresh the page and sign in again.",
		)
	})

	test("a gateway answer is named as temporary", () => {
		for (const status of [502, 503, 504])
			expect(refusalMessage(status, "Could not check the repo")).toBe(
				`Could not check the repo (HTTP ${status}). This is usually temporary – try again in a minute.`,
			)
	})

	test("any other status carries the number into the fallback", () => {
		expect(refusalMessage(500, "Could not load the parts list")).toBe(
			"Could not load the parts list (HTTP 500). Try again.",
		)
	})
})
