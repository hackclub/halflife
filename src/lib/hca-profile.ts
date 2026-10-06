import "server-only"
import { fetchWithRetry } from "@/lib/fetch-retry"
import { encryptPII, isPiiConfigured } from "@/lib/pii"
import prisma from "@/lib/prisma"

/**
 * Everything this app learns from Hack Club Auth, and the one way it is read.
 *
 * HCA answers in two places, and which fields each carries depends on the
 * scopes the app is granted. The OIDC userinfo endpoint has the standard
 * claims only when their standard scopes are granted; Half Life's app is given
 * `basic_info` instead of `email`, and under it the email, verification status
 * and addresses live on HCA's own `/api/v1/me` identity — which is where Stasis
 * reads them too. So both are asked, and each field is taken from whichever
 * has it.
 *
 * Why the fields are written here rather than by better-auth's
 * `mapProfileToUser`: they are declared `input: false`, so a participant cannot
 * set `verificationStatus` to "verified" on themselves through update-user —
 * and better-auth 1.7 applies that same rule to a provider's profile,
 * silently dropping every one of them at sign-up. The protection has to stay,
 * so the server writes them from HCA's own answer.
 *
 * It runs at every sign-in, and again at submit, so a status that changed
 * since (most often "pending" becoming "verified") and the address a grant
 * ships to are always current.
 */

export const PULL_PII = process.env.PULL_HCA_PII === "true" && isPiiConfigured()

const DISCOVERY_URL = process.env.HCA_DISCOVERY_URL ?? "https://auth.hackclub.com/.well-known/openid-configuration"
const ME_URL = process.env.HCA_ME_URL ?? "https://auth.hackclub.com/api/v1/me"

const TIMEOUT_MS = 10_000

export interface HcaAddress {
	line1: string | null
	line2: string | null
	city: string | null
	state: string | null
	zip: string | null
	country: string | null
}

/** One HCA identity, whichever endpoint each field came from. */
export interface HcaIdentity {
	/** The OIDC subject — what the account row is keyed on. */
	sub: string | null
	email: string | null
	emailVerified: boolean
	/** "first last" — the string the sinks that need a whole person keep. */
	name: string | null
	/**
	 * HCA's `nickname` claim under `profile`: what they go by. This is the name
	 * the site shows; see lib/display-name for the rule and its fallback.
	 */
	nickname: string | null
	image: string | null
	slackId: string | null
	verificationStatus: string | null
	address: HcaAddress | null
	birthdate: string | null
}

/**
 * HCA's OIDC endpoints, resolved once and kept.
 *
 * Read from the discovery document when it answers, because that is the only
 * authority on where HCA's endpoints live. But HCA sits behind Cloudflare and
 * rate-limits its own discovery and docs endpoints (`429`, `retry-after: 300`),
 * and better-auth fetches discovery EXACTLY ONCE at startup: a 429 in that
 * instant used to register no `hca` provider at all, and every later sign-in
 * failed with "Provider not found". It also broke this module's own
 * `userinfoUrl`, which threw on the same fetch.
 *
 * So the document is wanted but never depended on. When it answers, it is used;
 * when it does not, the endpoints fall back to HCA's published, stable routes —
 * the same paths its `auth` app mounts (`/oauth/authorize`, `/oauth/token` from
 * Doorkeeper, `/oauth/userinfo` and `/oauth/discovery/keys` from
 * doorkeeper-openid_connect). These are what the discovery document returns, so
 * the fallback is not a guess about a different service; it is the same answer
 * with the network taken out of the path. `userinfo_endpoint` and `issuer`
 * default to the base, and `HCA_*` env overrides win if a deployment needs a
 * different host.
 */
export interface HcaEndpoints {
	authorizationUrl: string
	tokenUrl: string
	userinfoUrl: string
	jwksUrl: string
	issuer: string
	/** Whether discovery answered; false means the static fallback was used. */
	discovered: boolean
}

let endpointsPromise: Promise<HcaEndpoints> | null = null

export function hcaEndpoints(): Promise<HcaEndpoints> {
	endpointsPromise ??= resolveHcaEndpoints()
	return endpointsPromise
}

