/**
 * Boot-time configuration warnings.
 *
 * `PULL_HCA_PII` quietly disables itself when `PII_ENCRYPTION_KEY` is missing (see lib/hca-profile), which is safe but leaves every grant row without an address, so say so on every boot rather than finding out at payout time.
 *
 * The reverse – requesting PII scopes the HCA app does not hold – breaks every sign-in, and can only be checked on the HCA app itself; docs/RUNBOOK has it on the pre-launch list.
 */
export function register(): void {
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
