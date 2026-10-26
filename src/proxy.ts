import { timingSafeEqual } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { contentSecurityPolicy } from "@/lib/csp"
import { publicRedirect } from "@/lib/public-origin"
import { PLATFORM_HOME } from "@/lib/routes"

/** Constant-time compare; lengths are not the secret. */
function matches(presented: string, expected: string): boolean {
	const a = Buffer.from(presented)
	const b = Buffer.from(expected)
	return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Security headers, and an optional HTTP basic auth gate for pre-launch.
 *
 * Deliberately does NOT do application auth: that lives in server components (lib/page-guards) and route handlers (lib/guards), where it has access to the database and can distinguish "not signed in" from "not permitted".
 */
function securityHeaders(res: NextResponse): NextResponse {
	res.headers.set("X-Frame-Options", "DENY")
	res.headers.set("X-Content-Type-Options", "nosniff")
	res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
	res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	// Applies to every origin, but harmless on plain http dev and the one header that stops a downgrade on the way to production.
	res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
	// A CSP without `script-src`/`style-src`: it cannot break the app's inline styles and scripts, but it closes framed pages, plugin content and form/post hijacking, and it stops an image or video from any host but our own and the identity CDNs from seeing every reader. A nonce-based script policy is a follow-up, not a launch-day change.
	res.headers.set("Content-Security-Policy", contentSecurityPolicy())
	return res
}

function unauthorized(): NextResponse {
	// With the headers the rest of the proxy sends: an error response that leaves them off is the one response a browser is most likely to be shown.
	return securityHeaders(
		new NextResponse("Authentication required", {
			headers: { "WWW-Authenticate": 'Basic realm="Half-Life"' },
			status: 401,
		}),
	)
}

/**
 * Is there plausibly a session on this request?
 *
 * Cookie PRESENCE only – nothing here is validated, and nothing may be decided on it that matters. It picks which page to render at `/`, and the page it picks runs the real check: `(app)` is guarded by `requireSessionPage`, so a forged cookie buys a trip to the landing page rather than a look at anyone's trail. Validating properly would mean a database round trip in front of every request on the site, including the static landing page, to save signed-in visitors one redirect.
 *
 * Both names are checked because better-auth adds the `__Secure-` prefix once the base URL is https, so the deployed cookie is not the one seen locally.
 */
function looksSignedIn(request: NextRequest): boolean {
	return request.cookies.has("better-auth.session_token") || request.cookies.has("__Secure-better-auth.session_token")
}

export function proxy(request: NextRequest): NextResponse | undefined {
	if (process.env.REQUIRE_BASICAUTH === "true") {
		const expectedUser = process.env.BASICAUTH_USERNAME
		const expectedPass = process.env.BASICAUTH_PASSWORD

		// Fail closed. An enabled gate with missing credentials used to fall through and serve the site, which is the exact opposite of what the operator who flipped the flag asked for.
		if (!expectedUser || !expectedPass)
			return securityHeaders(
				new NextResponse("Basic auth is enabled but BASICAUTH_USERNAME/BASICAUTH_PASSWORD are not set", {
					status: 503,
				}),
			)

		const header = request.headers.get("authorization") ?? ""
		const [scheme, encoded] = header.split(" ")
		if (scheme !== "Basic" || !encoded) return unauthorized()

		let decoded: string
		try {
			decoded = atob(encoded)
		} catch {
			// A non-base64 payload would otherwise throw and surface as a 500.
			return unauthorized()
		}
		const separator = decoded.indexOf(":")
		const user = separator === -1 ? decoded : decoded.slice(0, separator)
		const pass = separator === -1 ? "" : decoded.slice(separator + 1)
		// Both compared before the branch, so a failure time does not say which half was wrong.
		const userOk = matches(user, expectedUser)
		const passOk = matches(pass, expectedPass)
		if (!userOk || !passOk) return unauthorized()
	}

	/**
	 * `/` is the landing page; the platform lives at /dashboard.
	 *
	 * A signed-in visitor who lands on `/` is sent there with a redirect, not a rewrite, so the trail has one URL: the shell's Home tab, logo and first-run intro all point at /dashboard and read it back from `usePathname`, which a rewrite would leave reporting `/`.
	 *
	 * Two route groups cannot both define `/` – the landing page lives in `(site)` with its own root layout and stylesheet, the trail in `(app)` with the platform's – so this is what joins them.
	 */
	if (request.nextUrl.pathname === "/" && looksSignedIn(request))
		// Via the public origin, not `nextUrl.clone()`: behind the ingress the request URL carries the pod's own host (0.0.0.0). See lib/public-origin.
		return securityHeaders(publicRedirect(request, `${PLATFORM_HOME}${request.nextUrl.search}`))

	return securityHeaders(NextResponse.next())
}

export const config = {
	matcher: [
		// `api/integrations` is excluded so turning on basic auth for a staging deploy does not take every scheduled job red at once. `api/health` is excluded so the container healthcheck keeps working either way.
		//
		// `r/` and `api/handoff` are the phone-handoff pair. They are reached by scanning a QR code on a phone that has no session and no basic-auth credentials, so gating them would break the feature on exactly the deployments it is most useful on. They carry their own credential: a single-use token that expires in minutes. That covers the presign and confirm routes the direct upload uses as well as the older form route; the desktop half still requires a session.
		//
		// `api/slack` verifies Slack's HMAC itself and has to answer the Request URL verification while the pre-launch gate is still on, or the app cannot be set up.
		"/((?!_next/static|_next/image|favicon.ico|api/upload|api/integrations|api/slack|api/health|api/handoff|r/).*)",
	],
}
