"use client"
import { createAuthClient } from "better-auth/react"

/**
 * Generic OAuth providers register as first-class social providers in better-auth 1.7, so they go through the standard `signIn.social` endpoint and the `callback/:providerId` route. There is no client plugin to add – and the registered redirect URI is `/api/auth/callback/hca`, not an oauth2-prefixed one.
 */
export const authClient = createAuthClient({
	baseURL: process.env.NEXT_PUBLIC_APP_URL,
})

export const { signOut, useSession } = authClient

/** The result better-auth reports for a redirect that did not start; it resolves rather than throwing. */
interface AuthRedirectResult {
	error?: { message?: string }
}

/** Reduce better-auth's `{ data, error }` answer to the one field callers read. */
async function redirectResult(request: Promise<{ error: { message?: string } | null }>): Promise<AuthRedirectResult> {
	const { error } = await request
	return error ? { error: { message: error.message } } : {}
}

/**
 * `loginHint` is the address to start the sign-in with. Hack Club Auth reads it as the standard `login_hint` and pre-fills its email box – the one both a returning user and a newcomer start from – so an address typed on the landing page is not asked for twice.
 */
export function signInWith(
	providerId: "hca" | "hackatime",
	callbackURL = "/dashboard",
	loginHint?: string,
): Promise<AuthRedirectResult> {
	return redirectResult(
		authClient.signIn.social({
			callbackURL,
			provider: providerId,
			...(loginHint ? { loginHint } : {}),
		}),
	)
}

export function linkHackatime(callbackURL = "/dashboard"): Promise<AuthRedirectResult> {
	return redirectResult(authClient.linkSocial({ callbackURL, provider: "hackatime" }))
}

/** Timelapses are recorded on Lapse; linking is what lets us list them. */
export function linkLapse(callbackURL = "/dashboard"): Promise<AuthRedirectResult> {
	return redirectResult(authClient.linkSocial({ callbackURL, provider: "lapse" }))
}

/**
 * A forge is linked, never signed in with: it is the authorisation that lets the repo sync push to a maker's repository, granted by someone already signed in through Hack Club Auth. `forge` names which service – the two configured today are GitHub and GitLab, both registered in lib/forge.
 */
export function linkForge(forge: "github" | "gitlab", callbackURL = "/dashboard"): Promise<AuthRedirectResult> {
	return redirectResult(authClient.linkSocial({ callbackURL, provider: forge }))
}
