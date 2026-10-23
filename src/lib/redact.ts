/**
 * Scrubbing for log lines that interpolate upstream response bodies.
 *
 * A third party echoing a request back inside an error (Airtable, Slack, OAuth providers) would otherwise land a participant's email – or a token – in the logs. These helpers mask the value while keeping the shape, so the line is still useful for debugging.
 */

/**
 * An email address, as one match.
 *
 * Two things it must not do. A domain label cannot contain a dot, or the engine backtracks over every dot in a long string looking for the TLD: the old pattern's `[A-Za-z0-9.-]+` did exactly that, and a line of 200,000 characters took eight seconds to scrub. And the local part is capped at 64 characters, which is what RFC 5321 allows, and which stops the same scan running backwards over a string that holds no `@` at all – that case was quadratic too, and it is the common one, since a log line is usually not an email address.
 */
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const BEARER = /(Bearer\s+)[A-Za-z0-9\-._~+/=]{8,}/gi

/**
 * How much of a line is scrubbed.
 *
 * A log line is not a document. Past this the tail is noise, and the scrubber's cost grows with the length of what it is given, so the tail is dropped rather than scanned.
 */
const MAX_SCRUBBED_CHARS = 4_096

/** Mask emails and bearer-like tokens in free text. Non-strings pass through. */
function redactForLog(value: string): string
function redactForLog(value: unknown): unknown
function redactForLog(value: unknown): unknown {
	if (typeof value !== "string") return value
	const line = value.length > MAX_SCRUBBED_CHARS ? `${value.slice(0, MAX_SCRUBBED_CHARS)}…` : value
	return line.replaceAll(EMAIL, "[email]").replaceAll(BEARER, "$1[redacted]")
}

export { redactForLog }
