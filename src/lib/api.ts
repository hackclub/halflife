import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { API_ERROR_STATUS, type ApiErrorCode, HttpError } from "@/lib/errors"

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
 * One caller's bucket: the hits inside the window, and when the bucket was last touched.
 *
 * The two are not the same thing. A throttled caller is refused, so no hit is recorded – but they are still asking, and their bucket is still in use. Without the separate timestamp the bucket's recency would be its last *accepted* hit, which for a throttled caller is the oldest in the map: exactly the bucket that gets flushed.
 */
interface LimiterBucket {
	hits: number[]
	lastSeen: number
}

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

/** How long a request waits for room in the budget before it is refused. */
const UPLOAD_RESERVATION_WAIT_MS = 30_000

/** Bytes reserved by bodies being buffered right now. */
let reservedUploadBytes = 0

/** Requests waiting for room, in the order they asked. */
interface UploadWaiter {
	bytes: number
	resolve(granted: boolean): void
}
const uploadWaiters: UploadWaiter[] = []

/**
 * Hand the freed bytes to the first waiter they fit.
 *
 * First come, first served, and a waiter that does not fit is passed over rather than blocking the queue behind it: one large upload must not stop a hundred small ones from going through.
 */
function drainUploadWaiters(): void {
	for (let i = 0; i < uploadWaiters.length; ) {
		const waiter = uploadWaiters[i]
		if (!waiter) break
		if (reservedUploadBytes + waiter.bytes > UPLOAD_MEMORY_BUDGET_BYTES) {
			i += 1
			continue
		}
		reservedUploadBytes += waiter.bytes
		uploadWaiters.splice(i, 1)
		waiter.resolve(true)
	}
}

/**
 * Reserve room in the budget for a body, waiting for it if the budget is full.
 *
 * Waiting rather than refusing is what keeps a cohort upload working: the room is taken before the body is read, so a request that waits costs no memory of its own.
 */
function reserveUploadBytes(bytes: number): Promise<boolean> {
	if (reservedUploadBytes + bytes <= UPLOAD_MEMORY_BUDGET_BYTES) {
		reservedUploadBytes += bytes
		return Promise.resolve(true)
	}
	return new Promise<boolean>(resolve => {
		const waiter: UploadWaiter = { bytes, resolve }
		uploadWaiters.push(waiter)
		const timer = setTimeout(() => {
			const index = uploadWaiters.indexOf(waiter)
			if (index === -1) return
			uploadWaiters.splice(index, 1)
			resolve(false)
		}, UPLOAD_RESERVATION_WAIT_MS)
		// The timer must not be what keeps the process alive on its way out.
		timer.unref?.()
	})
}

/** Give the reservation back and let the queue move. */
function releaseUploadBytes(bytes: number): void {
	reservedUploadBytes = Math.max(0, reservedUploadBytes - bytes)
	drainUploadWaiters()
}

/**
 * Parse an upload's multipart form without letting the caller decide how much memory the server spends before a single field can be read.
 *
 * `request.formData()` materialises the whole body first, and both upload routes check their size limits afterwards – fine for a small staff form, but a denial of service for an upload. The handoff path is deliberately unauthenticated and reads its token out of the form, so a limit checked after parsing arrives too late. Content-Length is checked first (cheap, and what a normal client sends), then the stream is counted as it is read, so a chunked request cannot skip the check by omitting the header.
 */
export async function parseUploadForm(request: Request, maxFileBytes: number): Promise<ParsedForm> {
	const cap = maxFileBytes + MULTIPART_OVERHEAD_BYTES
	const declared = Number(request.headers.get("content-length") ?? "")
	const reservation = Number.isFinite(declared) && declared > 0 ? Math.min(declared, cap) : cap

	if (!(await reserveUploadBytes(reservation)))
		return { error: fail("RATE_LIMITED", "Too many uploads at once – wait a moment and try again") }

	try {
		return await bufferUploadForm(request, maxFileBytes)
	} finally {
		releaseUploadBytes(reservation)
	}
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

	const declared = Number(request.headers.get("content-length") ?? "")
	if (Number.isFinite(declared) && declared > cap) return { error: tooLarge() }

	const body = request.body
	if (!body) return { error: invalid() }

	const reader = body.getReader()
	const chunks: Uint8Array[] = []
	let total = 0
	try {
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			total += value.byteLength
			if (total > cap) {
				await reader.cancel().catch(() => undefined)
				return { error: tooLarge() }
			}
			chunks.push(value)
		}
	} catch {
		return { error: invalid() }
	}

	// Rebuild a request so the runtime's multipart parser does the parsing rather than hand-rolling boundaries. The chunks are released first: from here on only the joined buffer is needed, and the two together would be twice the body for nothing.
	const joined = Buffer.concat(chunks)
	chunks.length = 0
	const headers = new Headers(request.headers)
	headers.delete("content-length")
	const buffered = new Request(request.url, { body: joined, headers, method: "POST" })
	const form = await buffered.formData().catch(() => null)
	return form ? { data: form } : { error: invalid() }
}

/**
 * A coarse per-instance limiter for authenticated write endpoints that have no other brake. Resets on cold start and is not shared across instances, so it stops one account spending the process's memory or storage in a loop, not a distributed attacker.
 */
const limiterHits = new Map<string, LimiterBucket>()

/** How many distinct buckets a single process will hold before the oldest are evicted. */
const LIMITER_MAX_KEYS = 10_000

/**
 * The bucket to drop when the map is over its cap.
 *
 * A Map keeps its keys in the order they were first seen, so "the oldest key" is the bucket that was created first – and the bucket that was created first is the one a throttled caller owns, because they were the first to ask and they are still asking. Evicting by when the bucket was last touched instead drops the one nobody has come back to, and the caller's own bucket is never a candidate: dropping it would hand a throttled caller a fresh budget.
 */
function evictionVictim(buckets: Map<string, LimiterBucket>, exclude: string): string | null {
	let victim: string | null = null
	let oldest = Number.POSITIVE_INFINITY
	for (const [key, bucket] of buckets) {
		if (key === exclude) continue
		if (bucket.lastSeen >= oldest) continue
		oldest = bucket.lastSeen
		victim = key
	}
	return victim
}

export function rateLimitedInMemory(key: string, max = 10, windowMs = 60_000): boolean {
	const now = Date.now()
	const bucket = limiterHits.get(key)
	const recent = (bucket?.hits ?? []).filter(at => now - at < windowMs)
	const limited = recent.length >= max
	if (!limited) recent.push(now)
	// The bucket is touched either way: a refused caller is still a caller, and their bucket is still live.
	limiterHits.set(key, { hits: recent, lastSeen: now })
	// Evict the buckets that have gone longest without a touch, one at a time, rather than clearing the map: a wholesale clear drops live buckets such as `upload:<userId>` along with the stale ones, which would hand a throttled caller a fresh budget.
	while (limiterHits.size > LIMITER_MAX_KEYS) {
		const victim = evictionVictim(limiterHits, key)
		if (!victim) break
		limiterHits.delete(victim)
	}
	return limited
}

/**
 * Wraps a handler so a thrown HttpError becomes its proper response and anything else becomes a logged 500 instead of an unhandled rejection.
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
