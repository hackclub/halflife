import "server-only"

/**
 * A fetch for an external service this app depends on, with a short retry so a blip does not become a failed sign-in.
 *
 * The failure that prompted this: better-auth's OAuth callback calls a provider's `getUserInfo`, which fetches the identity endpoint. A single dropped packet or a slow moment at the provider made `AbortSignal.timeout` fire, the `TimeoutError` propagated through better-auth's callback with no catch of its own, the whole sign-in died, and the server logged a raw `TimeoutError` object – the DOM-exception constants and all – rather than a line anyone could act on.
 *
 * So this does two things the bare `fetch` did not:
 *
 * - **Retries once or twice** on a transport error or a 5xx, with a short back off. Those are the transient kind, and the second attempt usually lands. A 4xx is NOT retried: it is a real answer, and asking again cannot change it.
 *
 * - **Bounds the total memory.** A response body is read into memory, so the headers alone are not enough – a huge body would blow up after this returned. The length is capped, and a body over it is treated as a failed attempt, which is what a caller's retry-then-give-up wants.
 *
 * The intent is deliberately narrow: this is for the conversational third-party webhooks and OAuth handshakes where "one dropped packet" is the whole story. It is not a substitute for a client library, and it does not touch the repo reads in lib/github, which have their own retry, backoff and rate-limit lanes.
 */

/** Waits before each retry. A request gets at most `length` retries. */
export const RETRY_DELAYS_MS = [300, 1000]

/** The most a response body may be, in characters, before it is refused. */
const MAX_BODY_CHARS = 4 * 1024 * 1024

export interface FetchRetryOptions extends RequestInit {
	/** Attempts after the first. Defaults to `RETRY_DELAYS_MS.length`. */
	retries?: number
}

function unreachable(err: unknown): boolean {
	// Node/undici put the real cause on `.cause`; a bare TimeoutError from `AbortSignal.timeout` is its own. Both mean "no answer", which is worth another try – a rejection from the fetch itself (bad URL, bad options) is not.
	if (!(err instanceof Error)) return true
	const code = (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code
	if (
		code === "ECONNRESET"
		|| code === "ECONNREFUSED"
		|| code === "ETIMEDOUT"
		|| code === "EAI_AGAIN"
		|| code === "UND_ERR_CONNECT_TIMEOUT"
		|| code === "UND_ERR_SOCKET"
	)
		return true

	return err.name === "TimeoutError" || err.name === "AbortError" || err.name === "FetchError"
}

/** Read the body into memory, refusing one larger than the cap. */
async function boundedBody(res: Response): Promise<ArrayBuffer | null> {
	const declared = Number(res.headers.get("content-length") ?? "")
	if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) return null
	const text = await res.text()
	if (text.length > MAX_BODY_CHARS) return null
	return new TextEncoder().encode(text).buffer
}

/**
 * `fetch`, but a transport failure or a 5xx gets another attempt, and a response too large to be real is turned into one too.
 *
 * Resolves to the final `Response` for any status the server chose, including a 4xx and a 5xx that survived every retry – a non-2xx is a finding the caller decides about, not an exception. Throws when there is genuinely no answer to be had, with a message naming the endpoint.
 */
export async function fetchWithRetry(url: string | URL, options: FetchRetryOptions = {}): Promise<Response> {
	const retries = options.retries ?? RETRY_DELAYS_MS.length
	// `retries` is not a RequestInit field; strip it before handing the rest to fetch, which would otherwise be told about an option it does not know.
	const init: RequestInit = { ...options }
	delete (init as { retries?: number }).retries
	let lastError: unknown = null

	for (let attempt = 0; attempt <= retries; attempt++) {
		if (attempt > 0) await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1] ?? 1000))
		try {
			const res = await fetch(url, init)
			// A 5xx is worth another go; a 4xx is a real answer.
			if (res.status >= 500 && attempt < retries) {
				lastError = new Error(`HTTP ${res.status}`)
				continue
			}
			const body = await boundedBody(res)
			if (body === null) {
				lastError = new Error("response too large")
				continue
			}
			return new Response(body, { headers: res.headers, status: res.status, statusText: res.statusText })
		} catch (err) {
			lastError = err
			if (attempt < retries && unreachable(err)) continue
			throw err
		}
	}

	throw new Error(`No answer from ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}
