/**
 * The Content-Security-Policy shared by the proxy and the static headers.
 *
 * Deliberately no `script-src`/`style-src`: the app and Next's inline bootstrap both need them, and a nonce policy is a follow-up. What it does close is the quiet leak this platform cannot afford – an image or video loaded from an arbitrary host, which hands that host every reader's IP address. Images therefore come from our own bucket, the identity CDNs, and the Hack Club hosts the imported journals already use; anything else is blocked by the browser.
 */
const LEGACY_IMAGE_HOSTS = [
	// Hosts already present in imported Stasis journals. Existing entries keep rendering; a host a maker pastes tomorrow does not.
	"techovedas.com",
	"cdn.2008000.xyz",
]

export function contentSecurityPolicy(): string {
	const img = new Set([
		"'self'",
		"data:",
		"blob:",
		"https://slack-edge.com",
		"https://*.slack-edge.com",
		"https://hackclub.com",
		"https://*.hackclub.com",
		"https://hackclub-assets.com",
		"https://*.hackclub-assets.com",
		// Cachet answers some people with a redirect to Gravatar or GitHub rather than a Slack CDN URL.
		"https://secure.gravatar.com",
		"https://*.gravatar.com",
		"https://avatars.githubusercontent.com",
		// Lapse's public delivery host, which serves timelapse thumbnails and playback.
		"https://lapse-hackclub.link",
		"https://*.lapse-hackclub.link",
	])
	const media = new Set([
		"'self'",
		"blob:",
		"https://hackclub.com",
		"https://*.hackclub.com",
		"https://*.hackclub-assets.com",
		"https://lapse-hackclub.link",
		"https://*.lapse-hackclub.link",
	])

	const addOrigin = (value: string | undefined, target: Set<string>): void => {
		if (!value) return
		try {
			const url = new URL(value)
			if (url.protocol === "https:") target.add(url.origin)
		} catch {
			// A malformed override is ignored rather than taking the header down with it.
		}
	}

	addOrigin(process.env.CACHET_BASE_URL ?? "https://cachet.dunkirk.sh", img)
	const uploadHost = process.env.NEXT_PUBLIC_UPLOAD_HOST?.trim()
	if (uploadHost) {
		img.add(`https://${uploadHost}`)
		media.add(`https://${uploadHost}`)
	}
	for (const host of [...LEGACY_IMAGE_HOSTS, ...(process.env.JOURNAL_IMAGE_HOSTS ?? "").split(",")]) {
		const trimmed = host.trim()
		if (trimmed) img.add(`https://${trimmed}`)
	}

	return [
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"object-src 'none'",
		`img-src ${[...img].join(" ")}`,
		`media-src ${[...media].join(" ")}`,
	].join("; ")
}
