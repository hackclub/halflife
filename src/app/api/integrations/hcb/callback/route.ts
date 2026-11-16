import type { NextRequest } from "next/server"
import { requirePermission } from "@/lib/guards"
import { storeRefreshToken } from "@/lib/hcb-credential"
import { Permission } from "@/lib/permissions"
import { isRecord } from "@/lib/unknown"

// A browser redirect from HCB that writes the credential, so it must run per request on Node.
export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const DEFAULT_BASE = "https://hcb.hackclub.com"

/**
 * HCB's OAuth redirect target, and the one place the refresh token is obtained.
 *
 * It completes the authorization-code exchange itself and stores the refresh token in `hcb_credential`. That is deliberate: HCB revokes a refresh token when it is used, so a token copied by hand is a single-use string that is easy to paste from the wrong field of the response, and every copy is one mistake away from `invalid_grant`. Here the only secret in play is the client secret, which never leaves the server.
 *
 * The code branch requires a signed-in admin: it writes a credential the whole deployment then acts with. The plain page stays public so the URI can be checked before the app is authorised.
 */
function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}

function html(title: string, body: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body { background: #111; color: #eee; font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; margin: 0; padding: 2rem; }
main { margin: 0 auto; max-width: 46rem; }
h1 { font-size: 1.25rem; }
p { max-width: 40rem; }
code { font-family: ui-monospace, monospace; }
</style>
</head>
<body><main>${body}</main></body>
</html>`
}

function response(body: string, status = 200): Response {
	return new Response(html("HCB OAuth callback", body), {
		headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" },
		status,
	})
}

function failed(message: string, detail: string, status: number): Response {
	return response(
		`<h1>Could not connect HCB</h1>
<p>${escapeHtml(message)}</p>
<p><code>${escapeHtml(detail)}</code></p>
<p>Nothing was stored. Authorise again from the start, or check the deployment's HCB configuration.</p>`,
		status,
	)
}

export async function GET(request: NextRequest): Promise<Response> {
	const url = new URL(request.url)
	const error = url.searchParams.get("error")
	const description = url.searchParams.get("error_description")
	const code = url.searchParams.get("code")

	if (error)
		return response(
			`<h1>HCB refused the authorisation</h1>
<p><code>${escapeHtml(error)}</code>${description ? ` – ${escapeHtml(description)}` : ""}</p>
<p>Nothing was written. Correct the application's scopes or redirect URI, then authorise again.</p>`,
			400,
		)

	if (!code)
		return response(`<h1>HCB OAuth callback</h1>
<p>This path is the redirect URI Half Life registers on its HCB application. Set <code>HCB_REDIRECT_URI</code> to the same URL.</p>
<p>Authorise the application once: open HCB's <code>/api/v4/oauth/authorize</code> with this application's client id and registered scopes while signed in as an organiser of the paying org. HCB redirects here, this page exchanges the code, and the rotating refresh token is stored encrypted. Normal operation uses only the refresh-token grant, so no redirect reaches this route after that.</p>`)

	const gate = await requirePermission(Permission.MANAGE_PROGRAM)
	if (gate.error)
		return response(
			`<h1>Sign in first</h1>
<p>The authorisation code arrived, but this browser is not signed in to Half Life as an admin, so nothing was stored.</p>
<p>Sign in, then open the HCB authorise link again – the code is single-use and expires quickly.</p>`,
			403,
		)

	const id = process.env.HCB_CLIENT_ID?.trim()
	const secret = process.env.HCB_CLIENT_SECRET?.trim()
	const redirectUri = process.env.HCB_REDIRECT_URI?.trim()
	if (!id || !secret || !redirectUri)
		return failed(
			"HCB_CLIENT_ID, HCB_CLIENT_SECRET and HCB_REDIRECT_URI must all be set before the app can be authorised.",
			"missing configuration",
			503,
		)

	const base = (process.env.HCB_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "")
	// The code is single-use, so a failure here cannot be retried with the same one; the operator re-authorises.
	const res = await fetch(`${base}/api/v4/oauth/token`, {
		body: new URLSearchParams({
			client_id: id,
			client_secret: secret,
			code,
			grant_type: "authorization_code",
			redirect_uri: redirectUri,
		}),
		headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
		method: "POST",
		signal: AbortSignal.timeout(15_000),
	})
	const data: unknown = await res.json().catch(() => null)
	const record = isRecord(data) ? data : {}
	const reason = typeof record.error === "string" ? record.error : `HTTP ${res.status}`
	const reasonDetail =
		typeof record.error_description === "string" ? record.error_description : "The token exchange returned no body."
	if (!res.ok) return failed("HCB refused the code exchange.", `${reason}: ${reasonDetail}`, 502)

	const refreshToken = typeof record.refresh_token === "string" ? record.refresh_token.trim() : ""
	if (!refreshToken) return failed("HCB accepted the code but returned no refresh token.", reasonDetail, 502)

	try {
		await storeRefreshToken(refreshToken)
	} catch (err) {
		// The code is now spent, so the operator has to authorise again; say so rather than leaving a half-connected app.
		console.error("[hcb] could not store the refresh token from the callback:", err)
		return failed(
			"HCB issued a token but this deployment could not store it.",
			err instanceof Error ? err.message : String(err),
			500,
		)
	}

	return response(`<h1>HCB connected</h1>
<p>The refresh token is stored encrypted and rotates automatically on each refresh. <code>HCB_REFRESH_TOKEN</code> is no longer needed; leave it unset unless you are seeding a headless deployment.</p>
<p>Load <code>/admin/grants</code> to confirm the balance reads.</p>`)
}
