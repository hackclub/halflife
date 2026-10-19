import { NextResponse } from "next/server"

/**
 * The public origin a same-host redirect should point at.
 *
 * `new URL(path, request.url)` reads the host Next saw on the socket, which behind the ingress is the pod's own address (`0.0.0.0`, `10.x`) – so a logged-out visitor bounced through `/signed-out` landed on `http://0.0.0.0:3000/` instead of the site. The forwarded host/proto the ingress sets fixes that, but those headers are attacker-controlled unless the ingress overwrites them – so they are only trusted when they name a host we actually serve (L5). Anything else falls back to the `Host` header and request URL, which are the right answers for local development, where no proxy headers exist.
 *
 * Edge-safe on purpose: the proxy imports this, so no `server-only`, no node imports.
 */
const TRUSTED_HOST = /^([a-z0-9-]+\.)*k\.hackclub\.dev$/i
const TRUSTED_HOSTS = new Set(["halflife.hackclub.com"])

function isLoopbackHost(host: string): boolean {
	const bare = host.split(":")[0]?.toLowerCase() ?? ""
	return bare === "localhost" || bare.endsWith(".localhost") || bare === "[::1]" || bare.startsWith("127.")
}

function trustedForwardedHost(value: string | null): string | null {
	const host = value?.split(",")[0]?.trim()
	if (!host) return null
	// Pod/internal addresses and loopback are deliberately NOT trusted here: the Host header fallback already covers direct pod access and local development, and trusting a forwarded `10.x`/`0.0.0.0`/`localhost` would let a forged header steer redirects.
	if (TRUSTED_HOSTS.has(host.toLowerCase()) || TRUSTED_HOST.test(host)) return host
	return null
}

export function publicOrigin(request: { headers: Headers; url: string }): string {
	const forwardedHost = trustedForwardedHost(request.headers.get("x-forwarded-host"))
	const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase()
	const fallback = new URL(request.url)
	const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim() || fallback.host
	const proto =
		forwardedProto === "http" || forwardedProto === "https"
			? forwardedProto
			: fallback.protocol.replace(/:$/, "") || "https"
	// Public hosts are https-only; the ingress terminates TLS, so a forwarded `http` for one of them is a spoof, not a fact.
	const scheme = !isLoopbackHost(host) && proto !== "https" ? "https" : proto
	return `${scheme}://${host}`
}

/**
 * `NextResponse.redirect` to a same-origin path, staying on the public host. `NextResponse.redirect` requires an absolute URL, which is exactly what made the raw `new URL(path, request.url)` form leak the internal host.
 */
export function publicRedirect(
	request: { headers: Headers; url: string },
	path: string,
	status?: number,
): NextResponse {
	return NextResponse.redirect(new URL(path, publicOrigin(request)), status)
}
