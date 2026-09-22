import "server-only"
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { genericOAuth } from "better-auth/plugins"
import prisma from "@/lib/prisma"
import { Role } from "@/app/generated/prisma/enums"
import { encryptPII, isPiiConfigured } from "@/lib/pii"
import { materializeThemeProjects } from "@/lib/provisioning"
import { bufferRsvpForUser } from "@/lib/airtable/rsvp"
import { LAPSE_API_BASE } from "@/lib/lapse"

const PULL_PII = process.env.PULL_HCA_PII === "true" && isPiiConfigured()

const hcaScopes = ["openid", "profile", "email", "slack_id", "verification_status"]
if (PULL_PII) hcaScopes.push("address", "birthdate")

interface HcaAddress {
  street_address?: string
  locality?: string
  region?: string
  postal_code?: string
  country?: string
}

function encryptedFieldsFrom(profile: Record<string, unknown>): Record<string, string> {
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

/**
 * The email a link-only provider reports: unique per identity, and on the
 * reserved .invalid TLD, so it can never equal a real user's address. See
 * `trustedProviders` for why that matters.
 */
function linkOnlyEmail(provider: "hackatime" | "lapse", id: string): string {
  return `${provider}-${id.replace(/[^A-Za-z0-9_-]/g, "")}@link.invalid`
}

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  account: {
    accountLinking: {
      enabled: true,
      // A participant's Hackatime signup email rarely matches their HCA email.
      // Without this, better-auth's link flow aborts with email_doesn't_match
      // and the account is never created — and because the auth handler
      // swallows the error into a dashboard redirect, it looks like the button
      // simply did nothing. This only affects the explicit linkSocial path,
      // where the actor already holds the target session.
      allowDifferentEmails: true,
      // Trust does two things in better-auth, and only one of them is wanted.
      //
      // 1. It lets the explicit link flow (linkSocial, from a signed-in
      //    session) attach the identity at all. Without it, a provider that
      //    reports emailVerified: false is refused with "untrusted provider",
      //    which is what broke Sign in with Lapse and Link Hackatime.
      // 2. It lets a sign-in through that provider attach itself to an
      //    EXISTING user whose email matches. For a provider that does not
      //    prove email ownership that is an account takeover: register
      //    Hackatime under someone else's address, sign in, become them.
      //
      // Hackatime and Lapse are trusted for (1) and defused for (2): their
      // getUserInfo reports a per-identity address on the reserved .invalid
      // TLD (linkOnlyEmail, above) that no real user can hold, so the email
      // match in (2) can never find anyone. Nothing reads those addresses —
      // a user's email comes from HCA, and Account rows store no email.
      trustedProviders: ["hca", "hackatime", "lapse"],
    },
  },

  user: {
    additionalFields: {
      slackId: { type: "string", required: false, input: false },
      slackDisplayName: { type: "string", required: false, input: false },
      verificationStatus: { type: "string", required: false, input: false },
      hackatimeUserId: { type: "string", required: false, input: false },
      timezone: { type: "string", required: false, input: false },
      pronouns: { type: "string", required: false, input: false },
      fraudFlagged: { type: "boolean", required: false, input: false, defaultValue: false },
      encryptedAddressStreet: { type: "string", required: false, input: false },
      encryptedAddressLine2: { type: "string", required: false, input: false },
      encryptedAddressCity: { type: "string", required: false, input: false },
      encryptedAddressState: { type: "string", required: false, input: false },
      encryptedAddressZip: { type: "string", required: false, input: false },
      encryptedAddressCountry: { type: "string", required: false, input: false },
      encryptedBirthday: { type: "string", required: false, input: false },
      encryptedPhone: { type: "string", required: false, input: false },
    },
  },

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Create the five themed project rows up front. Because the program
          // shape is fixed, doing it here means every page below is a plain
          // findMany and every route can 404 honestly instead of lazily
          // creating rows mid-request.
          await materializeThemeProjects(user.id).catch((err) =>
            console.error("[auth] materializeThemeProjects failed:", err),
          )

          await prisma.user
            .update({ where: { id: user.id }, data: { joinedProgramAt: new Date() } })
            .catch(() => {})

          // Buffered, never a synchronous Airtable call: a signup must not fail
          // because a third party is rate-limiting us.
          if (user.email) {
            await bufferRsvpForUser(user.id, user.email, user.name ?? null).catch((err) =>
              console.error("[auth] bufferRsvpForUser failed:", err),
            )
          }

          // The only way to get a first admin into a fresh database without
          // shell access to production.
          //
          // Gated on emailVerified, which only the identity provider can set:
          // HCA passes through the OIDC email_verified claim, and every other
          // provider we configure reports false. Without that check, anyone who
          // claims a superadmin address on a provider that does not verify
          // email would be granted ADMIN the moment they first signed in.
          const superadmins = (process.env.SUPERADMIN_EMAILS ?? "")
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
          if (user.emailVerified && user.email && superadmins.includes(user.email.toLowerCase())) {
            await prisma.userRole
              .upsert({
                where: { userId_role: { userId: user.id, role: Role.ADMIN } },
                create: { userId: user.id, role: Role.ADMIN, grantedBy: "SUPERADMIN_EMAILS" },
                update: {},
              })
              .catch((err) => console.error("[auth] superadmin grant failed:", err))
          }
        },
      },
    },
    account: {
      create: {
        after: async (account) => {
          // Denormalise the Hackatime id onto User so hour lookups are one query.
          if (account.providerId === "hackatime") {
            await prisma.user
              .update({
                where: { id: account.userId },
                data: { hackatimeUserId: account.accountId },
              })
              .catch((err) => console.error("[auth] hackatime id copy failed:", err))
          }
        },
      },
    },
  },

  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "hca",
          discoveryUrl:
            process.env.HCA_DISCOVERY_URL ??
            "https://auth.hackclub.com/.well-known/openid-configuration",
          clientId: process.env.HCA_CLIENT_ID ?? "",
          clientSecret: process.env.HCA_CLIENT_SECRET ?? "",
          scopes: hcaScopes,
          overrideUserInfo: true,
          mapProfileToUser: (profile: Record<string, unknown>) => ({
            email: profile.email as string,
            name: profile.name as string | undefined,
            image: profile.picture as string | undefined,
            slackId: profile.slack_id as string | undefined,
            verificationStatus: profile.verification_status as string | undefined,
            ...encryptedFieldsFrom(profile),
          }),
        },
        {
          providerId: "hackatime",
          authorizationUrl: `${process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"}/oauth/authorize`,
          tokenUrl: `${process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"}/oauth/token`,
          userInfoUrl: `${process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"}/api/v1/authenticated/me`,
          clientId: process.env.HACKATIME_CLIENT_ID ?? "",
          clientSecret: process.env.HACKATIME_CLIENT_SECRET ?? "",
          scopes: ["profile"],
          pkce: true,
          // Link-only. better-auth 1.7 registers generic OAuth providers as
          // first-class social providers, so without this anyone could POST
          // /api/auth/sign-in/social {"provider":"hackatime"} and mint a
          // Half-Life account under an email Hackatime never verified —
          // bypassing HCA identity entirely, and reaching the superadmin
          // bootstrap below.
          disableSignUp: true,
          disableImplicitSignUp: true,
          getUserInfo: async ({ accessToken }) => {
            const base = process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"
            const res = await fetch(`${base}/api/v1/authenticated/me`, {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(10_000),
            })
            if (!res.ok) return null
            const data = (await res.json()) as {
              id: number | string
              emails?: string[]
              github_username?: string
              slack_id?: string
            }
            return {
              id: String(data.id),
              email: linkOnlyEmail("hackatime", String(data.id)),
              name: data.github_username || data.slack_id || String(data.id),
              emailVerified: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          },
        },
        {
          // Where timelapses live. Link-only for the same reason as Hackatime:
          // Lapse is not an identity we trust to create accounts, it is a
          // library of recordings attached to one we already have.
          //
          // Lapse issues 30-day access tokens and no refresh tokens, so an
          // expired token is handled as "not linked" (see lib/lapse.ts) and
          // the timelapse tab offers Sign in with Lapse again.
          providerId: "lapse",
          authorizationUrl: `${LAPSE_API_BASE}/auth/authorize`,
          tokenUrl: `${LAPSE_API_BASE}/auth/token`,
          clientId: process.env.LAPSE_CLIENT_ID ?? "",
          clientSecret: process.env.LAPSE_CLIENT_SECRET ?? "",
          scopes: ["user:read", "timelapse:read"],
          pkce: true,
          // Lapse's token endpoint reads the secret from the form body, as its
          // reference client sends it.
          authentication: "post",
          disableSignUp: true,
          disableImplicitSignUp: true,
          getUserInfo: async ({ accessToken }) => {
            const res = await fetch(`${LAPSE_API_BASE}/user/myself`, {
              headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
              signal: AbortSignal.timeout(10_000),
            })
            if (!res.ok) return null
            const body = (await res.json()) as {
              ok: boolean
              data?: {
                user: {
                  id: string
                  handle: string
                  displayName: string
                  profilePictureUrl?: string
                } | null
              }
            }
            const user = body.ok ? body.data?.user : null
            if (!user) return null
            return {
              id: user.id,
              email: linkOnlyEmail("lapse", user.id),
              name: user.displayName || user.handle,
              image: user.profilePictureUrl,
              emailVerified: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          },
        },
      ],
    }),
  ],
})

export type AuthSession = typeof auth.$Infer.Session
