import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { MAX_JSON_BODY_BYTES, parseBody } from "@/lib/api"

const schema = z.object({ value: z.string() }).strict()

function request(body: string): Request {
	return new Request("http://localhost/api/test", {
		body,
		headers: { "content-type": "application/json" },
		method: "POST",
	})
}

describe("parseBody", () => {
	test("parses a normal body", async () => {
		const parsed = await parseBody(request(JSON.stringify({ value: "hi" })), schema)
		expect(parsed.data).toEqual({ value: "hi" })
	})

	test("refuses a body above the cap instead of reading it", async () => {
		const parsed = await parseBody(request(JSON.stringify({ value: "x".repeat(MAX_JSON_BODY_BYTES + 1) })), schema)
		expect(parsed.error?.status).toBe(400)
		expect(await parsed.error?.json()).toMatchObject({ error: { message: "Request body is too large" } })
	})

	test("refuses malformed JSON", async () => {
		const parsed = await parseBody(request("{"), schema)
		expect(parsed.error?.status).toBe(400)
	})
})
