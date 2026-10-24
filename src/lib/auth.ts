import "server-only"
import { kyselyAdapter } from "@better-auth/kysely-adapter"
import { betterAuth } from "better-auth"
import { genericOAuth } from "better-auth/plugins"
import { bufferRsvpForUser } from "@/lib/airtable/rsvp"
import { markLogin } from "@/lib/analytics"
import authDb from "@/lib/auth-db"
import { Role } from "@/lib/enums"
import { fetchWithRetry } from "@/lib/fetch-retry"
import { FORGES } from "@/lib/forge"
import { adoptHcaVerifiedEmail, fetchHcaIdentity, PULL_PII, syncHcaProfile } from "@/lib/hca-profile"
import { LAPSE_API_BASE } from "@/lib/lapse"
import { isLoopbackHostname, publicHosts as publicHostList } from "@/lib/origin"
import db from "@/lib/prisma8"
import { redactForLog } from "@/lib/redact"
import { formatDbTimestamp } from "@/lib/time"

// Exactly the scopes enabled on Half Life's HCA app. HCA refuses the whole sign-in ("The requested scope is invalid") if any one is not, so this list has to match the app's settings, not HCA's docs. `basic_info` carries name and verification_status; `email` is asked for on its own so the standard `email_verified` claim comes with it, which the superadmin bootstrap below trusts. Asking for `verification_status` by name is refused.
const hcaScopes = ["openid", "profile", "email", "basic_info", "slack_id"]
if (PULL_PII) hcaScopes.push("address", "birthdate")

/**
 * The scopes each forge's OAuth app needs, read from the one registry that describes them (lib/forge). Duplicated nowhere: a change there is what the picker and the link button promise, because they read the same field.
 */
const githubScopes = [...FORGES.github.scopes]
const gitlabScopes = [...FORGES.gitlab.scopes]

/**
 * A forge is link-only: GitHub and GitLab here are not identities we create accounts from, they are authorisation to push to one repository, granted by someone we already know. Making either a sign-in provider would mean it proved an email for an account HCA is supposed to be the sole source of.
 */

/**
 * The email a link-only provider reports: unique per identity, and on the reserved .invalid TLD, so it can never equal a real user's address. See `trustedProviders` for why that matters.
 */
function linkOnlyEmail(provider: "hackatime" | "lapse" | "github" | "gitlab", id: string): string {
	return `${provider}-${id.replaceAll(/[^A-Za-z0-9_-]/g, "")}@link.invalid`
}

/**
 * The hosts that front a deployed instance. `halflife.hackclub.com` is the one users are sent to, and `half-life.k.hackclub.dev` is the Orchard ingress in the runbook – so whichever one a request arrives on, it signs in against that host.
 *
 * An exact list, never a wildcard over a shared domain. `*.k.hackclub.dev` is a wildcard many unrelated projects sit behind, so anyone who controls any subdomain there could name a host this deployment would then trust – and a trusted host is one a sign-in and a redirect may point at. `APP_PUBLIC_HOSTS` carries the list, so a deployment reached on another name is a configuration change rather than a code change, and lib/origin.ts reads the same list for the redirect resolver.
 */
const publicHosts = publicHostList()
const canonicalUrl = "https://halflife.hackclub.com"
const devUrl = "http://localhost:3000"

/** Is this URL a laptop's own (`next dev`, or `next start` after a local build)? */
function isLoopbackURL(url: string | undefined): boolean {
	if (!url) return false
	try {
		const { hostname } = new URL(url)
		return isLoopbackHostname(hostname)
	} catch {
		return false
	}
}

const configuredUrl = process.env.BETTER_AUTH_URL
/**
 * Where a request signs in from when it names no host we recognise. A deployed process uses the canonical origin, NOT `BETTER_AUTH_URL`, which can still name the hostname an earlier deploy used – the stale value that broke sign-in on halflife.hackclub.com is exactly that. A laptop keeps its own.
 */
