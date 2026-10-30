import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { API_ERROR_STATUS, type ApiErrorCode, HttpError } from "@/lib/errors"
import { rateLimited } from "@/lib/rate-limit"

export interface ApiErrorBody {
	error: { code: ApiErrorCode; message: string; details?: unknown }
}

/**
 * A successful response is the payload ITSELF. There is no `data` envelope.
 *
 * Worth stating because failures are not symmetrical – `fail()` wraps, in `{ error: { code, message } }` – and the asymmetry invites a client to assume both are wrapped. Three of them did, and the phone handoff and the staff composer's upload spent their whole lives throwing "cannot read properties of undefined (reading 'id')" as a result.
 *
 * If this ever grows an envelope, it has to grow one everywhere in the same commit; half the callers reading `payload.data` is the state that hides.
 */
export function ok<T>(data: T, init?: ResponseInit): NextResponse<T> {
	return NextResponse.json(data, init)
}

/**
 * The only way to build an error response. The status comes from the code, so the two can never disagree.
 */
export function fail(code: ApiErrorCode, message: string, details?: unknown): NextResponse<ApiErrorBody> {
	return NextResponse.json(
		{ error: { code, message, ...(details === undefined ? {} : { details }) } },
		{ status: API_ERROR_STATUS[code] },
	)
}

type Parsed<T> = { data: T; error?: never } | { data?: never; error: NextResponse<ApiErrorBody> }

/**
 * Parse and validate a JSON body. Handlers must never read a field off an unvalidated object – that is how `undefined` reaches Prisma and becomes a confusing runtime error three layers down.
 */
export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<Parsed<z.output<S>>> {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return { error: fail("INVALID_BODY", "Request body must be valid JSON") }
	}

	const result = schema.safeParse(raw)
	if (!result.success)
		return {
			error: fail("VALIDATION_FAILED", "Invalid request", z.treeifyError(result.error)),
		}

	return { data: result.data }
}

export function parseQuery<S extends z.ZodType>(request: NextRequest, schema: S): Parsed<z.output<S>> {
	const raw = Object.fromEntries(request.nextUrl.searchParams.entries())
	const result = schema.safeParse(raw)
	if (!result.success)
		return {
			error: fail("INVALID_QUERY", "Invalid query parameters", z.treeifyError(result.error)),
		}

	return { data: result.data }
}

/**
 * The most a multipart body may carry beyond the file itself: boundaries and part headers. Generous, because the cap exists to stop multi-gigabyte bodies, not to tighten the file limit.
 */
const MULTIPART_OVERHEAD_BYTES = 1 << 20

type ParsedForm = { data: FormData; error?: never } | { data?: never; error: NextResponse<ApiErrorBody> }

/**
 * How many bytes of upload body may be held in memory at once, process-wide.
 *
 * A body is held several times over while it is parsed – the chunks as they arrive, the concatenated buffer, and the multipart blob the runtime builds from that – so the number of concurrent requests is what decides the process's peak memory, and a per-request cap does not bound it.
 *
 * A count of requests is the wrong unit, though: a cohort posting journal photographs is a hundred small bodies, while a maker uploading one phone video is a single large one, and a count treats the two as the same thing. The budget is in bytes, so the video does not squeeze out the hundred and the hundred does not add up to a gigabyte.
 *
 * This is a reservation, not a measurement: a request reserves what it says it will send, and one that says nothing (a chunked body) reserves the whole cap, because nothing is known about it until it has been read.
 */
const UPLOAD_MEMORY_BUDGET_BYTES = 128 * 1024 * 1024

/**
 * The handoff pool: the phone-upload route is deliberately unauthenticated, so it reserves from its own budget rather than the shared one. Two anonymous 64 MB videos used to fill the whole shared pool and fail every other user's upload for up to 30 seconds; now they only queue behind each other. Sized to always fit one full-size handoff body plus headroom, so a legitimate upload never waits on an empty pool.
 */
const HANDOFF_MEMORY_BUDGET_BYTES = 96 * 1024 * 1024

/** How long a request waits for room in the budget before it is refused. */
const UPLOAD_RESERVATION_WAIT_MS = 30_000

