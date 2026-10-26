import { describe, expect, test } from "bun:test"
import { API_ERROR_STATUS, HttpError } from "@/lib/errors"

describe("HttpError", () => {
	test("carries its code and message", () => {
		const err = new HttpError("NOT_FOUND", "missing")
		expect(err).toBeInstanceOf(Error)
		expect(err.name).toBe("HttpError")
		expect(err.code).toBe("NOT_FOUND")
		expect(err.message).toBe("missing")
		expect(err.details).toBeUndefined()
	})

	test("maps each code to its fixed status", () => {
		expect(new HttpError("NOT_FOUND", "x").status).toBe(404)
		expect(new HttpError("INVALID_QUERY", "x").status).toBe(400)
		expect(new HttpError("CONFLICT", "x").status).toBe(409)
		expect(new HttpError("UNAUTHENTICATED", "x").status).toBe(401)
		expect(new HttpError("RATE_LIMITED", "x").status).toBe(429)
		expect(new HttpError("INTERNAL", "x").status).toBe(500)
		expect(new HttpError("UNAVAILABLE", "x").status).toBe(503)
	})

	test("status agrees with the table for every code", () => {
		for (const [code, status] of Object.entries(API_ERROR_STATUS)) {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberately invalid or partial value for this test
			const error = new HttpError(code as keyof typeof API_ERROR_STATUS, "x")
			expect(error.status).toBe(status)
		}
	})
})
