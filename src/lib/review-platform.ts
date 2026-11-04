import "server-only"
import { createHash, createHmac } from "node:crypto"
import { z } from "zod"
import { HttpError } from "@/lib/errors"
import type { ReviewShipInput } from "@/lib/review-ship"
import { isRecord } from "@/lib/unknown"

/**
 * The Review platform, spoken directly rather than through the Ari SDK.
 *
 * The wire format is Ari's, but the SDK refuses the nested `meta` Review needs for its BOM, hours and prior-review panels. This client signs `timestamp.body`, which is what Review's own documentation asks new senders for, and keeps the Review credentials entirely separate from Ari's so both can run side by side.
 */

const REVIEW_TIMEOUT_MS = 20_000

/** Review accepts 16 MiB. Refuse before the network so the operator gets a named limit rather than a bare 413. */
export const MAX_REVIEW_PAYLOAD_BYTES = 16 * 1024 * 1024

export type ReviewMode = "shadow" | "live"

export class ReviewApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly field?: string,
		readonly details?: unknown,
	) {
		super(message)
		this.name = "ReviewApiError"
	}
}

function required(name: string): string {
	const value = process.env[name]?.trim()
	if (!value) throw new HttpError("NOT_CONFIGURED", `${name} is not configured on this deployment`)
	return value
}

export function isReviewConfigured(): boolean {
	return Boolean(process.env.REVIEW_API_URL && process.env.REVIEW_PROGRAM && process.env.REVIEW_SIGNING_SECRET)
}

export function isReviewWebhookConfigured(): boolean {
	return Boolean(process.env.REVIEW_WEBHOOK_SECRET)
}

/** Shadow is the safe default: a deployment that omits the flag must never apply a Review decision. */
export function reviewMode(): ReviewMode {
	return process.env.REVIEW_MODE?.trim().toLowerCase() === "live" ? "live" : "shadow"
}

export function reviewBaseUrl(): string {
	return required("REVIEW_API_URL").replace(/\/$/, "")
}

export function reviewWebUrl(): string {
	return (process.env.REVIEW_BASE ?? process.env.REVIEW_API_URL ?? "").trim().replace(/\/$/, "")
}

/** The absolute webhook URL to register in the Review programme settings. */
export function reviewWebhookUrl(originFallback = ""): string {
	const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? originFallback).replace(/\/$/, "")
	return `${base}/api/integrations/review/webhook`
}

function reviewSignature(secret: string, timestamp: string, body: string): string {
	return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
}

const createResponseSchema = z.object({
	id: z.string().min(1),
	status: z.enum(["accepted", "duplicate"]),
	version: z.number().int().nonnegative().optional(),
})

const withdrawResponseSchema = z.object({
	id: z.string().min(1),
	status: z.string().min(1),
})

const statusResponseSchema = z.object({
	decision: z.string().nullable().optional(),
	external_id: z.string().min(1),
	id: z.string().min(1),
	phase: z.string().min(1),
	version: z.number().int().nonnegative(),
})

export interface ReviewShipCreated {
	id: string
	status: "accepted" | "duplicate"
	version?: number
}

export interface ReviewShipStatus {
	decision: string | null
	externalId: string
	id: string
	phase: string
	version: number
}

export interface ReviewWithdrawResult {
	id: string | null
	status: "not_queued" | "withdrawn"
}

const parityCheckSummarySchema = z.object({
	error: z.number().int().nonnegative(),
	fail: z.number().int().nonnegative(),
	overall: z.string(),
	pass: z.number().int().nonnegative(),
	running: z.number().int().nonnegative(),
	warn: z.number().int().nonnegative(),
})

const parityShipSchema = z.object({
	bomTotalCents: z.number().int().nonnegative(),
	checkSummary: parityCheckSummarySchema,
	externalId: z.string(),
	hoursApprovedSeconds: z.number().int().nonnegative().optional(),
	hoursClaimedSeconds: z.number().int().nonnegative(),
	id: z.string(),
	phase: z.string(),
	stage: z.number().int().nonnegative(),
	status: z.string(),
	updatedAt: z.string(),
	version: z.number().int().nonnegative(),
})

const parityResponseSchema = z.object({
	generatedAt: z.string(),
	ships: z.array(parityShipSchema),
})

export type ReviewParityShip = z.infer<typeof parityShipSchema>
export interface ReviewParity {
	generatedAt: string
	ships: ReviewParityShip[]
}

/** The read-only open-queue feed Review exposes for shadow comparison. */
export async function getReviewParity(): Promise<ReviewParity> {
	const response = await reviewRequest(`/api/v1/programs/${encodeURIComponent(required("REVIEW_PROGRAM"))}/parity`, {
		auth: "bearer",
		method: "GET",
	})
	return parityResponseSchema.parse(response)
}

