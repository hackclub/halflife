import "server-only"
import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { genericOAuth } from "better-auth/plugins"
import prisma from "@/lib/prisma"
import { Role } from "@/app/generated/prisma/enums"
import { PULL_PII, fetchHcaIdentity, syncHcaProfile } from "@/lib/hca-profile"
import { markLogin } from "@/lib/analytics"
import { bufferRsvpForUser } from "@/lib/airtable/rsvp"
import { LAPSE_API_BASE } from "@/lib/lapse"

// Exactly the scopes enabled on Half Life's HCA app. HCA refuses the whole
// sign-in ("The requested scope is invalid") if any one is not, so this list
// has to match the app's settings, not HCA's docs. `basic_info` carries name
// and verification_status; `email` is asked for on its own so the standard
// `email_verified` claim comes with it, which the superadmin bootstrap below
// trusts. Asking for `verification_status` by name is refused.
const hcaScopes = ["openid", "profile", "email", "basic_info", "slack_id"]
if (PULL_PII) hcaScopes.push("address", "birthdate")

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
    session: {
      create: {
        // Every sign-in re-reads the HCA profile, so a status that changed
        // since the last one — most often "pending" becoming "verified" — is
        // current. Not awaited: signing in must not wait on, or fail with, HCA.
        after: async (session) => {
          void syncHcaProfile(session.userId)
          void markLogin(session.userId)
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          // No project rows here: each is created when its week's "create a
          // project" checkpoint is opened (lib/provisioning).

          await prisma.user.update({ where: { id: user.id }, data: { joinedProgramAt: new Date() } }).catch(() => {})

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
          discoveryUrl: process.env.HCA_DISCOVERY_URL ?? "https://auth.hackclub.com/.well-known/openid-configuration",
          clientId: process.env.HCA_CLIENT_ID ?? "",
          clientSecret: process.env.HCA_CLIENT_SECRET ?? "",
          scopes: hcaScopes,
          overrideUserInfo: true,
          // Read from both of HCA's endpoints, not just OIDC userinfo: under
          // `basic_info` the email is only on /api/v1/me, and without it
          // better-auth refuses the sign-in with "email_not_found".
          getUserInfo: async ({ accessToken }) => {
            if (!accessToken) return null
            const identity = await fetchHcaIdentity(accessToken)
            if (!identity.sub || !identity.email) {
              console.error("[auth] HCA returned no subject or email; check the app's scopes")
              return null
            }
            return {
              id: identity.sub,
              // HCA is configured from discovery, so better-auth treats it as
              // OIDC and keys the account on `sub`, not `id`. Without it the
              // sign-in fails with OAUTH_ACCOUNT_SUBJECT_INVALID. Same value as
              // before, so existing accounts are still found.
              sub: identity.sub,
              email: identity.email,
              emailVerified: identity.emailVerified,
              name: identity.name ?? identity.email,
              image: identity.image ?? undefined,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          },
          // Core fields only. The verification status, Slack id and PII are
          // `input: false`, and better-auth drops those from a provider profile
          // — so they are written by syncHcaProfile at sign-in instead. Mapping
          // them here did nothing, which is how every user ended up unverified.
          mapProfileToUser: (profile: Record<string, unknown>) => ({
            email: profile.email as string,
            name: profile.name as string | undefined,
            image: profile.image as string | undefined,
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
