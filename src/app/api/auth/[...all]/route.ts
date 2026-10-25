import { toNextJsHandler } from "better-auth/next-js"
import { auth } from "@/lib/auth"
import { publicRedirect } from "@/lib/public-origin"

const handler = toNextJsHandler(auth)

/** Largest auth body accepted: 1 MB. better-auth ships a zod version with GHSA-mrhx-c7xc-m3w5, where a huge scopes array builds a ~670 MB error message from a 2 MB request. The hooks.before scopes cap refuses that shape, but a giant body should never be buffered at all. */
const MAX_AUTH_BODY_BYTES = 1_000_000

function bodyTooLarge(request: Request): boolean {
	const declared = Number(request.headers.get("content-length") ?? "")
	return Number.isFinite(declared) && declared > MAX_AUTH_BODY_BYTES
}

/**
 * Two callback failures are answered here instead of being left to better-auth.
 *
 * `state_mismatch`: better-auth's OAuth `state` is single-use, and a second delivery of the same callback – the provider or the browser re-requesting the URL, a known better-auth behaviour (better-auth/better-auth#7710) – finds no verification row and is rejected. When the first delivery already signed the user in, that turns a success into a failure on screen. A duplicate is therefore answered with a redirect of our own: the trail when the request already carries a session, the landing page otherwise.
 *
 * `account_not_linked`: better-auth refused to attach the HCA identity to an existing local user because that user was not `emailVerified`. `lib/hca-profile` adopts HCA's own proof onto the pre-created rows it safely can before better-auth makes that decision, so this is the rare remainder (an unverified address at HCA, or a row we could not safely claim). The person is sent to the landing page with a flag its signup form reads, so they meet an explanation rather than better-auth's bare error page – which, in production, redirects to a query string nothing renders.
 *
 * Every other callback failure – an invalid code, a missing email, a provider we do not trust – is left to better-auth, because those are real and their page is the right one.
 */
export async function GET(request: Request): Promise<Response> {
	const response = await handler.GET(request)

	const location = response.headers.get("location")
	if (!location) return response
	let error: string | null = null
	try {
		error = new URL(location, request.url).searchParams.get("error")
	} catch {
		// A Location that will not parse is not one of ours to rewrite.
		return response
	}
	if (error !== "state_mismatch" && error !== "account_not_linked") return response

	// A duplicate callback that already signed someone in leaves a session behind; a failed link attempt does not. Redirects stay on the public origin (see lib/public-origin): `request.url` carries the pod's own host behind the ingress.
	const session = await auth.api.getSession({ headers: request.headers })
	if (session) return publicRedirect(request, "/dashboard")

	if (error === "account_not_linked") return publicRedirect(request, "/?error=account_not_linked")

	// An expired or duplicate state, with no session: the attempt is over.
	return publicRedirect(request, "/")
}

export async function POST(request: Request): Promise<Response> {
	if (bodyTooLarge(request))
		return Response.json({ message: "Request body too large" }, { status: 413 })
	return handler.POST(request)
}
