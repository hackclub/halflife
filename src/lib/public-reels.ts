/**
 * Where a reel can be posted publicly, and how a link to one is read.
 *
 * Shared by the dialog that collects the links and the route that stores them, so the field says "that isn't a TikTok link" for exactly the links the server would refuse. Pure: no server imports, safe in the browser.
 */

export const PUBLIC_REEL_PLATFORMS = ["INSTAGRAM", "TIKTOK", "X", "YOUTUBE"] as const
export type PublicReelPlatform = (typeof PUBLIC_REEL_PLATFORMS)[number]

export const PLATFORM_INFO: Record<PublicReelPlatform, { label: string; example: string; hosts: string[] }> = {
	INSTAGRAM: {
		example: "instagram.com/reel/…",
		hosts: ["instagram.com"],
		label: "Instagram",
	},
	TIKTOK: {
		example: "tiktok.com/@you/video/…",
		hosts: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
		label: "TikTok",
	},
	X: {
		example: "x.com/you/status/…",
		hosts: ["x.com", "twitter.com"],
		label: "X (Twitter)",
	},
	YOUTUBE: {
		example: "youtube.com/shorts/…",
		hosts: ["youtube.com", "youtu.be"],
		label: "YouTube Shorts",
	},
}

/** The hashtag every public post carries, so the programme can find them all. */
export const PUBLIC_REEL_HASHTAG = "#hackclubhalflife"

/**
 * A pasted link, checked against its platform and tidied into the one form it is stored and de-duplicated in: https, lower-case host without `www.` or `m.`, no trailing slash, and no query or fragment – share links carry per-share tracking (`?igsh=`, `?t=`, `?si=`) that would let the same post be claimed twice. YouTube keeps `v`, the one query that names the video.
 *
 * Returns the tidy URL, or why it cannot be used.
 */
export function readPublicReelLink(platform: PublicReelPlatform, raw: string): { url: string } | { error: string } {
	const info = PLATFORM_INFO[platform]
	const text = raw.trim()
	if (!text) return { error: `Paste the link to your ${info.label} post.` }
	let url: URL
	try {
		url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
	} catch {
		return { error: `That isn't a link. Copy it from the post's Share button on ${info.label}.` }
	}
	const seen = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "")
	if (!info.hosts.some(h => seen === h || seen.endsWith(`.${h}`)))
		return { error: `That isn't a ${info.label} link – it should look like ${info.example}` }

	// One post, one link: X still answers on its old name, and the same status shared from each would otherwise be two claims on one post.
	const host = seen === "twitter.com" ? "x.com" : seen
	const path = url.pathname.replace(/\/+$/, "")
	if (!path) return { error: `That's ${info.label} itself, not a post. Open your post and copy its link.` }
	const v = platform === "YOUTUBE" ? url.searchParams.get("v") : null
	return { url: `https://${host}${path}${v ? `?v=${encodeURIComponent(v)}` : ""}` }
}
