import type { NextRequest } from "next/server"

// A browser redirect from HCB, so it must run per request and never be cached.
export const dynamic = "force-dynamic"

const DEFAULT_BASE = "https://hcb.hackclub.com"

/**
 * HCB's OAuth redirect target.
 *
 * The app never completes the authorisation-code grant itself: there is no credential store, and HCB rotates the refresh token on every use, so a token this route wrote to the database would still need an operator to rotate the stored copy. Instead it reserves the URI the HCB application is registered with, and when HCB sends a code it prints the one-line exchange for the operator to run; that response's `refresh_token` goes into `HCB_REFRESH_TOKEN`, or into whichever secret store supersedes the env var.
 *
 * It is deliberately unauthenticated. The caller is HCB's redirect in an operator's browser, which may hold no Half Life session, and the page carries nothing secret: the code is already in their address bar, and exchanging it needs the client secret.
 */
function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
}

/** One single-quoted shell word, so a code containing a quote cannot break out of the command. */
function shellQuote(value: string): string {
	return `'${value.replaceAll("'", String.raw`'\''`)}'`
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
pre { background: #000; border: 1px solid #333; border-radius: .5rem; overflow-x: auto; padding: 1rem; }
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

export function GET(request: NextRequest): Response {
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

	if (code) {
		const base = (process.env.HCB_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "")
		const command = `curl -sS ${base}/api/v4/oauth/token \\
  -d grant_type=authorization_code \\
  --data-urlencode "client_id=$HCB_CLIENT_ID" \\
  --data-urlencode "client_secret=$HCB_CLIENT_SECRET" \\
  --data-urlencode "redirect_uri=$HCB_REDIRECT_URI" \\
  --data-urlencode ${shellQuote(`code=${code}`)}`
		return response(`<h1>Authorisation code received</h1>
<p>Run this with <code>HCB_CLIENT_ID</code>, <code>HCB_CLIENT_SECRET</code> and <code>HCB_REDIRECT_URI</code> set, then put the response's <code>refresh_token</code> into <code>HCB_REFRESH_TOKEN</code>. Nothing was written to the database.</p>
<pre><code>${escapeHtml(command)}</code></pre>
<p>The token endpoint rotates the refresh token on every use, so the value in the environment is good only until the next refresh. See <code>docs/BACKEND.md</code> for the persisted-secret path.</p>`)
	}

	return response(`<h1>HCB OAuth callback</h1>
<p>This path is the redirect URI Half Life registers on its HCB application. Set <code>HCB_REDIRECT_URI</code> to the same URL.</p>
<p>Authorise once by hand: open HCB's <code>/api/v4/oauth/authorize</code> with this application's client id and the scopes it was registered with, let HCB redirect here, then run the command this page prints. Normal operation uses only the refresh-token grant, so no redirect reaches this route.</p>`)
}
