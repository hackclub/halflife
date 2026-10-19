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
 * Parse an upload's multipart form without letting the caller decide how much memory the server spends before a single field can be read.
 *
 * `request.formData()` materialises the whole body first, and both upload routes check their size limits afterwards – fine for a small staff form, but a denial of service for an upload. The handoff path is deliberately unauthenticated and reads its token out of the form, so a limit checked after parsing arrives too late. Content-Length is checked first (cheap, and what a normal client sends), then the stream is counted as it is read, so a chunked request cannot skip the check by omitting the header.
 */
export async function parseUploadForm(request: Request, maxFileBytes: number): Promise<ParsedForm> {
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

	// Rebuild a request so the runtime's multipart parser does the parsing rather than hand-rolling boundaries.
	const headers = new Headers(request.headers)
	headers.delete("content-length")
	const buffered = new Request(request.url, { body: Buffer.concat(chunks), headers, method: "POST" })
	const form = await buffered.formData().catch(() => null)
	return form ? { data: form } : { error: invalid() }
}

/**
 * A coarse per-instance limiter for authenticated write endpoints that have no other brake. Resets on cold start and is not shared across instances, so it stops one account spending the process's memory or storage in a loop, not a distributed attacker.
 */
const limiterHits = new Map<string, number[]>()

/** How many distinct buckets a single process will hold before the oldest are evicted. */
const LIMITER_MAX_KEYS = 10_000

export function rateLimitedInMemory(key: string, max = 10, windowMs = 60_000): boolean {
	const now = Date.now()
	const recent = (limiterHits.get(key) ?? []).filter(at => now - at < windowMs)
	if (recent.length >= max) {
		limiterHits.set(key, recent)
		return true
	}
	recent.push(now)
	limiterHits.set(key, recent)
	// Evict the oldest buckets one at a time rather than clearing the map: a wholesale clear drops live buckets such as `upload:<userId>` along with the stale ones, which would hand a throttled caller a fresh budget.
	if (limiterHits.size > LIMITER_MAX_KEYS)
		for (const oldest of limiterHits.keys()) {
			if (limiterHits.size <= LIMITER_MAX_KEYS) break
			if (oldest !== key) limiterHits.delete(oldest)
		}
	return false
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
