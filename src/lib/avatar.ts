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
	if (host.endsWith(".slack-edge.com")) return true
	if (host.endsWith(".hackclub.com") || host.endsWith(".hackclub-assets.com")) return true
	if (process.env.NEXT_PUBLIC_UPLOAD_HOST?.toLowerCase() === host) return true
	try {
		return new URL(CACHET_BASE).hostname === host
	} catch {
		return false
	}
}

export function avatarUrl(user: { slackId?: string | null; image?: string | null } | null | undefined): string | null {
	if (!user) return null
	if (user.slackId) return `${CACHET_BASE}/users/${encodeURIComponent(user.slackId)}/r`
	if (!user.image) return null
	try {
		const url = new URL(user.image)
		return url.protocol === "https:" && allowedAvatarHost(url.hostname) ? user.image : null
	} catch {
		return null
	}
}
