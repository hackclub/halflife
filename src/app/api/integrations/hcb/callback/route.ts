import { type NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/guards"
import { readStoredRefreshToken, storeRefreshToken } from "@/lib/hcb-credential"
import {
	HCB_OVERWRITE_COOKIE,
	HCB_STATE_COOKIE,
	HCB_VERIFIER_COOKIE,
	hcbRedirectUri,
	secretsMatch,
} from "@/lib/hcb-oauth"
import { Permission } from "@/lib/permissions"
import { isRecord } from "@/lib/unknown"

// A browser redirect from HCB that writes the credential, so it must run per request.
export const dynamic = "force-dynamic"

const DEFAULT_BASE = "https://hcb.hackclub.com"

/**
 * HCB's OAuth redirect target, and the one place the refresh token is obtained.
 *
 * It completes the authorization-code exchange itself and stores the refresh token in `hcb_credential`. That is deliberate: HCB revokes a refresh token when it is used, so a token copied by hand is a single-use string that is easy to paste from the wrong field of the response, and every copy is one mistake away from `invalid_grant`. Here the only secret in play is the client secret, which never leaves the server.
 *
 * The code branch requires the state and PKCE verifier that an admin's "Connect HCB" action put in this browser's cookies, a signed-in admin, and a top-level navigation. Without all of them the route would be writable by any `GET ?code=` a page could make a browser fetch – which is exactly how a journal image could have swapped the deployment's payout identity. The plain page stays public so the redirect URI can be checked before the app is authorised.
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

function response(body: string, status = 200): NextResponse {
	return new NextResponse(html("HCB OAuth callback", body), {
		headers: { "cache-control": "no-store", "content-type": "text/html; charset=utf-8" },
		status,
	})
}

/** Every completion answers once, so the state and verifier must not survive it. */
function clearOAuthCookies(res: NextResponse): NextResponse {
	for (const name of [HCB_STATE_COOKIE, HCB_VERIFIER_COOKIE, HCB_OVERWRITE_COOKIE])
		res.cookies.set(name, "", { httpOnly: true, maxAge: 0, path: "/", sameSite: "lax", secure: true })
	return res
}

function failed(message: string, detail: string, status: number): NextResponse {
	return clearOAuthCookies(
		response(
			`<h1>Could not connect HCB</h1>
<p>${escapeHtml(message)}</p>
<p><code>${escapeHtml(detail)}</code></p>
<p>Nothing was stored. Authorise again from <code>/admin/grants</code>, or check the deployment's HCB configuration.</p>`,
			status,
		),
	)
}

export async function GET(request: NextRequest): Promise<Response> {
	const url = new URL(request.url)
	const error = url.searchParams.get("error")
	const description = url.searchParams.get("error_description")
	const code = url.searchParams.get("code")
	const state = url.searchParams.get("state")

	// The bare page is public: it is the redirect URI, and an operator may land on it to check the path.
	if (!code && !error && !state)
		return response(`<h1>HCB OAuth callback</h1>
<p>This path is the redirect URI Half Life registers on its HCB application. Set <code>HCB_REDIRECT_URI</code> to the same URL.</p>
<p>To connect HCB, sign in as an admin and use <strong>Connect HCB</strong> on <code>/admin/grants</code>. That action starts the authorisation, and this page completes it. Normal operation uses only the refresh-token grant, so no redirect reaches this route after that.</p>`)

	// Only a browser navigating here may complete a flow. A journal image or any other subresource request cannot
	// carry a matching state cookie, and this makes that true even if one is somehow planted.
	if (request.headers.get("sec-fetch-dest") !== "document")
		return failed(
			"The authorisation has to come back as a page you opened, not a request another page made for you.",
			"not a top-level navigation",
			400,
		)

	const cookieState = request.cookies.get(HCB_STATE_COOKIE)?.value
	if (!state || !secretsMatch(cookieState ?? "", state))
		return failed(
			"The authorisation did not start from this deployment, or it took too long. Start again from /admin/grants.",
			"state mismatch",
			400,
		)

	if (error)
		return clearOAuthCookies(
			response(
				`<h1>HCB refused the authorisation</h1>
<p><code>${escapeHtml(error)}</code>${description ? ` – ${escapeHtml(description)}` : ""}</p>
<p>Nothing was written. Correct the application's scopes or redirect URI, then authorise again from /admin/grants.</p>`,
				400,
			),
		)

	if (!code) return failed("HCB did not return an authorisation code.", "missing code", 400)

	const gate = await requirePermission(Permission.MANAGE_PROGRAM)
	if (gate.error)
		return failed(
			"Sign in as an admin in this browser first, then start the connection again from /admin/grants.",
			"not signed in as an admin",
			403,
		)

	const id = process.env.HCB_CLIENT_ID?.trim()
	const secret = process.env.HCB_CLIENT_SECRET?.trim()
	const redirectUri = hcbRedirectUri()
	if (!id || !secret || !redirectUri)
		return failed(
			"HCB_CLIENT_ID, HCB_CLIENT_SECRET and HCB_REDIRECT_URI must all be set before the app can be authorised.",
			"missing configuration",
			503,
		)

	// A credential already in place is the deployment's working payout identity. Replacing it has to be the admin's
	// explicit choice at the start of the flow, so a code captured elsewhere cannot quietly take over payouts.
	const overwrite = request.cookies.get(HCB_OVERWRITE_COOKIE)?.value === "1"
	if (!overwrite && (await readStoredRefreshToken()) !== null)
		return failed(
			"HCB is already connected. Reconnect from /admin/grants if you mean to replace the stored credential.",
			"credential already stored",
			409,
		)

	const verifier = request.cookies.get(HCB_VERIFIER_COOKIE)?.value
	if (!verifier) return failed("The PKCE verifier for this authorisation is missing.", "missing code verifier", 400)

	const base = (process.env.HCB_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "")
	// The code is single-use, so a failure here cannot be retried with the same one; the operator re-authorises.
	const res = await fetch(`${base}/api/v4/oauth/token`, {
		body: new URLSearchParams({
			client_id: id,
			client_secret: secret,
			code,
			code_verifier: verifier,
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

	return clearOAuthCookies(
		response(`<h1>HCB connected</h1>
<p>The refresh token is stored encrypted and rotates automatically on each refresh. <code>HCB_REFRESH_TOKEN</code> is no longer needed; leave it unset unless you are seeding a headless deployment.</p>
<p>Load <code>/admin/grants</code> to confirm the balance reads.</p>`),
	)
}
