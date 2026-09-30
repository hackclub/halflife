import { toNextJsHandler } from "better-auth/next-js"
import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"

const handler = toNextJsHandler(auth)

/**
 * better-auth's OAuth `state` is single-use: `parseGenericState` deletes the
 * verification row the moment a callback parses it. A second delivery of the
 * same callback — the provider or the browser re-requesting the URL, which is a
 * known better-auth behaviour (better-auth/better-auth#7710) — then finds no
 * row and is rejected with `state_mismatch`, and the default handling sends the
 * browser to better-auth's error page. When the first delivery already signed
 * the user in, that turns a success into a failure on screen.
 *
 * So a duplicate is answered with a redirect of our own instead: the trail when
 * the request already carries a session (the first delivery worked), and the
 * landing page otherwise (an expired attempt) so the person can try again
 * rather than land on an error page.
 *
 * Only `state_mismatch` is intercepted. Every other callback failure — an
 * invalid code, a missing email, a provider we do not trust — is left to
 * better-auth, because those are real and their page is the right one.
 */
export async function GET(request: Request) {
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
  if (error !== "state_mismatch") return response

  const session = await auth.api.getSession({ headers: request.headers })
  return NextResponse.redirect(new URL(session ? "/dashboard" : "/", request.url))
}

export const { POST } = handler
