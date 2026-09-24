import "server-only"

/**
 * The one way this app talks to GitHub.
 *
 * Through Hack Club's gh-proxy when GH_PROXY_API_KEY is set, as Stasis does:
 * the proxy spreads requests over a pool of donated tokens, so the budget is
 * the pool's rather than one account's. Else the GitHub API with GITHUB_TOKEN
 * (5,000 an hour), else unauthenticated (60 an hour for the whole server —
 * fine on a dev machine, not in production).
 *
 * What keeps a check answering, and the budget intact:
 *
 * - Retries. The proxy has transient failures of its own — a 503 with "Could
 *   not verify the API key" and a hint to retry with backoff, or a dropped
 *   connection — that clear within a second. Those are retried twice, briefly,
 *   before anything gives up.
 * - A fallback. If the proxy still fails, the request goes to GitHub directly,
 *   so a proxy outage costs direct budget rather than every maker's check.
 * - Backoff. When a route says slow down, every call on that route stops until
 *   the time it named, rather than each one finding out for itself. A
 *   rate-limited answer is the moment retries cost most. The two routes back
 *   off separately: the proxy being limited says nothing about GitHub.
 * - A concurrency cap. A burst of hand-ins becomes a short queue instead of a
 *   spike against the proxy's per-second limit.
 */

/**
 * How long one attempt may take. The proxy usually answers in a second or two
 * but now and then sits on a request for twenty; cutting it off at six and
 * asking again is faster than waiting, since the retry nearly always lands.
 * GitHub directly gets longer: it is the last resort, and a big repo's file
 * list can genuinely take a while.
 */
const TIMEOUT_MS: Record<"proxy" | "direct", number> = { proxy: 6_000, direct: 10_000 }

/** Slow attempts a route gets before we stop waiting on it. */
const MAX_TIMEOUTS = 2

/** In flight at once. Far under the proxy's per-second quota, and plenty. */
const MAX_IN_FLIGHT = 6

/** Longest we will sit out a rate limit before asking again. */
const MAX_BACKOFF_MS = 15 * 60_000

/** Waits before each retry of a transient failure. */
const RETRY_DELAYS_MS = [300, 1000]

/** How GitHub being unreachable reads to whoever asked. */
export class GitHubUnavailable extends Error {}

type Route = "proxy" | "direct"

const blockedUntil: Record<Route, number> = { proxy: 0, direct: 0 }
let inFlight = 0
const waiting: (() => void)[] = []

async function slot(): Promise<() => void> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((go) => waiting.push(go))
  inFlight++
  return () => {
    inFlight--
    waiting.shift()?.()
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** How long a rate-limited answer asks us to wait, in ms, if it says. */
function backoffFrom(res: Response): number | null {
  const retryAfter = Number(res.headers.get("retry-after"))
  if (retryAfter > 0) return retryAfter * 1000
  // The proxy's own window, in seconds from now.
  const proxyReset = Number(res.headers.get("ratelimit-reset"))
  if (proxyReset > 0) return proxyReset * 1000
  // GitHub's, as an epoch second — passed through by the proxy too.
  const githubReset = Number(res.headers.get("x-ratelimit-reset"))
  if (githubReset > 0) return githubReset * 1000 - Date.now()
  return null
}

function isRateLimited(res: Response) {
  if (res.status === 429) return true
  // GitHub says 403 for an exhausted quota; a plain 403 is something else.
  return res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0"
}

function request(route: Route, path: string): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
  if (route === "proxy") {
    headers["X-API-Key"] = process.env.GH_PROXY_API_KEY!
    // The proxy caches for minutes; a maker who has just pushed should not be
    // told about the repo as it was. Our own short cache (lib/repo-checks) is
    // what folds repeat checks together.
    const sep = path.includes("?") ? "&" : "?"
    return { url: `https://gh-proxy.hackclub.com/gh/${path}${sep}_t=${Date.now()}`, headers }
  }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return { url: `https://api.github.com/${path}`, headers }
}

/**
 * One route, with retries for what is worth retrying. Resolves to GitHub's
 * answer — any status it chose, including 404 — or throws GitHubUnavailable.
 */
async function via(route: Route, path: string): Promise<Response> {
  let why = "GitHub did not answer."
  let timeouts = 0
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (Date.now() < blockedUntil[route]) {
      throw new GitHubUnavailable("GitHub is rate-limiting us right now.")
    }
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 1000)

    const { url, headers } = request(route, path)
    const release = await slot()
    let res: Response | null = null
    try {
      const raw = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS[route]) })
      // Read the body here, inside the same timeout and the same retry. The
      // timeout covers the download as well as the headers, so a slow file
      // list used to abort mid-read in the caller — outside every catch —
      // and surface as a 500. Buffered, a slow body is just a slow attempt.
      const body = await raw.arrayBuffer()
      res = new Response(body, { status: raw.status, statusText: raw.statusText, headers: raw.headers })
    } catch (err) {
      // The maker sees "did not answer"; the cause is for whoever runs this.
      console.warn(`[github] ${route} GET ${path} failed (attempt ${attempt + 1}):`, err)
      why = "GitHub did not answer."
      // A route that keeps stalling is not worth a third wait.
      // A timeout before the headers is a TimeoutError; one during the body
      // read surfaces as an AbortError. Both are the route stalling.
      const stalled = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")
      if (stalled && ++timeouts >= MAX_TIMEOUTS) break
    } finally {
      release()
    }
    if (!res) continue

    if (isRateLimited(res)) {
      const wait = Math.min(MAX_BACKOFF_MS, Math.max(1000, backoffFrom(res) ?? 60_000))
      blockedUntil[route] = Math.max(blockedUntil[route], Date.now() + wait)
      throw new GitHubUnavailable("GitHub is rate-limiting us right now.")
    }
    if (res.status >= 500) {
      const body = await res.text().catch(() => "")
      console.warn(`[github] ${route} GET ${path} → ${res.status} (attempt ${attempt + 1}): ${body.slice(0, 200)}`)
      why = `GitHub returned an error (${res.status}).`
      continue
    }
    return res
  }
  throw new GitHubUnavailable(why)
}

/**
 * GET a GitHub REST path, e.g. `repos/owner/repo/readme`.
 *
 * Resolves to the response for any status GitHub answered with, including
 * 404 — that is a finding, not a failure. Throws GitHubUnavailable when there
 * is no answer to be had on any route.
 */
export async function gh(path: string): Promise<Response> {
  if (!process.env.GH_PROXY_API_KEY) return via("direct", path)
  try {
    return await via("proxy", path)
  } catch (err) {
    if (!(err instanceof GitHubUnavailable)) throw err
    console.warn(`[github] proxy unavailable for ${path}, going to GitHub directly: ${err.message}`)
    return via("direct", path)
  }
}