interface UploadPool {
	budget: number
	reserved: number
	waiters: UploadWaiter[]
}

/** Requests waiting for room, in the order they asked. */
interface UploadWaiter {
	bytes: number
	resolve(granted: boolean): void
}

function makeUploadPool(budget: number): UploadPool {
	return { budget, reserved: 0, waiters: [] }
}

/** The pool an authenticated upload reserves from. */
const defaultUploadPool = makeUploadPool(UPLOAD_MEMORY_BUDGET_BYTES)

/** The pool the unauthenticated phone-upload route reserves from. */
export const handoffUploadPool = makeUploadPool(HANDOFF_MEMORY_BUDGET_BYTES)

/**
 * Hand the freed bytes to the first waiter they fit.
 *
 * First come, first served, and a waiter that does not fit is passed over rather than blocking the queue behind it: one large upload must not stop a hundred small ones from going through.
 */
function drainUploadWaiters(pool: UploadPool): void {
	for (let i = 0; i < pool.waiters.length; ) {
		const waiter = pool.waiters[i]
		if (!waiter) break
		if (pool.reserved + waiter.bytes > pool.budget) {
			i += 1
			continue
		}
		pool.reserved += waiter.bytes
		pool.waiters.splice(i, 1)
		waiter.resolve(true)
	}
}

/**
 * Reserve room in the budget for a body, waiting for it if the budget is full.
 *
 * Waiting rather than refusing is what keeps a cohort upload working: the room is taken before the body is read, so a request that waits costs no memory of its own.
 */
function reserveUploadBytes(pool: UploadPool, bytes: number): Promise<boolean> {
	if (pool.reserved + bytes <= pool.budget) {
		pool.reserved += bytes
		return Promise.resolve(true)
	}
	const { promise, resolve } = Promise.withResolvers<boolean>()
	const waiter: UploadWaiter = { bytes, resolve }
	pool.waiters.push(waiter)
	const timer = setTimeout(() => {
		const index = pool.waiters.indexOf(waiter)
		if (index === -1) return
		pool.waiters.splice(index, 1)
		resolve(false)
	}, UPLOAD_RESERVATION_WAIT_MS)
	// The timer must not be what keeps the process alive on its way out.
	timer.unref?.()
	return promise
}

/** Give the reservation back and let the queue move. */
function releaseUploadBytes(pool: UploadPool, bytes: number): void {
	pool.reserved = Math.max(0, pool.reserved - bytes)
	drainUploadWaiters(pool)
}

/**
 * Parse an upload's multipart form without letting the caller decide how much memory the server spends before a single field can be read.
 *
 * `request.formData()` materialises the whole body first, and both upload routes check their size limits afterwards – fine for a small staff form, but a denial of service for an upload. The handoff path is deliberately unauthenticated and reads its token out of the form, so a limit checked after parsing arrives too late. Content-Length is checked first (cheap, and what a normal client sends), then the stream is counted as it is read, so a chunked request cannot skip the check by omitting the header.
 *
 * `pool` selects whose budget the reservation comes from: the shared pool by default, the handoff pool for the unauthenticated phone route, so anonymous uploads queue behind each other instead of starving everyone else.
 */
export async function parseUploadForm(
	request: Request,
	maxFileBytes: number,
	pool: UploadPool = defaultUploadPool,
): Promise<ParsedForm> {
	const cap = maxFileBytes + MULTIPART_OVERHEAD_BYTES
	const declared = Number(request.headers.get("content-length") ?? "")
	const reservation = Number.isFinite(declared) && declared > 0 ? Math.min(declared, cap) : cap

	if (!(await reserveUploadBytes(pool, reservation)))
		return { error: fail("RATE_LIMITED", "Too many uploads at once. Wait a moment and try again") }

	try {
		return await bufferUploadForm(request, maxFileBytes)
	} finally {
		releaseUploadBytes(pool, reservation)
	}
}

type BoundedBody = { body: ArrayBuffer; reason?: never } | { body?: never; reason: "TOO_LARGE" | "UNREADABLE" }

/**
 * Read a request body into memory without letting the caller decide how much memory that spends.
 *
 * Content-Length is checked first (cheap, and what a normal client sends), then the stream is counted as it is read, so a chunked body cannot skip the check by omitting the header. Shared by the upload and webhook readers below, so the two cannot disagree about what the cap means.
 */
