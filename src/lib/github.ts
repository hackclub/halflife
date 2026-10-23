import "server-only"
import { createSlot, sleep } from "@/lib/concurrency"
import type { Forge } from "@/lib/forge"

/**
 * The one way this app reads a repo through a forge's HTTP API.
 *
 * GitHub goes through Hack Club's gh-proxy when GH_PROXY_API_KEY is set, as Stasis does: the proxy spreads requests over a pool of donated tokens, so the budget is the pool's rather than one account's. Else the GitHub API with GITHUB_TOKEN (5,000 an hour), else unauthenticated (60 an hour for the whole server – fine on a dev machine, not in production).
 *
 * GitLab has no proxy and needs none: its API is generous and a check is a handful of requests. It is always called direct, with GITLAB_TOKEN when set (which only raises the ceiling – GitLab serves public projects without any token at all).
 *
 * What keeps a check answering, and the budget intact, is shared by both forges:
 *
 * - Retries. gh-proxy has transient failures of its own – a 503 with "Could not verify the API key" and a hint to retry with backoff, or a dropped connection – that clear within a second. Those are retried twice, briefly, before anything gives up.
 * - A fallback, GitHub only. If the proxy still fails, the request goes to GitHub directly, so a proxy outage costs direct budget rather than every maker's check.
 * - Backoff. When a route says slow down, every call on that route stops until the time it named, rather than each one finding out for itself. A rate-limited answer is the moment retries cost most. Routes back off separately: the proxy being limited says nothing about GitHub, and neither says anything about GitLab.
 * - A concurrency cap. A burst of hand-ins becomes a short queue instead of a spike against a forge's per-second limit.
 */

/**
 * How long one attempt may take. The proxy usually answers in a second or two but now and then sits on a request for twenty; cutting it off at six and asking again is faster than waiting, since the retry nearly always lands. Direct calls get longer: they are the last resort, and a big repo's file list can genuinely take a while.
 */
const TIMEOUT_MS: Record<Route, number> = { "github-direct": 10_000, "gitlab-direct": 10_000, proxy: 6_000 }

/** Slow attempts a route gets before we stop waiting on it. */
const MAX_TIMEOUTS = 2

/** In flight at once. Far under any forge's per-second quota, and plenty. */
const MAX_IN_FLIGHT = 6

/** Longest we will sit out a rate limit before asking again. */
const MAX_BACKOFF_MS = 15 * 60_000

/** Waits before each retry of a transient failure. */
const RETRY_DELAYS_MS = [300, 1000]

/** How a forge being unreachable reads to whoever asked. */
class ForgeUnavailableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ForgeUnavailableError"
	}
}

/**
 * A route is a forge plus a transport. GitHub has two (the proxy and its own API); GitLab has one. They are separate backoff lanes because being limited on one says nothing about the others.
 */
type Route = "proxy" | "github-direct" | "gitlab-direct"

const blockedUntil: Record<Route, number> = { "github-direct": 0, "gitlab-direct": 0, proxy: 0 }
const slot = createSlot(MAX_IN_FLIGHT)

/** How long a rate-limited answer asks us to wait, in ms, if it says. */
function backoffFrom(res: Response): number | null {
	const retryAfter = Number(res.headers.get("retry-after"))
	if (retryAfter > 0) return retryAfter * 1000
	// The proxy's own window, in seconds from now.
	const proxyReset = Number(res.headers.get("ratelimit-reset"))
	if (proxyReset > 0) return proxyReset * 1000
	// GitHub's and GitLab's, as an epoch second. GitLab sends `ratelimit-reset` too, so the line above covers it; `x-ratelimit-reset` is GitHub's spelling.
	const reset = Number(res.headers.get("x-ratelimit-reset"))
	if (reset > 0) return reset * 1000 - Date.now()
	return null
}

function isRateLimited(forge: Forge, res: Response) {
	if (res.status === 429) return true
	// GitHub says 403 for an exhausted quota; a plain 403 is something else.
	if (forge.id === "github") return res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0"
	// GitLab keeps its own header names and answers 429 (handled above).
	return res.status === 403 && res.headers.get("ratelimit-remaining") === "0"
}

