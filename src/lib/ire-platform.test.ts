import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { createHash, createHmac } from "node:crypto"
import { once } from "node:events"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import { alreadyQueuedIreShip, createIreShip, IreApiError, terminalIreFailure } from "@/lib/ire-platform"
import type { IreShipInput } from "@/lib/review-ship"
import { isRecord } from "@/lib/unknown"

const input: IreShipInput = {
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
	api: process.env.IRE_API_URL,
	mode: process.env.IRE_MODE,
	program: process.env.IRE_PROGRAM,
	secret: process.env.IRE_SIGNING_SECRET,
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
		for await (const chunk of request as AsyncIterable<Buffer>) body += chunk.toString("utf8")
		seen.push({ body, headers: request.headers, url: request.url ?? "" })
		res.writeHead(response.status, { "content-type": "application/json" })
		res.end(JSON.stringify(response.body))
	})
	server.listen(0, "127.0.0.1")
	await once(server, "listening")
	const address = server.address()
	if (address === null || typeof address === "string") throw new Error("test server has no port")
	const { port: listeningPort } = address
	port = listeningPort
})

beforeEach(() => {
	seen = []
	response = { body: { id: "sub_1", status: "accepted", version: 1 }, status: 201 }
	process.env.IRE_API_URL = `http://127.0.0.1:${port}`
	process.env.IRE_MODE = "shadow"
	process.env.IRE_PROGRAM = "half-life"
	process.env.IRE_SIGNING_SECRET = "test-secret"
})

afterAll(() => {
	server.close()
	if (previous.api === undefined) delete process.env.IRE_API_URL
	else process.env.IRE_API_URL = previous.api
	if (previous.mode === undefined) delete process.env.IRE_MODE
	else process.env.IRE_MODE = previous.mode
	if (previous.program === undefined) delete process.env.IRE_PROGRAM
	else process.env.IRE_PROGRAM = previous.program
	if (previous.secret === undefined) delete process.env.IRE_SIGNING_SECRET
	else process.env.IRE_SIGNING_SECRET = previous.secret
})

describe("createIreShip", () => {
	test("signs timestamp.body with the Review secret", async () => {
		const created = await createIreShip(input)
		expect(created).toEqual({ id: "sub_1", status: "accepted", version: 1 })
		expect(seen).toHaveLength(1)

		const [request] = seen
		if (!request) throw new Error("no request")
		const timestamp = request.headers["x-ari-timestamp"]
		const signature = request.headers["x-ari-signature"]
		if (typeof timestamp !== "string") throw new Error("timestamp header missing")
		expect(signature).toBe(createHmac("sha256", "test-secret").update(`${timestamp}.${request.body}`).digest("hex"))
	})

	test("sends a stable delivery id derived from the exact body", async () => {
		await createIreShip(input)
		const [request] = seen
		if (!request) throw new Error("no request")
		expect(request.headers["x-ari-delivery-id"]).toBe(`hl-${createHash("sha256").update(request.body).digest("hex")}`)
	})

	test("scopes the delivery id to the local submission so a resubmission is a new delivery", async () => {
		await createIreShip(input, "sub_local")
		const [request] = seen
		if (!request) throw new Error("no request")
		expect(request.headers["x-ari-delivery-id"]).toMatch(/^hl-sub_local-[0-9a-f]{16}$/)
	})

	test("carries the nested meta Review needs", async () => {
		await createIreShip(input)
		const parsed: unknown = JSON.parse(seen[0]?.body ?? "{}")
		if (!isRecord(parsed) || !isRecord(parsed.meta)) throw new Error("response has no meta")
		expect(parsed.meta.bom).toHaveLength(1)
		expect(parsed.meta.hours).toBeDefined()
	})

	test("returns the version from a conflict", async () => {
		response = { body: { error: "already_queued", id: "sub_2", version: 2 }, status: 409 }
		try {
			await createIreShip(input)
			throw new Error("expected a conflict")
		} catch (err) {
			expect(alreadyQueuedIreShip(err)).toEqual({ id: "sub_2", version: 2 })
			expect(terminalIreFailure(err)).toBeNull()
		}
	})
})

describe("errors", () => {
	test("a 422 is terminal", () => {
		const err = new IreApiError(422, "invalid", "bad field", "meta.bom")
		expect(terminalIreFailure(err)).toBe("bad field")
	})

	test("a timeout is not terminal", () => {
		expect(terminalIreFailure(new IreApiError(0, "unavailable", "offline"))).toBeNull()
		expect(terminalIreFailure(new IreApiError(503, "api_error", "down"))).toBeNull()
	})
})
