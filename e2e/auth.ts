import { createHmac } from "node:crypto"
import type { Cookie } from "@playwright/test"
import { e2eAuthSecret, e2eBaseUrl } from "./env"

/**
 * The cookie better-auth sets for a session.
 *
 * Its `baseURL` is configured with `protocol: "https"` even on a laptop, so the cookie carries the `__Secure-` prefix locally too. On localhost a Secure cookie is still sent, which is also why ordinary local sign-in works.
 */
export const sessionCookieName = "__Secure-better-auth.session_token"

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

/**
 * Build the value better-auth will accept: `token.signature`, where the signature is base64 HMAC-SHA256 of the token under `BETTER_AUTH_SECRET`.
 *
 * This mirrors `better-call`'s `signCookieValue`, which is what better-auth uses when it sets the cookie. The fixture calls `/api/auth/get-session` afterwards, so a future change to the format fails one test with a clear message instead of every test with a redirect.
 */
export function sessionCookie(token: string): Cookie {
	const signature = createHmac("sha256", e2eAuthSecret).update(token).digest("base64")

	return {
		domain: new URL(e2eBaseUrl).hostname,
		expires: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
		httpOnly: true,
		name: sessionCookieName,
		path: "/",
		sameSite: "Lax",
		secure: true,
		value: `${token}.${signature}`,
	}
}