async function reviewRequest(
	path: string,
	init: { auth: "bearer" | "signature"; body?: string; deliveryId?: string; method: "GET" | "POST" },
): Promise<unknown> {
	const url = new URL(path, `${reviewBaseUrl()}/`)
	const headers = new Headers({ Accept: "application/json" })

	if (init.auth === "bearer") headers.set("Authorization", `Bearer ${required("REVIEW_SIGNING_SECRET")}`)
	else if (init.body !== undefined) {
		const timestamp = Math.floor(Date.now() / 1000).toString()
		headers.set("Content-Type", "application/json")
		headers.set("X-Ari-Timestamp", timestamp)
		// Stable for the exact bytes, different for a changed body. Review records the id before it reads the ship, so a retry of the same send is a duplicate rather than a second version, while a resubmission after a project edit is a new delivery.
		headers.set("X-Ari-Delivery-Id", init.deliveryId ?? `hl-${createHash("sha256").update(init.body).digest("hex")}`)
		headers.set("X-Ari-Signature", reviewSignature(required("REVIEW_SIGNING_SECRET"), timestamp, init.body))
	}

	let response: Response
	try {
		response = await fetch(url, {
			body: init.body,
			cache: "no-store",
			headers,
			method: init.method,
			signal: AbortSignal.timeout(REVIEW_TIMEOUT_MS),
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		throw new ReviewApiError(0, "unavailable", `Review could not be reached: ${message}`)
	}

	const text = await response.text()
	let parsed: unknown = null
	if (text)
		try {
			parsed = JSON.parse(text)
		} catch {
			throw new ReviewApiError(response.status, "unreadable_response", "Review returned a body that is not JSON")
		}

	if (!response.ok) {
		const code =
			isRecord(parsed) && typeof parsed.code === "string"
				? parsed.code
				: isRecord(parsed) && typeof parsed.error === "string"
					? parsed.error
					: "api_error"
		const field = isRecord(parsed) && typeof parsed.field === "string" ? parsed.field : undefined
		const message =
			isRecord(parsed) && typeof parsed.error === "string"
				? parsed.error
				: `Review request failed with status ${response.status}`
		throw new ReviewApiError(response.status, code, message, field, parsed)
	}

	return parsed
}

/**
 * Create a ship. A 409 `already_queued` is expected and names the open ship; `alreadyQueuedReviewShip` reads it.
 *
 * The delivery id is scoped to the local submission and the exact body. A retry of the same hand-in is a duplicate; a resubmission is a new local submission and therefore a new id, even when the maker changed nothing. A bare body hash is not enough: after a withdraw, re-creating the same bytes would be treated as the delivery that was already processed and would not create version 2.
 */
export async function createReviewShip(input: ReviewShipInput, submissionId?: string): Promise<ReviewShipCreated> {
	const body = JSON.stringify(input)
	const bytes = new TextEncoder().encode(body).byteLength
	if (bytes > MAX_REVIEW_PAYLOAD_BYTES)
		throw new HttpError(
			"UNPROCESSABLE",
			`This submission is ${Math.ceil(bytes / (1024 * 1024))} MB, above Review's ${MAX_REVIEW_PAYLOAD_BYTES / (1024 * 1024)} MB limit`,
		)

	const hash = createHash("sha256").update(body).digest("hex").slice(0, 16)
	const response = await reviewRequest(`/api/ingest/${encodeURIComponent(required("REVIEW_PROGRAM"))}`, {
		auth: "signature",
		body,
		deliveryId: submissionId ? `hl-${submissionId}-${hash}` : undefined,
		method: "POST",
	})
	return createResponseSchema.parse(response)
}

/** Withdraw the open ship under an external id. A missing ship is already the state we wanted. */
export async function withdrawReviewShip(externalId: string): Promise<ReviewWithdrawResult> {
	try {
		const response = await reviewRequest(`/api/ingest/${encodeURIComponent(required("REVIEW_PROGRAM"))}/withdraw`, {
			auth: "signature",
			body: JSON.stringify({ external_id: externalId }),
			method: "POST",
		})
		const parsed = withdrawResponseSchema.parse(response)
		return { id: parsed.id, status: "withdrawn" }
	} catch (err) {
		if (err instanceof ReviewApiError && (err.status === 404 || err.code === "not_queued"))
			return { id: null, status: "not_queued" }
		throw err
	}
}

/** Read one ship, or null when Review has never heard of it. */
export async function getReviewShip(externalId: string): Promise<ReviewShipStatus | null> {
	try {
		const response = await reviewRequest(
			`/api/ingest/${encodeURIComponent(required("REVIEW_PROGRAM"))}/status?external_id=${encodeURIComponent(externalId)}`,
			{ auth: "bearer", method: "GET" },
		)
		const parsed = statusResponseSchema.parse(response)
		return {
			decision: parsed.decision ?? null,
			externalId: parsed.external_id,
			id: parsed.id,
			phase: parsed.phase,
			version: parsed.version,
		}
	} catch (err) {
		if (err instanceof ReviewApiError && err.status === 404) return null
		throw err
	}
}

/** The id and version from a 409 `already_queued`, or null for any other failure. */
export function alreadyQueuedReviewShip(err: unknown): { id: string; version?: number } | null {
	if (!(err instanceof ReviewApiError) || err.code !== "already_queued") return null
	if (!isRecord(err.details)) return null
	const { id, version } = err.details
	if (typeof id !== "string" || id.length === 0) return null
	return { id, ...(typeof version === "number" && Number.isInteger(version) ? { version } : {}) }
}

/**
 * A send failure a retry cannot fix, as the reason to store, or null when retrying may still work.
 *
 * A timeout, a 5xx and a 429 are what the retry job is for. A 4xx other than those means the payload or the secret is wrong, and replaying it hourly is the job talking to itself. A 401 is included deliberately: a wrong secret needs an operator, not another attempt.
 */
export function terminalReviewFailure(err: unknown): string | null {
	if (err instanceof HttpError && err.code === "UNPROCESSABLE") return err.message
	if (!(err instanceof ReviewApiError)) return null
	if (err.status === 0 || err.code === "already_queued") return null
	if (err.status === 408 || err.status === 425 || err.status === 429) return null
	if (err.status >= 400 && err.status < 500) return err.message
	return null
}
