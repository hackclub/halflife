import type { NextRequest, NextResponse } from "next/server"
import { publicRedirect } from "@/lib/public-origin"

/**
 * Where a page guard sends someone with no valid session: clear whatever session cookie they still carry, then go to the landing page.
 *
 * Not straight to `/`. The proxy sends a request for `/` on to the trail whenever a session cookie is merely present – it never validates one – so a stale or forged cookie would bounce between `/` and `/dashboard` forever. Only reached once `getSession` has already said no, so nothing cleared here was a working session.
 */
export function GET(request: NextRequest): NextResponse {
	// Redirect via the public origin, not `new URL("/", request.url)`: behind the ingress the request URL carries the pod's own host (0.0.0.0), which used to bounce logged-out visitors there. See lib/public-origin.
	const res = publicRedirect(request, "/")
	for (const { name } of request.cookies.getAll()) {
		if (!name.startsWith("better-auth.") && !name.startsWith("__Secure-better-auth.")) continue
		// A `__Secure-` cookie is only accepted, even to expire it, over a Set-Cookie that says Secure.
		res.cookies.set(name, "", { maxAge: 0, path: "/", secure: name.startsWith("__Secure-") })
	}
	return res
}