/** The transport a forge's read calls take, and how they are addressed. */
function request(route: Route, path: string): { url: string; headers: { [_: string]: string } } {
	if (route === "proxy") {
		const apiKey = process.env.GH_PROXY_API_KEY
		if (!apiKey) throw new Error("GH_PROXY_API_KEY is not set on this deployment")
		return {
			headers: { Accept: "application/vnd.github+json", "X-API-Key": apiKey },
			url: `https://gh-proxy.hackclub.com/gh/${path}${path.includes("?") ? "&" : "?"}_t=${Date.now()}`,
		}
	}

	if (route === "gitlab-direct") {
		const token = process.env.GITLAB_TOKEN
		return {
			headers: {
				Accept: "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			url: `https://gitlab.com/api/v4/${path}`,
		}
	}

	const token = process.env.GITHUB_TOKEN
	return {
		headers: {
			Accept: "application/vnd.github+json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		url: `https://api.github.com/${path}`,
	}
}

/**
 * One route, with retries for what is worth retrying. Resolves to the forge's answer – any status it chose, including 404 – or throws ForgeUnavailableError.
 */
async function via(forge: Forge, route: Route, path: string): Promise<Response> {
	let why = `${forge.label} did not answer.`
	let timeouts = 0
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		if (Date.now() < blockedUntil[route])
			throw new ForgeUnavailableError(`${forge.label} is rate-limiting us right now.`)
		if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 1000)

		const { url, headers } = request(route, path)
		const release = await slot()
		let res: Response | null = null
		try {
			const raw = await fetch(url, { cache: "no-store", headers, signal: AbortSignal.timeout(TIMEOUT_MS[route]) })
			// Read the body here, inside the same timeout and the same retry. The timeout covers the download as well as the headers, so a slow file list used to abort mid-read in the caller – outside every catch – and surface as a 500. Buffered, a slow body is just a slow attempt.
			const body = await raw.arrayBuffer()
			res = new Response(body, { headers: raw.headers, status: raw.status, statusText: raw.statusText })
		} catch (err) {
			// The maker sees "did not answer"; the cause is for whoever runs this.
			console.warn(`[forge] ${forge.id} ${route} GET ${path} failed (attempt ${attempt + 1}):`, err)
			why = `${forge.label} did not answer.`
			// A route that keeps stalling is not worth a third wait.
			const stalled = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
			if (stalled && ++timeouts >= MAX_TIMEOUTS) break
		} finally {
			release()
		}
		if (!res) continue

		if (isRateLimited(forge, res)) {
			const wait = Math.min(MAX_BACKOFF_MS, Math.max(1000, backoffFrom(res) ?? 60_000))
			blockedUntil[route] = Math.max(blockedUntil[route], Date.now() + wait)
			throw new ForgeUnavailableError(`${forge.label} is rate-limiting us right now.`)
		}
		if (res.status >= 500) {
			const body = await res.text().catch(() => "")
			console.warn(
				`[forge] ${forge.id} ${route} GET ${path} → ${res.status} (attempt ${attempt + 1}): ${body.slice(0, 200)}`,
			)
			why = `${forge.label} returned an error (${res.status}).`
			continue
		}
		return res
	}
	throw new ForgeUnavailableError(why)
}

/**
 * GET a forge REST path, e.g. `repos/owner/repo/readme` on GitHub or `projects/owner%2Frepo` on GitLab.
 *
 * Resolves to the response for any status the forge answered with, including 404 – that is a finding, not a failure. Throws ForgeUnavailableError when there is no answer to be had on any route.
 */
export async function forgeGet(forge: Forge, path: string): Promise<Response> {
	if (forge.id === "gitlab") return via(forge, "gitlab-direct", path)

	if (!process.env.GH_PROXY_API_KEY) return via(forge, "github-direct", path)
	try {
		return await via(forge, "proxy", path)
	} catch (err) {
		if (!(err instanceof ForgeUnavailableError)) throw err
		console.warn(`[forge] proxy unavailable for ${path}, going to GitHub directly: ${err.message}`)
		return via(forge, "github-direct", path)
	}
}

export { ForgeUnavailableError }
