/**
 * The one place the E2E suite and its Next server agree on where everything is.
 *
 * Two things here are load-bearing. The database must be a throwaway `*_e2e` database on the loopback interface, because the reset script drops it; and every third-party endpoint is pointed at a dead local port, because a developer's `.env` is still merged into the server process for variables this file does not set.
 */

const DEFAULT_BASE_URL = "http://localhost:3100"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * A test run may only point at a scratch database. Both checks are cheap and both have already been the difference between "tests failed" and "the dev database disappeared".
 */
function safeDatabaseUrl(value: string): string {
	const url = new URL(value)
	const host = url.hostname
	const database = url.pathname.replace(/^\//, "")

	if (!LOOPBACK_HOSTS.has(host))
		throw new Error(`E2E_DATABASE_URL must be loopback, got ${host}. Point it at a scratch database.`)

	if (!/^[A-Za-z0-9_]+$/.test(database) || !database.endsWith("_e2e"))
		throw new Error(
			`E2E_DATABASE_URL database must end in _e2e, got "${database}". The test run drops and recreates it.`,
		)

	return value
}

function safeBaseUrl(value: string): string {
	const host = new URL(value).hostname
	if (!LOOPBACK_HOSTS.has(host)) throw new Error(`E2E_BASE_URL must be loopback, got ${host}.`)
	return value
}

export const e2eBaseUrl = safeBaseUrl(process.env.E2E_BASE_URL ?? DEFAULT_BASE_URL)
export const e2eDatabaseUrl = safeDatabaseUrl(
	process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/halflife_e2e",
)
export const e2eAuthSecret = process.env.E2E_AUTH_SECRET ?? "e2e-placeholder-secret-at-least-32-characters-long"

/** A loopback port nothing listens on: an accidental call fails immediately instead of reaching a real service. */
const deadEndpoint = "http://127.0.0.1:9"

/**
 * The environment handed to `next dev` / `next start`.
 *
 * Values here win over the checkout's `.env` because Next only fills in variables that are still undefined. That is why integrations are listed explicitly with dead values rather than left out: leaving one out would let the real `.env` value through.
 */
export const webServerEnv: { [_: string]: string } = {
	AIRTABLE_API_KEY: "e2e-disabled",
	AIRTABLE_BASE_ID: "e2e-disabled",
	AIRTABLE_RSVP_TABLE_ID: "e2e-disabled",
	AIRTABLE_TABLE_NAME: "e2e-disabled",
	AIRTABLE_UNIFIED_APPROVED_TABLE: "e2e-disabled",
	AIRTABLE_UNIFIED_BASE_ID: "e2e-disabled",
	AIRTABLE_YSWS_TABLE_ID: "e2e-disabled",
	APP_PUBLIC_HOSTS: "localhost,127.0.0.1",
	ARI_BASE: deadEndpoint,
	ARI_BASE_URL: deadEndpoint,
	ARI_COOKIE: "e2e-disabled",
	ARI_SIGNING_SECRET: "e2e-disabled",
	ARI_WEBHOOK_SECRET: "e2e-disabled",
	BETTER_AUTH_SECRET: e2eAuthSecret,
	BETTER_AUTH_URL: e2eBaseUrl,
	CACHET_BASE_URL: deadEndpoint,
	// `next.config.ts` treats CI as a deploy build and emits a standalone bundle, which `next start` refuses. The E2E build is ordinary, so the server must not see CI; the Playwright process still does.
	CI: "",
	DATABASE_URL: e2eDatabaseUrl,
	E2E_BLOCK_EXTERNAL_FETCH: "true",
	EXPORT_API_KEY: "e2e-export-key",
	GH_PROXY_API_KEY: "e2e-disabled",
	GITHUB_CLIENT_ID: "e2e-disabled",
	GITHUB_CLIENT_SECRET: "e2e-disabled",
	GITHUB_TOKEN: "e2e-disabled",
	GITLAB_CLIENT_ID: "e2e-disabled",
	GITLAB_CLIENT_SECRET: "e2e-disabled",
	GITLAB_TOKEN: "e2e-disabled",
	HACKATIME_API_BASE: deadEndpoint,
	HACKATIME_CLIENT_ID: "e2e-disabled",
	HACKATIME_CLIENT_SECRET: "e2e-disabled",
	HCA_AUTHORIZATION_URL: `${deadEndpoint}/oauth/authorize`,
	HCA_CLIENT_ID: "e2e-disabled",
	HCA_CLIENT_SECRET: "e2e-disabled",
	HCA_DISCOVERY_URL: `${deadEndpoint}/.well-known/openid-configuration`,
	HCA_ISSUER: deadEndpoint,
	HCA_JWKS_URL: `${deadEndpoint}/oauth/discovery/keys`,
	HCA_ME_URL: `${deadEndpoint}/api/v1/me`,
	HCA_TOKEN_URL: `${deadEndpoint}/oauth/token`,
	HCA_USERINFO_URL: `${deadEndpoint}/oauth/userinfo`,
	HCB_ACCESS_TOKEN: "e2e-disabled",
	HCB_BASE_URL: deadEndpoint,
	HCB_CLIENT_ID: "e2e-disabled",
	HCB_CLIENT_SECRET: "e2e-disabled",
	HCB_REFRESH_TOKEN: "e2e-disabled",
	INTEGRATION_API_KEY: "e2e-integration-key",
	LAPSE_API_BASE: deadEndpoint,
	LAPSE_CLIENT_ID: "e2e-disabled",
	LAPSE_CLIENT_SECRET: "e2e-disabled",
	LAPSE_WEB_BASE: deadEndpoint,
	NEXT_PUBLIC_APP_URL: e2eBaseUrl,
	NEXT_TELEMETRY_DISABLED: "1",
	PULL_HCA_PII: "false",
	REQUIRE_BASICAUTH: "false",
	S3_ACCESS_KEY_ID: "e2e-disabled",
	S3_BUCKET_NAME: "e2e-disabled",
	S3_ENDPOINT: deadEndpoint,
	S3_PUBLIC_URL: deadEndpoint,
	S3_SECRET_ACCESS_KEY: "e2e-disabled",
	SIGNUP_WEBHOOK_TOKEN: "e2e-disabled",
	SIGNUP_WEBHOOK_URL: deadEndpoint,
	SLACK_BOT_TOKEN: "e2e-disabled",
	SLACK_SIGNING_SECRET: "e2e-disabled",
	VERIFY_BASE_URL: deadEndpoint,
}
