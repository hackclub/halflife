import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
	ApiRequestError,
	ApiResponseShapeError,
	errorCode,
	errorMessage,
	readErrorMessage,
	readJson,
	refusalMessage,
} from "@/lib/api-error"

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

const response = (body: string, status = 200, type = "application/json"): Response =>
	new Response(body, { headers: { "content-type": type }, status })
const schema = z.object({ id: z.string() })

/** Settle a rejection into a value, so a test can assert on the error itself. */
const settle = (promise: Promise<unknown>): Promise<unknown> => promise.catch((err: unknown) => err)

describe("readJson", () => {
	test("returns the parsed body of a success", async () => {
		expect(await readJson(response('{"id":"p1"}'), schema, "fallback")).toEqual({ id: "p1" })
	})

	test("throws the server's message for a refusal, with its status and code", async () => {
		const err = await settle(
			readJson(
				response('{"error":{"code":"PURCHASE_LIMIT","message":"One per person"}}', 409),
				schema,
				"Could not buy",
			),
		)
		expect(err).toBeInstanceOf(ApiRequestError)
		expect(err).toMatchObject({ code: "PURCHASE_LIMIT", message: "One per person", status: 409 })
	})

	test("a refusal with no envelope body falls back to the status message", async () => {
		const err = await settle(readJson(response("<html>bad gateway</html>", 502, "text/html"), schema, "Could not load"))
		expect(err).toMatchObject({
			code: undefined,
			message: "Could not load (HTTP 502). This is usually temporary – try again in a minute.",
			status: 502,
		})
	})

	test("a 2xx body that is not JSON is a shape error, not a refusal", async () => {
		expect(await settle(readJson(response("", 204, "text/plain"), schema, "fallback"))).toBeInstanceOf(
			ApiResponseShapeError,
		)
	})

	test("a 2xx body of the wrong shape is a shape error", async () => {
		expect(await settle(readJson(response('{"ids":["p1"]}'), schema, "fallback"))).toBeInstanceOf(ApiResponseShapeError)
	})
})

describe("readErrorMessage", () => {
	test("a refusal shows the server's own sentence", () => {
		expect(readErrorMessage(new ApiRequestError(409, "One per person"), "shape", "unreachable")).toBe("One per person")
	})

	test("a shape error shows the caller's shape line", () => {
		expect(readErrorMessage(new ApiResponseShapeError(), "shape", "unreachable")).toBe("shape")
	})

	test("a fetch that never answered shows the unreachable line, not its own text", () => {
		const failed = new TypeError("Failed to fetch")
		expect(readErrorMessage(failed, "shape", "unreachable")).toBe("unreachable")
	})

	test("the unreachable line defaults to the shape line", () => {
		expect(readErrorMessage(new TypeError("Failed to fetch"), "shape")).toBe("shape")
	})
})
