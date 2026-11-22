// The offline review service worker (see src/components/review/offline). Registered with scope `/reviews/offline`, so it only ever answers that page and the workers it starts – the rest of the site, online reviewing included, never goes through it.
//
// - The page itself: the network, but if that fails or takes more than a few seconds, the copy kept from the last visit, so `/reviews/offline` opens with no connection.
// - Build files (`/_next/static`): kept on first use, served from the copy after that. They are content-hashed, so a copy is never stale.
// - Everything else the page asks for: the downloaded packs first (Cache Storage, filled by the page when a submission is downloaded), then the network.
// - `/reviews/offline/media?url=…`: a downloaded video, by the address it came from. Firefox never sends a <video>'s request for another host through a service worker, so the page plays downloaded videos from this same-origin address instead.
const META = "halflife-offline-meta"
const ASSETS = "halflife-offline-assets"
const SHELL = "/__offline/shell"
const ASSET_LIST = "/api/reviews/offline-assets"
const NAVIGATION_TIMEOUT_MS = 4000
const CONVERT = /^\/api\/reviews\/[^/]+\/files\/convert$/

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()))

self.addEventListener("fetch", event => {
	const { request } = event
	const url = new URL(request.url)
	const local = url.origin === self.location.origin
	if (request.method === "POST" && local && CONVERT.test(url.pathname)) {
		event.respondWith(convert(request, url))
		return
	}
	if (request.method !== "GET") return
	if (request.mode === "navigate") event.respondWith(navigate(event))
	else if (local && url.pathname === "/reviews/offline/media") event.respondWith(media(request, url))
	else if (local && url.pathname.startsWith("/_next/static/")) event.respondWith(asset(request))
	else event.respondWith(fromPacks(request))
})

const json = (value, status = 200) =>
	new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" }, status })

async function navigate(event) {
	const { request } = event
	const shell = async () => (await caches.open(META)).match(SHELL)
	const network = (async () => {
		const response = await fetch(request)
		if (response.ok && (response.headers.get("Content-Type") ?? "").includes("text/html")) {
			const copy = response.clone()
			event.waitUntil(
				(async () => {
					await (await caches.open(META)).put(SHELL, copy)
					// A fresh page may be a new build: keep its files too, so it still starts once the connection is gone.
					await keepAssets()
				})().catch(() => undefined),
			)
		}
		return response
	})()
	// Handled below; this only stops a failure that lost the race from being reported as unhandled.
	network.catch(() => undefined)
	const timeout = new Promise(resolve => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS))
	try {
		const first = await Promise.race([network, timeout])
		if (first) return first
		// Slow: the kept copy if there is one, else keep waiting for the network.
		return (await shell()) ?? (await network)
	} catch {
		const kept = await shell()
		if (kept) return kept
		return new Response(
			'<!doctype html><title>Offline</title><p style="font:16px system-ui;padding:2rem">Offline reviews haven\'t been set up on this device yet. Open this page once with a connection.</p>',
			{
				headers: { "Content-Type": "text/html; charset=utf-8" },
				status: 503,
			},
		)
	}
}

async function keepAssets() {
	const response = await fetch(ASSET_LIST, { credentials: "same-origin", headers: { Accept: "application/json" } })
	if (!response.ok) return
	const { assets } = await response.json()
	const cache = await caches.open(ASSETS)
	const keys = await cache.keys()
	// The page kept above replaces the last one, so an earlier build's files are never asked for again.
	const wanted = new Set(assets)
	for (const key of keys) if (!wanted.has(new URL(key.url).pathname)) await cache.delete(key)
	const have = new Set(keys.map(key => new URL(key.url).pathname))
	for (const path of assets) {
		if (have.has(path)) continue
		try {
			await cache.add(path)
		} catch {
			// One missing file is not a reason to stop keeping the rest.
		}
	}
}

async function asset(request) {
	const cache = await caches.open(ASSETS)
	const hit = await cache.match(request, { ignoreSearch: true })
	if (hit) return hit
	const response = await fetch(request)
	if (response.ok) await cache.put(request, response.clone()).catch(() => undefined)
	return response
}

async function fromPacks(request) {
	const hit = await caches.match(request.url, { ignoreVary: true })
	if (hit) {
		const range = request.headers.get("Range")
		return range && hit.type !== "opaque" ? slice(hit, range) : hit
	}
	return fetch(request)
}

async function media(request, url) {
	const target = url.searchParams.get("url") ?? ""
	const hit = await caches.match(target, { ignoreVary: true })
	if (!hit) return new Response("Not downloaded", { status: 504 })
	if (hit.type === "opaque") return new Response("Not playable offline", { status: 504 })
	const range = request.headers.get("Range")
	return range ? slice(hit, range) : hit
}

async function slice(response, range) {
	const match = /^bytes=(\d*)-(\d*)$/.exec(range)
	if (!match || (!match[1] && !match[2])) return response
	const blob = await response.blob()
	const { size } = blob
	const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
	const end = Math.min(match[1] && match[2] ? Number(match[2]) : size - 1, size - 1)
	if (start > end) return new Response(null, { headers: { "Content-Range": `bytes */${size}` }, status: 416 })
	return new Response(blob.slice(start, end + 1), {
		headers: {
			"Accept-Ranges": "bytes",
			"Content-Length": String(end - start + 1),
			"Content-Range": `bytes ${start}-${end}/${size}`,
			"Content-Type": response.headers.get("Content-Type") || blob.type,
		},
		status: 206,
	})
}

// The file viewer asks the server to convert a model too big for the browser, then downloads the result. A model converted when its submission was downloaded is answered as done; anything else goes to the server.
async function convert(request, url) {
	const converted = `${self.location.origin}${url.pathname.replace(/convert$/, "converted")}${url.search}`
	if (await caches.match(converted)) return json({ state: "done" })
	try {
		return await fetch(request)
	} catch {
		return json({ error: "This model wasn't converted before you went offline." }, 503)
	}
}
