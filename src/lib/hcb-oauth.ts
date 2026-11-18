import "server-only"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { configuredOrigin } from "@/lib/origin"

/**
 * The pieces of the HCB authorisation-code flow that the callback and the admin "Connect HCB" action share.
 *
 * The callback writes the credential the whole deployment pays with, so it cannot accept any `?code=` a page
 * happens to make a browser fetch. Three things are needed and each is checked in `verifyHcbCallback`: a `state`
 * the browser proves it began the flow with, a PKCE verifier that only that browser holds, and a top-level
 * navigation rather than a subresource request.
 */

const DEFAULT_BASE = "https://hcb.hackclub.com"

/**
 * The scopes the runbook registers on the HCB application. Sent with the authorise link so the consent screen
 * asks for exactly what issuing needs and nothing else.
 */
const DEFAULT_SCOPES = "restricted card_grants:read card_grants:write organizations:read transactions:write"

/**
 * The cookie names carry the `__Host-` prefix deliberately.
 *
 * Production answers on `halflife.hackclub.com`, and `hackclub.com` is not a public suffix: any other
 * `*.hackclub.com` project can set a `Domain=.hackclub.com` cookie that our host then replays. A `__Host-` cookie
 * must be set by this exact host, without a Domain attribute, over HTTPS and on `/`, so a sibling subdomain cannot
 * plant a `state` (and its matching code) in an admin's browser. Because the prefix fixes the path to `/`, the
 * callback and the start action both use the same names.
 */
export const HCB_STATE_COOKIE = "__Host-hcb-oauth-state"
export const HCB_VERIFIER_COOKIE = "__Host-hcb-oauth-verifier"
/** Present as `"1"` when the admin explicitly allowed replacing an already-stored credential. */
export const HCB_OVERWRITE_COOKIE = "__Host-hcb-oauth-overwrite"

/** How long an authorisation may sit at HCB before it comes back. HCB codes expire long before this. */
export const HCB_OAUTH_COOKIE_MAX_AGE = 600

export interface HcbOAuthStart {
	challenge: string
	state: string
	verifier: string
}

/** A fresh state and PKCE pair for one authorisation. */
export function hcbOAuthStart(): HcbOAuthStart {
	const state = randomBytes(32).toString("base64url")
	const verifier = randomBytes(32).toString("base64url")
	const challenge = createHash("sha256").update(verifier).digest("base64url")
	return { challenge, state, verifier }
}

/**
 * The redirect URI registered on the HCB application.
 *
 * The env value is what HCB checks at both ends, so it wins. The origin-derived fallback is for a deployment whose
 * proxy sets `NEXT_PUBLIC_APP_URL` but not this one; a deployment that names neither has no answer, and the
 * callback refuses rather than exchanging a code against a URL HCB did not see.
 */
export function hcbRedirectUri(): string | null {
	const configured = process.env.HCB_REDIRECT_URI?.trim()
	if (configured) return configured
	const origin = configuredOrigin()
	return origin ? `${origin}/api/integrations/hcb/callback` : null
}

/** Where the operator is sent to approve the application, with the state and PKCE challenge that must return. */
export function hcbAuthorizeUrl(start: HcbOAuthStart): string {
	const id = process.env.HCB_CLIENT_ID?.trim()
	const redirectUri = hcbRedirectUri()
	if (!id || !redirectUri) throw new Error("HCB_CLIENT_ID and a redirect URI are required to authorise HCB")
	const base = (process.env.HCB_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "")
	const url = new URL(`${base}/api/v4/oauth/authorize`)
	url.searchParams.set("client_id", id)
	url.searchParams.set("redirect_uri", redirectUri)
	url.searchParams.set("response_type", "code")
	url.searchParams.set("scope", process.env.HCB_SCOPES?.trim() || DEFAULT_SCOPES)
	url.searchParams.set("state", start.state)
	url.searchParams.set("code_challenge", start.challenge)
	url.searchParams.set("code_challenge_method", "S256")
	return url.toString()
}

/** Constant-time equality for two secrets of the same shape. */
export function secretsMatch(expected: string, actual: string | null | undefined): boolean {
	if (!actual) return false
	const a = Buffer.from(expected)
	const b = Buffer.from(actual)
	return a.length === b.length && timingSafeEqual(a, b)
}