async function readBodyWithCap(request: Request, maxBytes: number): Promise<BoundedBody> {
	const declared = Number(request.headers.get("content-length") ?? "")
	if (Number.isFinite(declared) && declared > maxBytes) return { reason: "TOO_LARGE" }

	const { body } = request
	if (!body) return { body: new ArrayBuffer(0) }

	const reader = body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			total += value.byteLength
			if (total > maxBytes) {
				await reader.cancel().catch(() => undefined)
				return { reason: "TOO_LARGE" }
			}
			chunks.push(value)
		}
	} catch {
		return { reason: "UNREADABLE" }
	}
	return { body: new Uint8Array(Buffer.concat(chunks)).buffer }
}

/**
 * The parse itself, with the cap applied while the body streams in.
 *
 * The room in the budget is held for this and not for the whole request: the peak is here, where the chunks, the concatenated buffer and the multipart blob are all alive at once. What the caller does with the form afterwards is its own memory, and it is one copy rather than three.
 */
async function bufferUploadForm(request: Request, maxFileBytes: number): Promise<ParsedForm> {
	const cap = maxFileBytes + MULTIPART_OVERHEAD_BYTES
	const tooLarge = () => fail("VALIDATION_FAILED", `That upload is larger than ${maxFileBytes} bytes`)
	const invalid = () => fail("INVALID_BODY", "Expected a multipart form")

	const read = await readBodyWithCap(request, cap)
	if (!read.body) return { error: read.reason === "TOO_LARGE" ? tooLarge() : invalid() }

	// Rebuild a request so the runtime's multipart parser does the parsing rather than hand-rolling boundaries.
	const headers = new Headers(request.headers)
	headers.delete("content-length")
	const buffered = new Request(request.url, { body: read.body, headers, method: "POST" })
	const form = await buffered.formData().catch(() => null)
	return form ? { data: form } : { error: invalid() }
}

/**
 * A coarse per-instance limiter for authenticated write endpoints that have no other brake: ten requests a minute, and a refused request does not extend the block.
 *
 * Kept as a thin wrapper over `lib/rate-limit` so existing call sites keep their budget while the implementation lives in one place.
 */
export function rateLimitedInMemory(key: string, max = 10, windowMs = 60_000): boolean {
	return rateLimited(key, { max, windowMs })
}

/**
 * Largest webhook body accepted before signature verification: 1 MB.
 *
 * Webhook deliveries are small JSON, and the signature is verified over the raw bytes – so reading the whole body first is required, but an unsigned caller must not decide how much memory that read may spend. Slack and Ari deliveries beyond this are rejected before verification.
 */
export const MAX_WEBHOOK_BODY_BYTES = 1_000_000

/**
 * Read a request body as text without letting an unsigned caller decide how much memory the read may spend.
 *
 * Content-Length is checked first (cheap, and what a normal client sends), then the stream is counted as it is read, so a chunked body cannot skip the check by omitting the header. Null when the body is larger than the cap or cannot be read – the caller answers in its own error dialect.
 */
export async function readBoundedText(
	request: Request,
	maxBytes: number = MAX_WEBHOOK_BODY_BYTES,
): Promise<string | null> {
	const read = await readBodyWithCap(request, maxBytes)
	return read.body ? new TextDecoder().decode(read.body) : null
}

/**
 * Wraps a handler so a thrown HttpError becomes its proper response and anything else becomes a logged 500 instead of an unhandled rejection.
 *
 * Authenticated routes should use `withSession`, `withPermission` or `withRole` from `lib/guards` instead: those put the guard in front of the handler and pass the session in as `ctx.gate`, so a route cannot forget the check. This is the transport wrapper they, and the unauthenticated routes, are built on.
 */
export function withRoute<A extends unknown[]>(
	handler: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
	return async (...args: A) => {
		try {
			return await handler(...args)
		} catch (err) {
			if (err instanceof HttpError) return fail(err.code, err.message, err.details)
			console.error("[api] unhandled error:", err)
			return fail("INTERNAL", "Something went wrong")
		}
	}
}
