import "server-only"
import prisma from "@/lib/prisma"
import { encryptPII, isPiiConfigured } from "@/lib/pii"

/**
 * The parts of a Hack Club Auth profile this app keeps on the user row, and
 * the one way they get there.
 *
 * Why not better-auth's `mapProfileToUser`: these fields are declared
 * `input: false`, so a participant cannot set `verificationStatus` to
 * "verified" on themselves through update-user — and better-auth 1.7 applies
 * that same rule to what a provider's profile maps to, silently dropping every
 * one of them at sign-up. The protection is right and has to stay, so the
 * profile is written here, by the server, from HCA's own answer.
 *
 * It runs at every sign-in, and again at submit when the stored status is not
 * "verified" yet — because people finish verifying after they have signed in,
 * and should not have to sign out and back in to be let through.
 */

export const PULL_PII = process.env.PULL_HCA_PII === "true" && isPiiConfigured()

const DISCOVERY_URL =
  process.env.HCA_DISCOVERY_URL ?? "https://auth.hackclub.com/.well-known/openid-configuration"

const TIMEOUT_MS = 10_000

interface HcaAddress {
  street_address?: string
  locality?: string
  region?: string
  postal_code?: string
  country?: string
}

/** The PII fields, encrypted, when this deployment is set up to keep them. */
export function encryptedFieldsFrom(profile: Record<string, unknown>): Record<string, string> {
  if (!PULL_PII) return {}
  const out: Record<string, string> = {}
  const addr = profile.address as HcaAddress | undefined
  if (addr?.street_address) out.encryptedAddressStreet = encryptPII(addr.street_address)
  if (addr?.locality) out.encryptedAddressCity = encryptPII(addr.locality)
  if (addr?.region) out.encryptedAddressState = encryptPII(addr.region)
  if (addr?.postal_code) out.encryptedAddressZip = encryptPII(addr.postal_code)
  if (addr?.country) out.encryptedAddressCountry = encryptPII(addr.country)
  if (typeof profile.birthdate === "string") out.encryptedBirthday = encryptPII(profile.birthdate)
  return out
}

let userinfoEndpoint: string | null = null

async function userinfoUrl(): Promise<string> {
  if (userinfoEndpoint) return userinfoEndpoint
  const res = await fetch(DISCOVERY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HCA discovery returned ${res.status}`)
  const config = (await res.json()) as { userinfo_endpoint?: string }
  if (!config.userinfo_endpoint) throw new Error("HCA discovery has no userinfo_endpoint")
  userinfoEndpoint = config.userinfo_endpoint
  return userinfoEndpoint
}

/**
 * Read this user's profile from HCA and store what we keep of it.
 *
 * Resolves to the verification status HCA reported, or null if HCA could not
 * be asked (no linked account, a token that will not refresh, HCA down). Never
 * throws: a sign-in or a submit must not fail because this could not run.
 */
export async function syncHcaProfile(userId: string): Promise<string | null> {
  try {
    // Imported here, not at the top: lib/auth calls this from its own hooks.
    const { auth } = await import("@/lib/auth")
    const account = await prisma.account.findFirst({
      where: { userId, providerId: "hca" },
      select: { id: true },
    })
    if (!account) return null
    // Refreshes the token first if it has expired. No request headers, so
    // better-auth takes this as the trusted server-side call it is.
    const { accessToken } = await auth.api.getAccessToken({ body: { accountId: account.id, userId } })
    if (!accessToken) return null

    const res = await fetch(await userinfoUrl(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`[hca] userinfo for ${userId} returned ${res.status}`)
      return null
    }
    const profile = (await res.json()) as Record<string, unknown>

    const status = typeof profile.verification_status === "string" ? profile.verification_status : null
    await prisma.user.update({
      where: { id: userId },
      data: {
        // Only what HCA actually said: a missing claim leaves the stored value.
        ...(status ? { verificationStatus: status } : {}),
        ...encryptedFieldsFrom(profile),
      },
    })
    // Apart, because slackId is unique: a clash with another row must not
    // cost this user their verification status.
    if (typeof profile.slack_id === "string") {
      await prisma.user
        .update({ where: { id: userId }, data: { slackId: profile.slack_id } })
        .catch((err) => console.warn(`[hca] slack id for ${userId} not stored:`, err))
    }
    return status
  } catch (err) {
    console.warn(`[hca] profile sync for ${userId} failed:`, err)
    return null
  }
}
