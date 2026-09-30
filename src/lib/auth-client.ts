"use client"
import { createAuthClient } from "better-auth/react"

/**
 * Generic OAuth providers register as first-class social providers in
 * better-auth 1.7, so they go through the standard `signIn.social` endpoint and
 * the `callback/:providerId` route. There is no client plugin to add — and the
 * registered redirect URI is `/api/auth/callback/hca`, not an oauth2-prefixed
 * one.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
})

export const { signOut, useSession } = authClient

/**
 * `loginHint` is the address to start the sign-in with. Hack Club Auth reads
 * it as the standard `login_hint` and pre-fills its email box — the one both a
 * returning user and a newcomer start from — so an address typed on the
 * landing page is not asked for twice.
 */
export function signInWith(providerId: "hca" | "hackatime", callbackURL = "/dashboard", loginHint?: string) {
  return authClient.signIn.social({
    provider: providerId,
    callbackURL,
    ...(loginHint ? { loginHint } : {}),
  })
}

export function linkHackatime(callbackURL = "/dashboard") {
  return authClient.linkSocial({ provider: "hackatime", callbackURL })
}

/** Timelapses are recorded on Lapse; linking is what lets us list them. */
export function linkLapse(callbackURL = "/dashboard") {
  return authClient.linkSocial({ provider: "lapse", callbackURL })
}

/**
 * GitHub is linked, never signed in with: it is the authorisation that lets the
 * repo sync push to a maker's repository, granted by someone already signed in
 * through Hack Club Auth.
 */
export function linkGitHub(callbackURL = "/dashboard") {
  return authClient.linkSocial({ provider: "github", callbackURL })
}
