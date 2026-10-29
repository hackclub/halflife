import "server-only"
import { z } from "zod"
import { sleep } from "@/lib/concurrency"

const API_BASE = "https://api.airtable.com/v0"

export interface AirtableConfig {
	apiKey: string
	baseId: string
}

/**
 * Returns null when credentials are absent, and every write path no-ops with a warning. Local development works with no Airtable at all, and a rotated key never 500s a participant's request.
 */
export function getAirtableConfig(): AirtableConfig | null {
	const apiKey = process.env.AIRTABLE_API_KEY
	const baseId = process.env.AIRTABLE_BASE_ID
	if (!apiKey || !baseId) return null
	return { apiKey, baseId }
}

/**
 * Sanitise a value for interpolation into a filterByFormula string.
 *
 * Strip control characters, then escape backslashes, then quotes – in that order. Escaping quotes first would double-escape the backslashes you just inserted. Every formula interpolation goes through this: siege's duplicate check interpolates a URL raw, which is a formula-injection hole, and stasis has one call site that hand-rolls the replace and misses the control characters.
 */
export function escapeAirtableValue(value: string): string {
	// Strip control characters by code point rather than with a regex: the rule that reads patterns cannot see that removing them is the job.
	const clean = Array.from(value).filter(char => {
		const code = char.codePointAt(0) ?? 0
		return code > 31 && code !== 127
	})
	return clean.join("").replaceAll("\\", String.raw`\\`).replaceAll("'", String.raw`\'`)
}

export class AirtableError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: string,
	) {
		super(message)
		this.name = "AirtableError"
	}

	get isRateLimit(): boolean {
		return this.status === 429
	}

	get isPermission(): boolean {
		return this.status === 403 || this.status === 401
	}
}

// Airtable allows 5 requests/second/base. A shared token bucket is stricter than siege's per-job `sleep 0.25`, which only works because its sync is a single serialised job – here several request handlers can hit Airtable at once and each be individually well behaved while collectively exceeding the cap.
const MIN_INTERVAL_MS = 210
let nextSlot = 0

async function throttle(): Promise<void> {
	const now = Date.now()
	const slot = Math.max(now, nextSlot)
	nextSlot = slot + MIN_INTERVAL_MS
	const wait = slot - now
	if (wait > 0) await sleep(wait)
}

/**
 * Retry wrapper for the rate limit. A 429 gets Airtable's documented 30-second penalty; anything else transient gets exponential backoff with jitter. Ported from siege's `with_rate_limit_retry`, which stasis has no equivalent of at all.
 *
 * `retryServerErrors` is for non-idempotent calls: a 5xx or a timeout can arrive after Airtable committed the write, so retrying a create duplicates the row. A 429 is always safe – the request was never processed.
 */
export async function withRateLimitRetry<T>(
	operation: string,
	fn: () => Promise<T>,
	opts: { maxAttempts?: number; baseSleepMs?: number; retryServerErrors?: boolean } = {},
): Promise<T> {
	const maxAttempts = opts.maxAttempts ?? 5
	const baseSleepMs = opts.baseSleepMs ?? 1000
	const retryServerErrors = opts.retryServerErrors ?? true

	for (let attempt = 1; ; attempt++)
		try {
			await throttle()
			return await fn()
		} catch (err) {
			const isRateLimit = err instanceof AirtableError && err.isRateLimit
			const isTransient = isRateLimit || (retryServerErrors && err instanceof AirtableError && err.status >= 500)
			if (!isTransient || attempt >= maxAttempts) throw err

			const wait = isRateLimit ? 30_000 : baseSleepMs * 2 ** (attempt - 1) + Math.random() * 500
			console.warn(
				`[airtable] ${operation} attempt ${attempt} failed (${err instanceof Error ? err.message : err}); retrying in ${Math.round(wait)}ms`,
			)
			await sleep(wait)
		}
}

/**
 * The detail Airtable's error envelope carries, for the error's own message.
 *
 * `Airtable 422 on <path>` alone sends the reader to the stack trace and the raw body to learn why, and the body is logged as an unread object. The type and message are short and name the difference between a column it did not recognise and a parameter it does not accept at all, so they belong in the message. The raw body stays on the error for callers that match on it.
 */
function refusalDetail(body: string): string {
	try {
		const parsed = z
			.object({ error: z.object({ message: z.string(), type: z.string().optional() }) })
			.safeParse(JSON.parse(body))
		if (!parsed.success) return ""
		const { message, type } = parsed.data.error
		return `: ${type ? `${type} – ${message}` : message}`
	} catch {
		// Not JSON: a proxy page or a body cut short says nothing worth quoting.
		return ""
	}
}

export async function airtableFetch<S extends z.ZodType>(
	schema: S,
	config: AirtableConfig,
	path: string,
	init: RequestInit = {},
): Promise<z.infer<S>> {
	const headers = new Headers({
		Authorization: `Bearer ${config.apiKey}`,
		"Content-Type": "application/json",
	})
	for (const [key, value] of new Headers(init.headers)) headers.set(key, value)

	const res = await fetch(`${API_BASE}/${config.baseId}/${path}`, {
		...init,
		cache: "no-store",
		headers,
		signal: AbortSignal.timeout(20_000),
	})
	if (!res.ok) {
		const body = await res.text().catch(() => "")
		throw new AirtableError(`Airtable ${res.status} on ${path}${refusalDetail(body)}`, res.status, body)
	}
	return schema.parse(await res.json())
}

/** One Airtable record. `fields` stays open because each table has its own columns. */
export const AirtableRecordSchema = z.object({
	createdTime: z.string().optional(),
	fields: z.record(z.string(), z.unknown()),
	id: z.string(),
})
export type AirtableRecord = z.infer<typeof AirtableRecordSchema>

/** A list page: the records plus the cursor for the next one. */
export const AirtableListSchema = z.object({ offset: z.string().optional(), records: z.array(AirtableRecordSchema) })

/** A create, which reports the id of the row it made. */
export const AirtableCreatedSchema = z.object({ id: z.string() })

/** A delete by id, which reports whether the row went. */
export const AirtableDeletedSchema = z.object({ deleted: z.boolean() })

/** A delete by query, which reports the ids it removed. */
export const AirtableDeletedRecordsSchema = z.object({ records: z.array(z.object({ id: z.string() })) })

/** An upsert: the records written, and the ids that were updated rather than created. */
export const AirtableUpsertSchema = AirtableListSchema.extend({ updatedRecords: z.array(z.string()).optional() })

/** Chunk into batches of 10, Airtable's per-request record limit. */
export function chunk<T>(items: T[], size = 10): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
	return out
}
