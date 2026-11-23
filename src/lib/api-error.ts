// oxlint-disable eslint/max-classes-per-file -- the two errors are the one distinction a caller makes: the server refused, or its answer was unusable. Splitting them would put a one-line class in its own file for no reader's benefit.
import { z } from "zod"
import { messageOf } from "@/lib/errors"
import { isRecord } from "@/lib/unknown"

/**
 * The message out of an API error body.
 *
 * Every fetch in the app reads the same `{ error: { message } }` envelope, and each one used to assert that shape before reading it, so a proxy's HTML page or a truncated body could pass the check and fail one property access later. This checks instead, and falls back to the message the caller wanted to show anyway.
 */
export function errorMessage(payload: unknown, fallback: string): string {
	if (!isRecord(payload)) return fallback
	const { error } = payload
	if (!isRecord(error)) return fallback
	const { message } = error
	return typeof message === "string" ? message : fallback
}

/**
 * The code out of an API error body.
 *
 * A message is for the reader; the code is for the caller that has a different next step to offer – "you already have one, here are your orders" rather than another attempt. Read without assuming the body is the envelope, like `errorMessage`.
 */
export function errorCode(payload: unknown): string | undefined {
	if (!isRecord(payload)) return undefined
	const { error } = payload
	if (!isRecord(error)) return undefined
	const { code } = error
	return typeof code === "string" ? code : undefined
}

/**
 * The message for a refusal whose body is not the app's envelope.
 *
 * A proxy's HTML page, a gateway timing out, or a body cut short leaves nothing to quote, so the status is the one detail worth passing on – it is what turns "something went wrong" into a report someone can act on. Only a signed-out answer is common and actionable enough to say in words rather than numbers.
 *
 * `fallback` is the phrase the caller would show anyway, without a full stop; the status is appended to it.
 */
export function refusalMessage(status: number, fallback: string): string {
	if (status === 401) return "You are signed out. Refresh the page and sign in again."
	if (status === 502 || status === 503 || status === 504)
		return `${fallback} (HTTP ${status}). This is usually temporary – try again in a minute.`
	return `${fallback} (HTTP ${status}). Try again.`
}

/**
 * A refusal, thrown rather than returned as a value.
 *
 * The sentence is the server's own when it sent one, and `refusalMessage` for the status otherwise, so a caller that only wants to show something is covered. `code` is there for the few callers that branch – a purchase limit offers the orders page, not another attempt.
 */
export class ApiRequestError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly code?: string,
	) {
		super(message)
		this.name = "ApiRequestError"
	}
}

/** A 2xx answer whose body was not the shape the caller's schema describes. Its own class so a caller can tell a broken answer from a refusal. */
export class ApiResponseShapeError extends Error {
	constructor() {
		super("The server's answer was not in the expected shape")
		this.name = "ApiResponseShapeError"
	}
}

/**
 * A success body the caller does not read.
 *
 * The read is still worth doing: it is what turns a refusal into the server's sentence, and what tells a proxy's HTML page or an empty body from a real answer. Only the payload itself is discarded.
 */
export const ignoredBody = z.unknown()

/**
 * Fetch and read one JSON answer, refusing with the server's own words.
 *
 * This is the client's copy of the error readers above, for the shape every call site was already writing by hand: read the body without assuming it is JSON – a proxy's HTML page and a 204 both fail to parse – refuse with `errorMessage`, then parse the payload with the caller's schema. Doing it once keeps the four decisions (what a refusal says, what a broken body says, what a wrong shape says, what an empty success body is) in one place instead of at every call site.
 *
 * `fallback` is only for a refusal with no body of the app's envelope; the status is appended, as `refusalMessage` does. A caller that needs the parsed payload of a success rather than a schema's output should read it with `errorMessage` itself – this returns the schema's output.
 */
export async function readJson<S extends z.ZodType>(res: Response, schema: S, fallback: string): Promise<z.output<S>> {
	const payload: unknown = await res.json().catch(() => null)
	if (!res.ok)
		throw new ApiRequestError(
			res.status,
			errorMessage(payload, refusalMessage(res.status, fallback)),
			errorCode(payload),
		)

	if (payload === null) throw new ApiResponseShapeError()
	const parsed = schema.safeParse(payload)
	if (!parsed.success) throw new ApiResponseShapeError()
	return parsed.data
}

/**
 * The sentence for a `readJson` that threw.
 *
 * A refusal already carries the server's words. A broken answer is the caller's `shape` line: only the caller knows what it was drawing, and naming the failure is better than "something went wrong". A `fetch` that never got a response rejects with a `TypeError`, whose own text ("Failed to fetch") says nothing a reader can use, so it gets the `unreachable` line. The defaults keep the two-argument call honest for a panel that shows one phrase either way.
 */
export function readErrorMessage(err: unknown, shape: string, unreachable: string = shape): string {
	if (err instanceof ApiRequestError) return err.message
	if (err instanceof ApiResponseShapeError) return shape
	return err instanceof TypeError ? unreachable : messageOf(err)
}
