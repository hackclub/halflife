import type { NextRequest, NextResponse } from "next/server"
import { publicRedirect } from "@/lib/public-origin"

/**
 * Where a page guard sends someone with no valid session: clear whatever session cookie they still carry, then go to the landing page.
 *
 * Not straight to `/`. The proxy sends a request for `/` on to the trail whenever a session cookie is merely present – it never validates one – so a stale or forged cookie would bounce between `/` and `/dashboard` forever. Only reached once `getSession` has already said no, so nothing cleared here was a working session.
 *
 * Cookies are only cleared on a top-level navigation. Without that, any `![x](/signed-out)` in a journal entry logs out every viewer: the browser loads the "image", the response carries expired session cookies, and the viewer is signed out. Subresource loads send `Sec-Fetch-Dest: image` (navigations send `document`), so those get the redirect without the cookie clearing. A missing header (old browsers, privacy extensions) still clears – the legitimate use is a navigation, and failing open here only risks logging someone out, never keeping them in.
 */
export function GET(request: NextRequest): NextResponse {
	// Redirect via the public origin, not `new URL("/", request.url)`: behind the ingress the request URL carries the pod's own host (0.0.0.0), which used to bounce logged-out visitors there. See lib/public-origin.
	const res = publicRedirect(request, "/")
	const dest = request.headers.get("sec-fetch-dest")
	if (dest !== null && dest !== "document") return res
	for (const { name } of request.cookies.getAll()) {
		if (!name.startsWith("better-auth.") && !name.startsWith("__Secure-better-auth.")) continue
		// A `__Secure-` cookie is only accepted, even to expire it, over a Set-Cookie that says Secure.
		res.cookies.set(name, "", { maxAge: 0, path: "/", secure: name.startsWith("__Secure-") })
	}
	return res
}