const baseURLFallback =
	process.env.NODE_ENV === "production" && !isLoopbackURL(configuredUrl) ? canonicalUrl : (configuredUrl ?? devUrl)

export const auth = betterAuth({
	account: {
		accountLinking: {
			// A participant's Hackatime signup email rarely matches their HCA email. Without this, better-auth's link flow aborts with email_doesn't_match and the account is never created – and because the auth handler swallows the error into a dashboard redirect, it looks like the button simply did nothing. This only affects the explicit linkSocial path, where the actor already holds the target session.
			allowDifferentEmails: true,
			enabled: true,
			// Trust does two things in better-auth, and only one of them is wanted.
			//
			// 1. It lets the explicit link flow (linkSocial, from a signed-in session) attach the identity at all. Without it, a provider that reports emailVerified: false is refused with "untrusted provider", which is what broke Sign in with Lapse and Link Hackatime.
			// 2. It lets a sign-in through that provider attach itself to an EXISTING user whose email matches. For a provider that does not prove email ownership that is an account takeover: register Hackatime under someone else's address, sign in, become them.
			//
			// Hackatime and Lapse are trusted for (1) and defused for (2): their getUserInfo reports a per-identity address on the reserved .invalid TLD (linkOnlyEmail, above) that no real user can hold, so the email match in (2) can never find anyone. Nothing reads those addresses – a user's email comes from HCA, and Account rows store no email.
			trustedProviders: ["hca", "hackatime", "lapse", "github", "gitlab"],
		},
	},

	// The ingress terminates TLS and forwards the public host in `x-forwarded-host`. Trusting it for base URL resolution is what makes the previous block see `halflife.hackclub.com` rather than the pod's own address; a forged value cannot point anywhere outside `allowedHosts`.
	//
	// `ipAddress.ipAddressHeaders` is a separate concern and is NOT covered by `trustedProxyHeaders`: that option only affects base-URL/host resolution. The rate limiter resolves the client address on its own, and by default reads only `x-forwarded-for` – which, behind the ingress, carries more than one hop, so better-auth refuses it and falls back to a single shared `no-trusted-ip|/sign-in/social` bucket (3 requests per 10s for the whole site, which is what made ordinary sign-ins return 429). Cloudflare overwrites `cf-connecting-ip` and the ingress sets `x-real-ip`, both single values, so listing them first gives each person their own bucket. The same chain `clientIp` in lib/site/signups.ts reads.
	advanced: {
		ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"] },
		trustedProxyHeaders: true,
	},

	// better-auth validates every credentialed request's Origin against the origin of its base URL, so pinning `baseURL` to a single hostname refuses sign-ins that arrive on any other one with INVALID_ORIGIN – logged as "Invalid origin: https://halflife.hackclub.com" – long before the OAuth flow starts, which the landing page's login mark reports as "try again". Resolve the host per request instead, for the hosts we know.
	//
	// `protocol: "https"`: TLS terminates at the ingress, so the request the pod sees still arrives as plain http, and the resolved URL must not.
	baseURL: {
		allowedHosts: publicHosts,
		fallback: baseURLFallback,
		protocol: "https",
	},

	database: kyselyAdapter(authDb, { type: "postgres" }),

	databaseHooks: {
		account: {
			create: {
				after: async account => {
					// Denormalise the Hackatime id onto User so hour lookups are one query.
					if (account.providerId === "hackatime")
						await db.orm.public.User.where({ id: account.userId })
							.update({ hackatimeUserId: account.accountId })
							.catch(err => console.error("[auth] hackatime id copy failed:", err))
				},
			},
		},
		session: {
			create: {
				// Every sign-in re-reads the HCA profile, so a status that changed since the last one – most often "pending" becoming "verified" – is current, and so the name, image and address better-auth no longer overrides are kept up to date. Not awaited: signing in must not wait on, or fail with, HCA.
				after: session => {
					void syncHcaProfile(session.userId, { profile: true })
					void markLogin(session.userId)
					return Promise.resolve()
				},
			},
		},
		user: {
			create: {
				after: async user => {
					// No project rows here: each is created when its week's "create a project" checkpoint is opened (lib/provisioning).

					await db.orm.public.User.where({ id: user.id })
						.update({ joinedProgramAt: formatDbTimestamp(new Date()) })
						.catch(() => {})

					// Buffered, never a synchronous Airtable call: a signup must not fail because a third party is rate-limiting us.
					if (user.email)
						await bufferRsvpForUser(user.id, user.email, user.name ?? null).catch(err =>
							console.error("[auth] bufferRsvpForUser failed:", err),
						)

					// The only way to get a first admin into a fresh database without shell access to production.
					//
					// Gated on emailVerified, which only the identity provider can set: HCA passes through the OIDC email_verified claim, and every other provider we configure reports false. Without that check, anyone who claims a superadmin address on a provider that does not verify email would be granted ADMIN the moment they first signed in.
					const superadmins = (process.env.SUPERADMIN_EMAILS ?? "")
						.split(",")
						.map(s => s.trim().toLowerCase())
						.filter(Boolean)
					if (user.emailVerified && user.email && superadmins.includes(user.email.toLowerCase()))
						try {
							await db.orm.public.UserRole.createAll(
								[{ grantedBy: "SUPERADMIN_EMAILS", role: Role.ADMIN, userId: user.id }],
								{ onConflict: "skip" },
							)
						} catch (err) {
							console.error("[auth] superadmin grant failed:", err)
						}
				},
			},
		},
	},

	// better-auth's OAuth state is single-use, so a callback delivered twice logs "Failed to parse state ... verification not found" on the second delivery even when the first one signed the user in. The callback route already turns that duplicate into a normal redirect (see app/api/auth/[...all]/route.ts), so logging it as an error only buried the failures that matter. Surface it as one info line and pass everything else through unchanged. `state_security_mismatch` is deliberately NOT caught: a state cookie that does not match is a real misconfiguration.
	logger: {
		log(level, message, ...args) {
			const error = args[0] as { code?: string; details?: { state?: string } } | undefined
			if (message === "Failed to parse state" && error?.code === "state_mismatch") {
				console.info(
					`[auth] ignored a duplicate or expired OAuth callback (state ${error.details?.state ?? "unknown"})`,
				)
				return
			}
			const line = `${new Date().toISOString()} ${level.toUpperCase()} [Better Auth]: ${message}`
			// Upstream provider errors can echo request fields; scrub emails/tokens before they reach the logs (L10).
			const safeArgs = args.map(a => redactForLog(a))
			if (level === "error") console.error(line, ...safeArgs)
			else if (level === "warn") console.warn(line, ...safeArgs)
			else console.log(line, ...safeArgs)
		},
	},

	plugins: [
		genericOAuth({
			config: [
				{
					// The endpoints are pinned as well as discovered.
					//
					// better-auth fetches `discoveryUrl` EXACTLY ONCE, at startup, with no retry. HCA rate-limits its own discovery endpoint (`429`, `retry-after: 300`), and one 429 in that instant left the plugin with no authorization/token URL – so it logged "discovery left no usable authorization endpoint" and registered NO `hca` provider at all, and every sign-in then failed with "Provider not found".
					//
					// These are HCA's published routes (its `auth` app mounts `/oauth/authorize` and `/oauth/token` via Doorkeeper, and `/oauth/userinfo` + `/oauth/discovery/keys` via doorkeeper-openid_connect) and are what the discovery document returns, so pinning them is the same answer with the network taken out of the startup path. Discovery is still passed, so when it does answer the plugin picks up the issuer and JWKS for ID-token verification; the pinned URLs just guarantee the provider registers regardless. `HCA_*` env vars override each.
					authorizationUrl: process.env.HCA_AUTHORIZATION_URL ?? "https://auth.hackclub.com/oauth/authorize",
					clientId: process.env.HCA_CLIENT_ID ?? "",
					clientSecret: process.env.HCA_CLIENT_SECRET ?? "",
					discoveryUrl: process.env.HCA_DISCOVERY_URL ?? "https://auth.hackclub.com/.well-known/openid-configuration",
					// Read from both of HCA's endpoints, not just OIDC userinfo: under `basic_info` the email is only on /api/v1/me, and without it better-auth refuses the sign-in with "email_not_found".
					getUserInfo: async ({ accessToken }) => {
						if (!accessToken) return null
						const identity = await fetchHcaIdentity(accessToken)
						if (!identity.sub || !identity.email) {
							console.error("[auth] HCA returned no subject or email; check the app's scopes")
							return null
						}
						// Before better-auth decides whether this identity may attach to an existing user. A row made by a staff import has no HCA account and is not verified, which would dead-end the sign-in at `account_not_linked`; when HCA vouches for the address, that proof is adopted here so the normal linking path can run. See `adoptHcaVerifiedEmail`.
						if (await adoptHcaVerifiedEmail(identity.email, identity.emailVerified))
							console.info(
								`[auth] adopted HCA's verified address for ${redactForLog(identity.email)} to allow account linking`,
							)
						return {
							createdAt: new Date(),
							email: identity.email,
							emailVerified: identity.emailVerified,
							id: identity.sub,
							image: identity.image ?? undefined,
							name: identity.name ?? identity.email,
							// HCA is configured from discovery, so better-auth treats it as OIDC and keys the account on `sub`, not `id`. Without it the sign-in fails with OAUTH_ACCOUNT_SUBJECT_INVALID. Same value as before, so existing accounts are still found.
							sub: identity.sub,
							updatedAt: new Date(),
						}
					},
					// Core fields only. The verification status, Slack id and PII are `input: false`, and better-auth drops those from a provider profile – so they are written by syncHcaProfile at sign-in instead. Mapping them here did nothing, which is how every user ended up unverified.
					mapProfileToUser: (profile: { [_: string]: unknown }) => ({
						email: profile.email as string,
						image: profile.image as string | undefined,
						name: profile.name as string | undefined,
					}),
					// Off, because this rewrites the stored address to whatever HCA reports in the same update as name and image. When HCA moves a person to an address another local row already holds, that update fails on the unique `user_email_key`: the whole callback 500s and the person cannot sign in at all. syncHcaProfile (lib/hca-profile) writes the same fields after the session exists, where it has a user id to check the address against and can keep the old one while still storing everything else HCA sent.
					overrideUserInfo: false,
					providerId: "hca",
					scopes: hcaScopes,
					tokenUrl: process.env.HCA_TOKEN_URL ?? "https://auth.hackclub.com/oauth/token",
					userInfoUrl: process.env.HCA_USERINFO_URL ?? "https://auth.hackclub.com/oauth/userinfo",
				},
				{
					authorizationUrl: `${process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"}/oauth/authorize`,
					clientId: process.env.HACKATIME_CLIENT_ID ?? "",
					clientSecret: process.env.HACKATIME_CLIENT_SECRET ?? "",
					disableImplicitSignUp: true,
					// Link-only. better-auth 1.7 registers generic OAuth providers as first-class social providers, so without this anyone could POST /api/auth/sign-in/social {"provider":"hackatime"} and mint a Half-Life account under an email Hackatime never verified – bypassing HCA identity entirely, and reaching the superadmin bootstrap below.
					disableSignUp: true,
					getUserInfo: async ({ accessToken }) => {
						const base = process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"
						// Retried, so a single timeout at Hackatime does not fail a link. See lib/fetch-retry.
						const res = await fetchWithRetry(`${base}/api/v1/authenticated/me`, {
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
							createdAt: new Date(),
							email: linkOnlyEmail("hackatime", String(data.id)),
							emailVerified: false,
							id: String(data.id),
							name: data.github_username || data.slack_id || String(data.id),
							updatedAt: new Date(),
						}
					},
					pkce: true,
					providerId: "hackatime",
					scopes: ["profile"],
					tokenUrl: `${process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"}/oauth/token`,
					userInfoUrl: `${process.env.HACKATIME_API_BASE ?? "https://hackatime.hackclub.com"}/api/v1/authenticated/me`,
				},
				{
					// Lapse's token endpoint reads the secret from the form body, as its reference client sends it.
					authentication: "post",
					authorizationUrl: `${LAPSE_API_BASE}/auth/authorize`,
					clientId: process.env.LAPSE_CLIENT_ID ?? "",
					clientSecret: process.env.LAPSE_CLIENT_SECRET ?? "",
					disableImplicitSignUp: true,
					disableSignUp: true,
					getUserInfo: async ({ accessToken }) => {
						const res = await fetchWithRetry(`${LAPSE_API_BASE}/user/myself`, {
							headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
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
							createdAt: new Date(),
							email: linkOnlyEmail("lapse", user.id),
							emailVerified: false,
							id: user.id,
							image: user.profilePictureUrl,
							name: user.displayName || user.handle,
							updatedAt: new Date(),
						}
					},
					pkce: true,
					// Where timelapses live. Link-only for the same reason as Hackatime: Lapse is not an identity we trust to create accounts, it is a library of recordings attached to one we already have.
					//
					// Lapse issues 30-day access tokens and no refresh tokens, so an expired token is handled as "not linked" (see lib/lapse.ts) and the timelapse tab offers Sign in with Lapse again.
					providerId: "lapse",
					scopes: ["user:read", "timelapse:read"],
					tokenUrl: `${LAPSE_API_BASE}/auth/token`,
				},
				{
					// GitHub's token endpoint reads the client from the form body.
					authentication: "post",
					authorizationUrl: "https://github.com/login/oauth/authorize",
					clientId: process.env.GITHUB_CLIENT_ID ?? "",
					clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
					disableImplicitSignUp: true,
					disableSignUp: true,
					getUserInfo: async ({ accessToken }) => {
						if (!accessToken) return null
						const res = await fetchWithRetry("https://api.github.com/user", {
							headers: {
								Accept: "application/vnd.github+json",
								Authorization: `Bearer ${accessToken}`,
								"X-GitHub-Api-Version": "2022-11-28",
							},
							signal: AbortSignal.timeout(10_000),
						})
						if (!res.ok) return null
						const data = (await res.json()) as {
							id: number
							login: string
							name?: string | null
							avatar_url?: string
						}
						return {
							createdAt: new Date(),
							email: linkOnlyEmail("github", data.login),
							emailVerified: false,
							// The numeric id, not the login: a login can be renamed and the account row has to survive that.
							id: String(data.id),
							image: data.avatar_url,
							name: data.name || data.login,
							updatedAt: new Date(),
						}
					},
					// Where the repo sync writes. Link-only for the same reason as Hackatime and Lapse: GitHub here is not an identity we create accounts from, it is an authorisation to push to one repository, granted by someone we already know. Making it a sign-in provider would mean GitHub proved an email for an account HCA is supposed to be the sole source of.
					//
					// `repo` is a broad scope – it is write access to every repository the person can push to. That is what GitHub offers; there is no narrower one that covers committing to an arbitrary user-chosen repo. It is asked for at link time, the account picker explains what it is for, and the sync only ever touches the one repo a maker names.
					providerId: "github",
					scopes: githubScopes,
					tokenUrl: "https://github.com/login/oauth/access_token",
					userInfoUrl: "https://api.github.com/user",
				},
				{
					// GitLab's token endpoint reads the client from the form body, like GitHub's.
					authentication: "post",
					authorizationUrl: "https://gitlab.com/oauth/authorize",
					clientId: process.env.GITLAB_CLIENT_ID ?? "",
					clientSecret: process.env.GITLAB_CLIENT_SECRET ?? "",
					disableImplicitSignUp: true,
					disableSignUp: true,
					getUserInfo: async ({ accessToken }) => {
						if (!accessToken) return null
						const res = await fetchWithRetry("https://gitlab.com/api/v4/user", {
							headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
							signal: AbortSignal.timeout(10_000),
						})
						if (!res.ok) return null
						const data = (await res.json()) as {
							id: number
							username: string
							name?: string | null
							avatar_url?: string | null
						}
						return {
							createdAt: new Date(),
							email: linkOnlyEmail("gitlab", data.username),
							emailVerified: false,
							// The numeric id, not the username: a username can be changed and the account row has to survive that.
							id: String(data.id),
							image: data.avatar_url ?? undefined,
							name: data.name || data.username,
							updatedAt: new Date(),
						}
					},
					// Where the repo sync writes when a maker keeps their work on GitLab. Link-only for the same reason as GitHub: an authorisation to push to one repository, not an identity we create accounts from.
					//
					// `api` is broad – read/write over every project the person can see. GitLab offers nothing narrower that still covers creating a commit through the API (`write_repository` is Git-over-HTTP only), so this is asked for at link time and explained in the picker, exactly as GitHub's `repo` scope is.
					//
					// GitLab access tokens expire after two hours. That is why lib/forge-write reads tokens through `auth.api.getAccessToken` rather than off the account row: that call refreshes from the stored refresh token, and without it every sync an hour into a session would fail. See `forgeCredentials`.
					providerId: "gitlab",
					scopes: gitlabScopes,
					tokenUrl: "https://gitlab.com/oauth/token",
					userInfoUrl: "https://gitlab.com/api/v4/user",
				},
			],
		}),
	],

	// better-auth enables its rate limiter in production by default and gives every `/sign-in/*` path a stricter rule than the global one: 3 requests per 10 seconds. `/sign-in/social` matches it, so a person who retries – or taps the button twice, or lands back from HCA and starts again – gets a 429 for the next few seconds. 3 is right for the credential endpoints it was aimed at; it is too low for starting a browser social flow, which is one button per sign-in. Raise only that path and leave the rest of the defaults alone.
	rateLimit: {
		customRules: {
			"/sign-in/social": { max: 30, window: 10 },
		},
	},
	secret: process.env.BETTER_AUTH_SECRET,

	session: {
		// The session cookie cache used to keep sessions in an encrypted cookie for five minutes – so a session revoked on the server (signed out on another device, or deleted by hand) kept working here until its cookie expired. Disabled per the security audit (L3): every request now reads the session from the database, so revocation takes effect at once. Roles and the fraud flag were already read from the database on every request, never from a cache.
		cookieCache: {
			enabled: false,
		},
	},

	user: {
		additionalFields: {
			// HCA's nickname, what the site shows – written server-side by syncHcaProfile, like the verification status below, because a provider's profile cannot set an `input: false` field.
			displayName: { input: false, required: false, type: "string" },
			encryptedAddressCity: { input: false, required: false, returned: false, type: "string" },
			encryptedAddressCountry: { input: false, required: false, returned: false, type: "string" },
			encryptedAddressLine2: { input: false, required: false, returned: false, type: "string" },
			encryptedAddressState: { input: false, required: false, returned: false, type: "string" },
			// Never returned: they would otherwise ride along in every session response and, with the cookie cache, in the session cookie itself. Everything that reads them (Airtable sync, the admin console) goes through Prisma, not the session.
			encryptedAddressStreet: { input: false, required: false, returned: false, type: "string" },
			encryptedAddressZip: { input: false, required: false, returned: false, type: "string" },
			encryptedBirthday: { input: false, required: false, returned: false, type: "string" },
			encryptedPhone: { input: false, required: false, returned: false, type: "string" },
			fraudFlagged: { defaultValue: false, input: false, required: false, type: "boolean" },
			hackatimeUserId: { input: false, required: false, type: "string" },
			pronouns: { input: false, required: false, type: "string" },
			slackDisplayName: { input: false, required: false, type: "string" },
			slackId: { input: false, required: false, type: "string" },
			timezone: { input: false, required: false, type: "string" },
			verificationStatus: { input: false, required: false, type: "string" },
		},
	},
})
