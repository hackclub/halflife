/**
 * Scrubbing for log lines that interpolate upstream response bodies.
 *
 * A third party echoing a request back inside an error (Airtable, Slack, OAuth providers) would otherwise land a participant's email – or a token – in the logs. These helpers mask the value while keeping the shape, so the line is still useful for debugging.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const BEARER = /(Bearer\s+)[A-Za-z0-9\-._~+/=]{8,}/gi

/** Mask emails and bearer-like tokens in free text. Non-strings pass through. */
export function redactForLog(value: string): string
export function redactForLog(value: unknown): unknown
export function redactForLog(value: unknown): unknown {
	if (typeof value !== "string") return value
	return value.replaceAll(EMAIL, "[email]").replaceAll(BEARER, "$1[redacted]")
}
