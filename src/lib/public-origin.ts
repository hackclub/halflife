import { NextResponse } from "next/server"

/**
 * The public origin a same-host redirect should point at.
 *
 * `new URL(path, request.url)` reads the host Next saw on the socket, which
 * behind the ingress is the pod's own address (`0.0.0.0`, `10.x`) — so a
 * logged-out visitor bounced through `/signed-out` landed on
 * `http://0.0.0.0:3000/` instead of the site. Prefer the forwarded host/proto
 * the ingress sets; the `Host` header and request URL are fallbacks for local
 * development, where no proxy headers exist.
 *
 * Edge-safe on purpose: the proxy imports this, so no `server-only`, no node
 * imports.
 */
export function publicOrigin(request: { headers: Headers; url: string }): string {
	const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
	const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
	const fallback = new URL(request.url)
	const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim() || fallback.host
	const proto = forwardedProto || fallback.protocol.replace(/:$/, "")
	return `${proto}://${host}`
}

/**
 * `NextResponse.redirect` to a same-origin path, staying on the public host.
 * `NextResponse.redirect` requires an absolute URL, which is exactly what made
 * the raw `new URL(path, request.url)` form leak the internal host.
 */
export function publicRedirect(
	request: { headers: Headers; url: string },
	path: string,
	status?: number,
): NextResponse {
	return NextResponse.redirect(new URL(path, publicOrigin(request)), status)
}