async function resolveHcaEndpoints(): Promise<HcaEndpoints> {
	const staticEndpoints: HcaEndpoints = {
		authorizationUrl: process.env.HCA_AUTHORIZATION_URL ?? "https://auth.hackclub.com/oauth/authorize",
		tokenUrl: process.env.HCA_TOKEN_URL ?? "https://auth.hackclub.com/oauth/token",
		userinfoUrl: process.env.HCA_USERINFO_URL ?? "https://auth.hackclub.com/oauth/userinfo",
		jwksUrl: process.env.HCA_JWKS_URL ?? "https://auth.hackclub.com/oauth/discovery/keys",
		issuer: process.env.HCA_ISSUER ?? "https://auth.hackclub.com",
		discovered: false,
	}
	try {
		const res = await fetchWithRetry(DISCOVERY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS), retries: 2 })
		if (!res.ok) {
			console.warn(`[hca] discovery returned ${res.status}; using the built-in endpoints`)
			return staticEndpoints
		}
		const config = (await res.json()) as {
			authorization_endpoint?: string
			token_endpoint?: string
			userinfo_endpoint?: string
			jwks_uri?: string
			issuer?: string
		}
		return {
			// Each field falls back on its own, so a partial document still helps.
			authorizationUrl: config.authorization_endpoint ?? staticEndpoints.authorizationUrl,
			tokenUrl: config.token_endpoint ?? staticEndpoints.tokenUrl,
			userinfoUrl: config.userinfo_endpoint ?? staticEndpoints.userinfoUrl,
			jwksUrl: config.jwks_uri ?? staticEndpoints.jwksUrl,
			issuer: config.issuer ?? staticEndpoints.issuer,
			discovered: true,
		}
	} catch (err) {
		console.warn("[hca] discovery fetch failed; using the built-in endpoints:", err)
		return staticEndpoints
	}
}

async function userinfoUrl(): Promise<string> {
	return (await hcaEndpoints()).userinfoUrl
}

