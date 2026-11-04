import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { alreadyQueuedReviewShip, createReviewShip, ReviewApiError, terminalReviewFailure } from "@/lib/review-platform"
import type { ReviewShipInput } from "@/lib/review-ship"

const input: ReviewShipInput = {
	description: "A board",
	evidence: ["commits", "devlog"],
	external_id: "proj:design",
	maker: { email: "maker@example.com", name: "Maker", slack_id: "U1" },
	meta: {
		bom: [{ name: "RP2040", qty: 1, unit_usd: 1.2 }],
		grant_cap_cents: 10000,
		hours: { claimed_seconds: 3600, hackatime_seconds: 0, journal_seconds: 3600, timelapse_seconds: 0 },
		phase: "design",
		prior_reviews: [],
		program: "half-life",
		requested_tier: 1,
		submission_notes: null,
		theme: "pcb",
		week: 1,
	},
	repo_url: "https://github.com/maker/board",
	thumbnail_url: "https://example.com/board.png",
	title: "Board",
	track: "hardware",
}

const previous = {
	api: process.env.REVIEW_API_URL,
	mode: process.env.REVIEW_MODE,
	program: process.env.REVIEW_PROGRAM,
	secret: process.env.REVIEW_SIGNING_SECRET,
}

interface Seen {
	body: string
	headers: IncomingHttpHeaders
	url: string
}

let seen: Seen[] = []
let response: { body: unknown; status: number } = { body: { id: "sub_1", status: "accepted", version: 1 }, status: 201 }
let server: Server
let port = 0

beforeAll(async () => {
	server = createServer(async (request, res) => {
		let body = ""
		for await (const chunk of request) body += chunk.toString("utf8")
		seen.push({ body, headers: request.headers, url: request.url ?? "" })
		res.writeHead(response.status, { "content-type": "application/json" })
		res.end(JSON.stringify(response.body))
	})
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	port = (server.address() as AddressInfo).port
})

beforeEach(() => {
	seen = []
	response = { body: { id: "sub_1", status: "accepted", version: 1 }, status: 201 }
	process.env.REVIEW_API_URL = `http://127.0.0.1:${port}`
	process.env.REVIEW_MODE = "shadow"
	process.env.REVIEW_PROGRAM = "half-life"
	process.env.REVIEW_SIGNING_SECRET = "test-secret"
})

afterAll(() => {
	server.close()
	if (previous.api === undefined) delete process.env.REVIEW_API_URL
	else process.env.REVIEW_API_URL = previous.api
	if (previous.mode === undefined) delete process.env.REVIEW_MODE
	else process.env.REVIEW_MODE = previous.mode
	if (previous.program === undefined) delete process.env.REVIEW_PROGRAM
	else process.env.REVIEW_PROGRAM = previous.program
	if (previous.secret === undefined) delete process.env.REVIEW_SIGNING_SECRET
	else process.env.REVIEW_SIGNING_SECRET = previous.secret
})

describe("createReviewShip", () => {
	test("signs timestamp.body with the Review secret", async () => {
		const created = await createReviewShip(input)
		expect(created).toEqual({ id: "sub_1", status: "accepted", version: 1 })
		expect(seen).toHaveLength(1)

		const request = seen[0]
		if (!request) throw new Error("no request")
		const timestamp = request.headers["x-ari-timestamp"]
		const signature = request.headers["x-ari-signature"]
		expect(typeof timestamp).toBe("string")
		expect(signature).toBe(createHmac("sha256", "test-secret").update(`${timestamp}.${request.body}`).digest("hex"))
	})

	test("sends a stable delivery id derived from the exact body", async () => {
		await createReviewShip(input)
		const request = seen[0]
		if (!request) throw new Error("no request")
		expect(request.headers["x-ari-delivery-id"]).toBe(`hl-${createHash("sha256").update(request.body).digest("hex")}`)
	})

	test("carries the nested meta Review needs", async () => {
		await createReviewShip(input)
		const parsed = JSON.parse(seen[0]?.body ?? "{}") as { meta?: { bom?: unknown[]; hours?: unknown } }
		expect(parsed.meta?.bom).toHaveLength(1)
		expect(parsed.meta?.hours).toBeDefined()
	})

	test("returns the version from a conflict", async () => {
		response = { body: { error: "already_queued", id: "sub_2", version: 2 }, status: 409 }
		try {
			await createReviewShip(input)
			throw new Error("expected a conflict")
		} catch (err) {
			expect(alreadyQueuedReviewShip(err)).toEqual({ id: "sub_2", version: 2 })
			expect(terminalReviewFailure(err)).toBeNull()
		}
	})
})

describe("errors", () => {
	test("a 422 is terminal", () => {
		const err = new ReviewApiError(422, "invalid", "bad field", "meta.bom")
		expect(terminalReviewFailure(err)).toBe("bad field")
	})

	test("a timeout is not terminal", () => {
		expect(terminalReviewFailure(new ReviewApiError(0, "unavailable", "offline"))).toBeNull()
		expect(terminalReviewFailure(new ReviewApiError(503, "api_error", "down"))).toBeNull()
	})
})
