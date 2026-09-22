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

export function signInWith(providerId: "hca" | "hackatime", callbackURL = "/dashboard") {
  return authClient.signIn.social({ provider: providerId, callbackURL })
}

export function linkHackatime(callbackURL = "/dashboard") {
  return authClient.linkSocial({ provider: "hackatime", callbackURL })
}

/** Timelapses are recorded on Lapse; linking is what lets us list them. */
export function linkLapse(callbackURL = "/dashboard") {
  return authClient.linkSocial({ provider: "lapse", callbackURL })
}
