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
