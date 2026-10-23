import { NextResponse } from "next/server"
import { configuredOrigin, hostName, isLoopbackHost, isPublicHost } from "@/lib/origin"

/**
 * The public origin a same-host redirect should point at.
 *
 * `new URL(path, request.url)` reads the host Next took off the request – the `Host` header, or the ingress's rewrite of it – which behind the ingress is the pod's own address (`0.0.0.0`, `10.x`) – so a logged-out visitor bounced through `/signed-out` landed on `http://0.0.0.0:3000/` instead of the site. The forwarded host/proto the ingress sets fixes that, but those headers are attacker-controlled unless the ingress overwrites them – so they are only trusted when they name a host we actually serve.
 *
 * The order is the whole answer to it:
 *
 * 1. the configured origin (`NEXT_PUBLIC_APP_URL`, then `BETTER_AUTH_URL`) – the deployment's own answer, and the only one a caller cannot steer;
 * 2. the forwarded host, when it names a host we serve – the ingress's answer, and still only ours;
 * 3. the request's own host, but only a loopback one – a laptop, where there is no proxy and the host is the one the developer typed.
 *
 * Never an arbitrary `Host`. That header is as caller-controlled as `x-forwarded-host` is, and a redirect built from it answers `307 Location: https://<whatever the caller asked for>/` – an open redirect, on `/`, on `/signed-out` and on the auth callback. The pod's own address is not a fallback either (a QR pointing at `10.x` is a QR nobody's phone can reach), so a deployment that configures nothing has no origin to name and the callers fail closed instead.
 *
 * Edge-safe on purpose: the proxy imports this, so no `server-only`, no node imports.
 */
function publicOrigin(request: { headers: Headers; url: string }): string | null {
	const configured = configuredOrigin()
	if (configured) return configured

	const forwarded = trustedForwardedHost(request.headers.get("x-forwarded-host"))
	if (forwarded) return `https://${forwarded}`

	// The request's own host, but only a laptop's. A loopback name cannot be steered at
	// a host somebody else owns; every other name in the `Host` header is the caller's.
	const host = request.headers.get("host")?.split(",")[0]?.trim() ?? ""
	if (!isLoopbackHost(host)) return null
	return `${requestProtocol(request)}://${host}`
}

/**
 * The forwarded host, when it names a host we serve.
 *
 * The ingress sets `x-forwarded-host` to the public host, but a caller can send it as well, so it is only believed when it names one of our own hosts. Pod/internal addresses and loopback are deliberately NOT trusted here: the loopback fallback already covers a laptop, and trusting a forwarded `10.x`/`0.0.0.0`/`localhost` would let a forged header steer redirects.
 */
function trustedForwardedHost(value: string | null): string | null {
	const host = value?.split(",")[0]?.trim() ?? ""
	if (!host) return null
	const name = hostName(host)
	if (!name || !isPublicHost(name)) return null
	// The host as it came, so a deployment on a port of its own keeps it. The parse
	// above is what proves the value is a plain host and not something else.
	return host
}

/** The scheme the request arrived on, for the loopback case. */
function requestProtocol(request: { url: string }): string {
	try {
		return new URL(request.url).protocol.replace(/:$/, "") || "http"
	} catch {
		return "http"
	}
}

/**
 * `NextResponse.redirect` to a same-origin path, staying on the public host. `NextResponse.redirect` requires an absolute URL, which is exactly what made the raw `new URL(path, request.url)` form leak the internal host.
 *
 * With no origin to name – a deployment that configures none and is not a laptop – the Location is the path itself. The browser resolves that against the host it is already on, so the redirect still works and still cannot be pointed anywhere else.
 */
function publicRedirect(request: { headers: Headers; url: string }, path: string, status?: number): NextResponse {
	const origin = publicOrigin(request)
	if (!origin) {
		const response = new NextResponse(null, { status: status ?? 307 })
		response.headers.set("Location", path)
		return response
	}
	return NextResponse.redirect(new URL(path, origin), status)
}

export { publicOrigin, publicRedirect }
