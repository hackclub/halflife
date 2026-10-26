/**
 * Browser tests must not dial third parties.
 *
 * The suite points integration endpoints at a dead loopback port, but a checkout's `.env` can still supply a real key for a service whose endpoint is not configurable (Airtable is the one that bites: the landing page's sign-up counter asks it for a count). This guard turns any such fetch into an immediate, named failure instead of a live request, so a test cannot pass by reaching production.
 *
 * Gated on an env var that only the E2E server sets. In a normal build the variable is absent and the real `fetch` is left alone.
 */
function blockExternalFetch(): void {
	const originalFetch = globalThis.fetch
	const allowed = new Set(["localhost", "127.0.0.1", "[::1]"])

	globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		const url = new URL(raw)
		if (!allowed.has(url.hostname)) throw new Error(`[e2e] blocked an external request to ${url.origin}`)
		return originalFetch(input, init)
	}
}

/**
 * Boot-time configuration warnings.
 *
 * `PULL_HCA_PII` quietly disables itself when `PII_ENCRYPTION_KEY` is missing (see lib/hca-profile), which is safe but leaves every grant row without an address, so say so on every boot rather than finding out at payout time.
 *
 * The reverse – requesting PII scopes the HCA app does not hold – breaks every sign-in, and can only be checked on the HCA app itself; docs/RUNBOOK has it on the pre-launch list.
 */
export function register(): void {
	if (process.env.E2E_BLOCK_EXTERNAL_FETCH === "true") blockExternalFetch()

	if (process.env.PULL_HCA_PII === "true" && !process.env.PII_ENCRYPTION_KEY)
		console.error(
			"[config] PULL_HCA_PII=true but PII_ENCRYPTION_KEY is not set; address and birthday will not be stored",
		)

	// The healthcheck refuses to pass without BETTER_AUTH_SECRET (see /api/health). BETTER_AUTH_URL is not checked there because the request origin is a usable fallback, but a deployment behind a proxy wants the configured value, so say so on boot.
	if (!process.env.BETTER_AUTH_SECRET)
		console.error("[config] BETTER_AUTH_SECRET is not set; every page that touches auth will fail")
	if (!process.env.BETTER_AUTH_URL)
		console.error("[config] BETTER_AUTH_URL is not set; auth and webhook URLs will fall back to the request origin")
}
