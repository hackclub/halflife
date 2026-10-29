import { afterEach, describe, expect, test } from "bun:test"
import { AirtableError, AirtableListSchema, airtableFetch } from "@/lib/airtable/client"

const config = { apiKey: "key", baseId: "appTEST" }
const realFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = realFetch
})

function respondWith(status: number, body: string): void {
	globalThis.fetch = () => Promise.resolve(new Response(body, { status }))
}

async function refusal(path: string): Promise<AirtableError> {
	try {
		await airtableFetch(AirtableListSchema, config, path)
	} catch (err) {
		if (err instanceof AirtableError) return err
		throw err
	}
	throw new Error("expected the request to be refused")
}

describe("airtableFetch", () => {
	test("quotes Airtable's own reason on a refusal", async () => {
		respondWith(
			422,
			JSON.stringify({
				error: {
					message: "Invalid request: parameter validation failed. Check your request data.",
					type: "INVALID_REQUEST_UNKNOWN",
				},
			}),
		)
		const err = await refusal("tblX/recY?fields%5B%5D=Hours")
		expect(err.message).toBe(
			"Airtable 422 on tblX/recY?fields%5B%5D=Hours: INVALID_REQUEST_UNKNOWN – Invalid request: parameter validation failed. Check your request data.",
		)
		expect(err.body).toContain("INVALID_REQUEST_UNKNOWN")
	})

	test("stays plain when the body is not Airtable's envelope", async () => {
		respondWith(502, "<html>bad gateway</html>")
		const err = await refusal("tblX")
		expect(err.message).toBe("Airtable 502 on tblX")
		expect(err.body).toBe("<html>bad gateway</html>")
	})
})
