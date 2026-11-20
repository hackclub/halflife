import "server-only"
import { readdir, stat } from "node:fs/promises"
import { join, relative, sep } from "node:path"

/**
 * Server helpers for offline reviews (`/reviews/offline`): which pictures and videos the media proxy may fetch, and which build files a reviewer's browser keeps so the review screen still runs with no connection.
 */

/**
 * Hosts the offline media proxy (`/api/reviews/media`) reads from.
 *
 * Only Hack Club's own asset hosts: Half Life's bucket, whose objects are public but are not served with CORS headers, so a browser cannot keep a copy of them itself; and Lapse's delivery hosts, whose CORS only names the production origin. A fixed list rather than whatever a journal links to, so the proxy can never be pointed at an internal address.
 */
const PROXY_HOSTS: readonly RegExp[] = Object.freeze([
	/^([a-z0-9-]+\.)*hackclub-assets\.com$/,
	/^lookout\.hackclub\.com$/,
])

export function isProxiedMediaUrl(raw: string): boolean {
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		return false
	}
	if (url.protocol !== "https:" || url.username || url.password || url.port) return false
	const uploadHost = process.env.NEXT_PUBLIC_UPLOAD_HOST?.trim().toLowerCase()
	return PROXY_HOSTS.some(host => host.test(url.hostname)) || (Boolean(uploadHost) && url.hostname === uploadHost)
}

// The build's code, styles, fonts and wasm, and its small pictures. The big pictures in `static/media` are the landing page's, which the review screen never shows.
const KEPT_EXTENSIONS = /\.(js|mjs|css|wasm|woff2?|ttf|json|svg)$/i
const SMALL_IMAGE = /\.(png|jpe?g|webp|avif|gif|ico)$/i
const SMALL_IMAGE_BYTES = 256 * 1024

let assetList: Promise<string[]> | null = null

async function walk(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true })
	const nested = await Promise.all(
		entries.map(entry => {
			const path = join(dir, entry.name)
			return entry.isDirectory() ? walk(path) : Promise.resolve([path])
		}),
	)
	return nested.flat()
}

/** The `/_next/static/...` URLs of this build that the offline page keeps. Read once per process: a build's files never change while it runs. */
export function offlineAssetPaths(): Promise<string[]> {
	assetList ??= (async () => {
		const root = join(process.cwd(), ".next", "static")
		let files: string[]
		try {
			files = await walk(root)
		} catch {
			return []
		}
		const kept: string[] = []
		for (const file of files) {
			if (file.endsWith(".map")) continue
			if (!KEPT_EXTENSIONS.test(file) && (!SMALL_IMAGE.test(file) || (await stat(file)).size > SMALL_IMAGE_BYTES))
				continue
			kept.push(`/_next/static/${relative(root, file).split(sep).join("/")}`)
		}
		return kept.toSorted()
	})()
	return assetList
}
