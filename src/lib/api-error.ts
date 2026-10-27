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