async function getJson(url: string, accessToken: string): Promise<Record<string, unknown> | null> {
	try {
		// Retried, like the forges' identity calls (lib/fetch-retry). A dropped
		// packet here used to abort the OAuth callback with a raw TimeoutError.
		const res = await fetchWithRetry(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
			cache: "no-store",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
		if (!res.ok) {
			console.warn(`[hca] ${url} returned ${res.status}`)
			return null
		}
		return (await res.json()) as Record<string, unknown>
	} catch (err) {
		console.warn(`[hca] ${url} failed:`, err)
		return null
	}
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/** The address to ship to: the one marked primary, else the first. */
function addressFrom(me: Record<string, unknown> | null, userinfo: Record<string, unknown> | null): HcaAddress | null {
	const list = Array.isArray(me?.addresses) ? (me.addresses as Record<string, unknown>[]) : []
	const a = list.find((x) => x?.primary === true) ?? list[0]
	if (a) {
		return {
			line1: str(a.line_1),
			line2: str(a.line_2),
			city: str(a.city),
			state: str(a.state),
			zip: str(a.postal_code),
			country: str(a.country),
		}
	}
	// The standard OIDC claim, when the `address` scope puts it there instead.
	const o = userinfo?.address as Record<string, unknown> | undefined
	if (o && typeof o === "object") {
		const [line1, ...more] = (str(o.street_address) ?? "").split(/\r?\n/)
		return {
			line1: str(line1),
			line2: str(more.join(", ")),
			city: str(o.locality),
			state: str(o.region),
			zip: str(o.postal_code),
			country: str(o.country),
		}
	}
	return null
}

/** Read one person's identity from HCA with their access token. */
export async function fetchHcaIdentity(accessToken: string): Promise<HcaIdentity> {
	const [userinfo, meBody] = await Promise.all([
		getJson(await userinfoUrl(), accessToken),
		getJson(ME_URL, accessToken),
	])
	const me = (meBody?.identity as Record<string, unknown> | undefined) ?? meBody

	const email = str(userinfo?.email) ?? str(me?.primary_email)
	const name =
		str(userinfo?.name) ?? ([str(userinfo?.given_name), str(userinfo?.family_name)].filter(Boolean).join(" ") || null)

	return {
		sub: str(userinfo?.sub) ?? str(me?.id),
		email,
		// HCA signs people in by emailing them a code, so the address it holds is
		// one they have proven they read. The explicit claim wins when present.
		emailVerified: typeof userinfo?.email_verified === "boolean" ? userinfo.email_verified : email !== null,
		name,
		// The `profile` scope's nickname claim. HCA answers it from its own
		// name field, and `/api/v1/me` carries no equivalent, so unlike the
		// others there is no second endpoint to fall back to — a missing one
		// leaves null and the display falls back to `name`.
		nickname: str(userinfo?.nickname),
		image: str(userinfo?.picture),
		slackId: str(userinfo?.slack_id) ?? str(me?.slack_id),
		verificationStatus: str(userinfo?.verification_status) ?? str(me?.verification_status),
		address: addressFrom(me, userinfo),
		birthdate: str(userinfo?.birthdate) ?? str(me?.birthday),
	}
}

/** The PII fields, encrypted, when this deployment is set up to keep them. */
export function encryptedFieldsFrom(identity: HcaIdentity): Record<string, string> {
	if (!PULL_PII) return {}
	const out: Record<string, string> = {}
	const a = identity.address
	if (a?.line1) out.encryptedAddressStreet = encryptPII(a.line1)
	if (a?.line2) out.encryptedAddressLine2 = encryptPII(a.line2)
	if (a?.city) out.encryptedAddressCity = encryptPII(a.city)
	if (a?.state) out.encryptedAddressState = encryptPII(a.state)
	if (a?.zip) out.encryptedAddressZip = encryptPII(a.zip)
	if (a?.country) out.encryptedAddressCountry = encryptPII(a.country)
	if (identity.birthdate) out.encryptedBirthday = encryptPII(identity.birthdate)
	return out
}

/**
 * Adopt HCA's proof of an address onto a pre-existing local user, so that
 * better-auth's implicit account linking can attach the HCA identity.
 *
 * better-auth refuses to link an incoming OAuth identity to a local user that
 * is not already `emailVerified` (`account.accountLinking.requireLocalEmailVerified`
 * defaults true). That gate guards against somebody pre-registering an
 * unverified account at a victim's address — but in this app nobody can
 * pre-register a Half Life user: the only unverified, account-less rows are
 * made by staff imports (the Airtable warm-up import and the Stasis import).
 * A participant created that way therefore dead-ends at `account_not_linked`
 * on their first Hack Club sign-in, with no way in.
 *
 * When HCA itself reports the address verified, that is the same ownership
 * proof better-auth would accept, so it is copied onto the matching row and the
 * normal signing-in path completes. An unverified claim changes nothing: it
 * must not become a way into a pre-created account.
 *
 * The address is matched exactly as better-auth matches it — lowercased, as
 * its own `findUserByEmail` does — so the row repaired here is the row it will
 * look up next.
 *
 * Returns whether a row was changed, so the caller can say so in the log.
 */
export async function adoptHcaVerifiedEmail(email: string, emailVerified: boolean): Promise<boolean> {
	if (!emailVerified) return false
	const user = await prisma.user.findUnique({
		where: { email: email.toLowerCase() },
		select: { id: true, emailVerified: true },
	})
	if (!user || user.emailVerified) return false
	await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } })
	return true
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

		const identity = await fetchHcaIdentity(accessToken)
		await prisma.user.update({
			where: { id: userId },
			data: {
				// Only what HCA actually said: a missing field leaves the stored value.
				...(identity.verificationStatus ? { verificationStatus: identity.verificationStatus } : {}),
				// The name the site shows, alongside `name` rather than instead of
				// it: better-auth's own mapping cannot carry this (see the header),
				// and the Airtable rows, Ari and the export still need the full
				// name they split into first and last. See lib/display-name.
				...(identity.nickname ? { displayName: identity.nickname } : {}),
				...encryptedFieldsFrom(identity),
			},
		})
		// Apart, because slackId is unique: a clash with another row must not
		// cost this user their verification status.
		if (identity.slackId) {
			await prisma.user
				.update({ where: { id: userId }, data: { slackId: identity.slackId } })
				.catch((err) => console.warn(`[hca] slack id for ${userId} not stored:`, err))
		}
		return identity.verificationStatus
	} catch (err) {
		console.warn(`[hca] profile sync for ${userId} failed:`, err)
		return null
	}
}
