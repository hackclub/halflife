/**
 * Where a person's picture comes from.
 *
 * Hack Club's faces live in Slack, but Slack's own image URLs expire and `users.info` needs a bot token, so a profile picture is read through Cachet – a cache that answers a stable redirect for a Slack user id. HCA's `image` is the fallback for anyone who has no Slack id on file yet.
 *
 * Deliberately pure (no server-only) so both the server queries and a renderer can name it. The base is overridable for a self-hosted Cachet.
 */
const CACHET_BASE = (process.env.CACHET_BASE_URL ?? "https://cachet.dunkirk.sh").replace(/\/$/, "")

/**
 * The hosts a profile picture may come from.
 *
 * `image` is whatever the identity provider stored, so an arbitrary URL there is a tracking pixel: every page that shows the person would make the reader's browser fetch that host, handing it their IP. Known CDNs are allowed; anything else falls back to the initial.
 */
function allowedAvatarHost(hostname: string): boolean {
	const host = hostname.toLowerCase()
	if (host === "slack-edge.com" || host.endsWith(".slack-edge.com")) return true
	if (host === "hackclub.com" || host.endsWith(".hackclub.com")) return true
	if (host === "hackclub-assets.com" || host.endsWith(".hackclub-assets.com")) return true
	if (host === "dunkirk.sh" || host.endsWith(".dunkirk.sh")) return true
	// Identity CDNs, matching the img-src allowlist in lib/csp: Cachet redirects here for some people, and an HCA fallback image may name them directly.
	if (host.endsWith(".gravatar.com")) return true
	if (host === "avatars.githubusercontent.com") return true
	if (process.env.NEXT_PUBLIC_UPLOAD_HOST?.toLowerCase() === host) return true
	try {
		return new URL(CACHET_BASE).hostname === host
	} catch {
		return false
	}
}

/**
 * Unwrap a Photon URL (`i[0-2].wp.com/<original-host>/<path>`) back to the origin it proxies. Photon is what Gravatar 302s its default avatars through, so an HCA `image` that names one is a Slack/Gravatar face behind one hop, not an arbitrary host. Returning the origin keeps the browser off Automattic's CDN entirely; an origin that would not be allowed directly still falls back to the initial.
 */
function unwrapPhoton(url: URL): URL {
	if (!/^i[0-2]\.wp\.com$/i.test(url.hostname)) return url
	const [, originalHost, ...rest] = url.pathname.split("/")
	if (!originalHost) return url
	try {
		const original = new URL(`https://${originalHost}/${rest.join("/")}`)
		return original.protocol === "https:" ? original : url
	} catch {
		return url
	}
}

export function avatarUrl(user: { slackId?: string | null; image?: string | null } | null | undefined): string | null {
	if (!user) return null
	if (user.slackId) return `${CACHET_BASE}/users/${encodeURIComponent(user.slackId)}/r`
	if (!user.image) return null
	try {
		const parsed = new URL(user.image)
		if (/^i[0-2]\.wp\.com$/i.test(parsed.hostname)) {
			const url = unwrapPhoton(parsed)
			return url.protocol === "https:" && allowedAvatarHost(url.hostname) ? url.toString() : null
		}
		return parsed.protocol === "https:" && allowedAvatarHost(parsed.hostname) ? user.image : null
	} catch {
		return null
	}
}
