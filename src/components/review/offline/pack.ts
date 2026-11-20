"use client"

import { lapseId } from "@/components/review/lapse"
import {
	type OfflinePack,
	packCacheName,
	registerWorker,
	type StoredDetail,
	updatePacks,
	writeDetail,
	writeViewer,
} from "@/components/review/offline/store"
import type { ReviewDetail, ReviewViewer } from "@/lib/review-platform/types"

/**
 * Downloads submissions for offline review: everything their review screen will ask for, kept under the address it asks for it by, so the service worker can answer each request from the copy.
 *
 * The same reads the screen makes online – the file viewer's tree, commits, compares and raw files, the Airtable preview, Lapse's answers and videos, the journal's pictures – through the same routes, so nothing here decides anything the server doesn't. Pictures from Half Life's own bucket come through `/api/reviews/media`, because the bucket sends no CORS headers and the browser could not otherwise keep them.
 */

const META = "halflife-offline-meta"
const ASSETS = "halflife-offline-assets"
const SHELL = "/__offline/shell"
const OFFLINE_PAGE = "/reviews/offline"
const RAW = "https://raw.githubusercontent.com"
const MEDIA = "https://media.githubusercontent.com/media"
const LAPSE_API = "https://api.lapse.hackclub.com/api/timelapse/query"
const LFS_POINTER = "version https://git-lfs.github.com/spec/"
// The file viewer's own limits (hurt/core/prefetch.ts): what it would read ahead online is what is worth keeping.
const MAX_FILE_BYTES = 150 * 1024 * 1024
const MAX_REPO_BYTES = 750 * 1024 * 1024
// Models over this go to the server to convert (hurt/viewers/model/server.ts).
const OCCT_LIMIT = 100e6
const CONVERTIBLE = new Set(["step", "stp", "iges", "igs", "brep", "brp"])
const RISKY = new Set([
	"exe",
	"dll",
	"msi",
	"bat",
	"cmd",
	"com",
	"pif",
	"ps1",
	"vbs",
	"vbe",
	"wsf",
	"hta",
	"jar",
	"lnk",
	"apk",
	"dmg",
	"iso",
	"reg",
	"msc",
	"cpl",
	"scr",
])
const ATTACHMENT =
	/https:\/\/github\.com\/user-attachments\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
const IMG_SRC = /<(?:img|video|source)\b[^>]*\ssrc="(https:\/\/[^"]+)"/gi
const PROXIED_HOSTS: readonly RegExp[] = Object.freeze([
	/^([a-z0-9-]+\.)*hackclub-assets\.com$/,
	/^lookout\.hackclub\.com$/,
])
const CONVERT_POLL_MS = 3000
const CONVERT_LIMIT_MS = 10 * 60 * 1000

export interface PackOptions {
	/** Timelapse videos are most of a pack's size; without them, a submission still opens with everything else. */
	videos: boolean
}

export interface PackProgress {
	done: number
	id: string
	label: string
	total: number
}

interface Tally {
	bytes: number
	missing: number
}

interface SnapshotFile {
	path: string
	size: number
	submodule?: true
}

interface Snapshot {
	files: SnapshotFile[]
	repo: string
	sha: string
}

interface Commit {
	date: string | null
	sha: string
}

interface ShipMark {
	id: string
	reviewed_at: string | null
	submitted_at: string
}

function sleep(ms: number): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>()
	setTimeout(resolve, ms)
	return promise
}
const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/")
const extensionOf = (path: string): string => path.split(".").pop()?.toLowerCase() ?? ""

/** A fetch that rides out a dropped connection (a few tries, backing off) and the file routes' limit of 120 calls a minute (waits out a 429). */
async function patient(input: string, init: RequestInit = {}): Promise<Response> {
	let failures = 0
	while (true)
		try {
			const response = await fetch(input, init)
			if (response.status !== 429) return response
			await response.body?.cancel()
			await sleep(10_000 + Math.random() * 5000)
		} catch (err) {
			if (++failures >= 4) throw err
			await sleep(1000 * 2 ** failures)
		}
}

const same = (
	url: string,
	init: Omit<RequestInit, "headers"> & { headers?: { [_: string]: string } } = {},
): Promise<Response> =>
	patient(url, { credentials: "same-origin", ...init, headers: { Accept: "application/json", ...init.headers } })

/** Keeps a response under a key, counting its bytes. The body is read whole, so a cut-off download is a failure rather than half a file. */
async function keep(cache: Cache, key: string, response: Response, tally: Tally): Promise<Blob> {
	if (!response.ok) throw new Error(String(response.status))
	const blob = await response.blob()
	await cache.put(
		key,
		new Response(blob, { headers: { "Content-Type": response.headers.get("Content-Type") ?? blob.type } }),
	)
	tally.bytes += blob.size
	return blob
}

async function keepOrCount(
	cache: Cache,
	key: string,
	load: () => Promise<Response>,
	tally: Tally,
): Promise<Blob | null> {
	if (await cache.match(key)) return null
	try {
		return await keep(cache, key, await load(), tally)
	} catch {
		tally.missing++
		return null
	}
}

function proxied(url: string): boolean {
	try {
		const { hostname } = new URL(url)
		const upload = process.env.NEXT_PUBLIC_UPLOAD_HOST?.trim().toLowerCase()
		return PROXIED_HOSTS.some(host => host.test(hostname)) || hostname === upload
	} catch {
		return false
	}
}

/** A picture or video from anywhere: straight from its host when CORS allows, through `/api/reviews/media` for Hack Club's own hosts, and otherwise as an opaque copy, which still shows in an <img>. */
async function keepMedia(cache: Cache, url: string, tally: Tally): Promise<void> {
	if (await cache.match(url)) return
	try {
		const direct = await patient(url, { credentials: "omit", mode: "cors" }).catch(() => null)
		if (direct?.ok) {
			await keep(cache, url, direct, tally)
			return
		}
		await direct?.body?.cancel()
		if (proxied(url)) {
			await keep(
				cache,
				url,
				await same(`/api/reviews/media?${new URLSearchParams({ url })}`, { headers: { Accept: "*/*" } }),
				tally,
			)
			return
		}
		await cache.put(url, await patient(url, { credentials: "omit", mode: "no-cors" }))
	} catch {
		tally.missing++
	}
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
	const queue = [...items]
	await Promise.all(
		Array.from({ length: Math.min(size, queue.length) }, async () => {
			for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item)
		}),
	)
}

/** The build's files and the page itself, so `/reviews/offline` starts with no connection. */
async function keepShell(): Promise<void> {
	const page = await same(OFFLINE_PAGE, { headers: { Accept: "text/html" } })
	if (!page.ok) throw new Error(`The offline page answered ${page.status}`)
	await (await caches.open(META)).put(SHELL, page)
	const list = await same("/api/reviews/offline-assets")
	if (!list.ok) throw new Error(`The asset list answered ${list.status}`)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route's own JSON
	const { assets } = (await list.json()) as { assets: string[] }
	const cache = await caches.open(ASSETS)
	const keys = await cache.keys()
	// Files of earlier builds are never asked for again once the page they belong to has been replaced.
	const wanted = new Set(assets)
	for (const key of keys) if (!wanted.has(new URL(key.url).pathname)) await cache.delete(key)
	const have = new Set(keys.map(key => new URL(key.url).pathname))
	await pool(
		assets.filter(path => !have.has(path)),
		6,
		async path => {
			await cache.add(path).catch(() => undefined)
		},
	)
}

function commitAt(commits: Commit[], iso: string | null): Commit | null {
	if (!iso) return null
	const time = Date.parse(iso)
	return commits.find(commit => commit.date !== null && Date.parse(commit.date) <= time) ?? null
}

/** The compare ranges the Changes panel offers (hurt/changes/ChangesPanel.tsx `presets`). */
function presets(commits: Commit[], ships: ShipMark[], shipId: string): { base: string; head: string }[] {
	const head = commits[0]?.sha
	if (!head) return []
	const list: { base: string; head: string }[] = []
	const index = ships.findIndex(ship => ship.id === shipId)
	const previous = index > 0 ? ships[index - 1] : null
	const atPrevious = previous ? commitAt(commits, previous.reviewed_at ?? previous.submitted_at) : null
	if (atPrevious && atPrevious.sha !== head) list.push({ base: atPrevious.sha, head })
	const handIn = index === -1 ? null : ships[index]
	const atSubmission = handIn ? commitAt(commits, handIn.submitted_at) : null
	if (atSubmission && atSubmission.sha !== head) list.push({ base: atSubmission.sha, head })
	if (commits[1]) list.push({ base: commits[1].sha, head })
	return list
}

/** A model too big for the browser: converted on the server now, so the viewer finds the result offline (the worker answers its conversion request as done). */
async function keepConversion(
	cache: Cache,
	id: string,
	snapshot: Snapshot,
	file: SnapshotFile,
	tally: Tally,
): Promise<void> {
	const base = `/api/reviews/${encodeURIComponent(id)}/files`
	const query = new URLSearchParams({ path: file.path, sha: snapshot.sha })
	const converted = `${base}/converted?${query}`
	if (await cache.match(converted)) return
	const started = Date.now()
	try {
		while (true) {
			const status = await same(`${base}/convert?${query}`, { method: "POST" })
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route's own JSON
			const body = (await status.json().catch(() => null)) as { state?: string } | null
			if (!status.ok || !body || body.state === "failed") throw new Error("conversion failed")
			if (body.state === "done") break
			if (Date.now() - started > CONVERT_LIMIT_MS) throw new Error("conversion took too long")
			await sleep(CONVERT_POLL_MS)
		}
		await keep(cache, converted, await same(converted, { headers: { Accept: "*/*" } }), tally)
	} catch {
		tally.missing++
	}
}

async function packRepo(cache: Cache, id: string, tally: Tally): Promise<void> {
	const base = `/api/reviews/${encodeURIComponent(id)}/files`
	const listing = await same(base)
	if (!listing.ok) {
		// A repository GitHub won't hand over answers the same offline as online: keep the refusal.
		if (listing.status === 404) await cache.put(base, listing)
		else tally.missing++
		return
	}
	const snapshotBlob = await keep(cache, base, listing, tally)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route's own JSON
	const snapshot = JSON.parse(await snapshotBlob.text()) as Snapshot

	const commitsBlob = await keepOrCount(cache, `${base}/commits`, () => same(`${base}/commits`), tally)
	if (commitsBlob) {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route's own JSON
		const history = JSON.parse(await commitsBlob.text()) as { commits: Commit[]; ships: ShipMark[] }
		for (const range of presets(history.commits, history.ships, id)) {
			const url = `${base}/compare?${new URLSearchParams(range)}`
			await keepOrCount(cache, url, () => same(url), tally)
		}
	}

	let budget = MAX_REPO_BYTES
	const files: SnapshotFile[] = []
	for (const file of snapshot.files.toSorted((a, b) => a.size - b.size)) {
		const ext = extensionOf(file.path)
		if (file.submodule || file.size === 0 || RISKY.has(ext)) continue
		if (CONVERTIBLE.has(ext) && file.size > OCCT_LIMIT) {
			await keepConversion(cache, id, snapshot, file, tally)
			continue
		}
		if (file.size > MAX_FILE_BYTES || file.size > budget) continue
		budget -= file.size
		files.push(file)
	}
	await pool(files, 4, async file => {
		const raw = `${RAW}/${snapshot.repo}/${snapshot.sha}/${encodePath(file.path)}`
		const blob = await keepOrCount(cache, raw, () => patient(raw, { credentials: "omit" }), tally)
		if (!blob) return
		if (blob.size <= 1024) {
			const head = await blob.text()
			if (head.startsWith(LFS_POINTER)) {
				const media = `${MEDIA}/${snapshot.repo}/${snapshot.sha}/${encodePath(file.path)}`
				await keepOrCount(cache, media, () => patient(media, { credentials: "omit" }), tally)
			}
		}
		if (!/\.(md|markdown|mdx)$/i.test(file.path)) return
		// A README's pasted pictures go through the attachment route, which redirects to a signed GitHub address; kept under the route's address, which is what the viewer asks for.
		const text = await blob.text()
		for (const match of new Set([...text.matchAll(ATTACHMENT)].map(m => m[1] ?? ""))) {
			const url = `${base}/attachment?${new URLSearchParams({ id: match, path: file.path })}`
			if (await cache.match(url)) continue
			try {
				await cache.put(url, await patient(url, { credentials: "same-origin", mode: "no-cors" }))
			} catch {
				tally.missing++
			}
		}
	})
}

/** Every picture and video the screen shows outside the file viewer. */
function mediaOf(detail: ReviewDetail): string[] {
	const urls = new Set<string>(detail.ship.imageUrls)
	for (const entry of detail.entries) {
		for (const url of entry.imageUrls) urls.add(url)
		for (const url of entry.timelapseUrls) if (!lapseId(url)) urls.add(url)
		for (const match of entry.bodyHtml.matchAll(IMG_SRC)) urls.add((match[1] ?? "").replaceAll("&amp;", "&"))
	}
	return [...urls].filter(url => url.startsWith("https://"))
}

async function packLapses(cache: Cache, detail: ReviewDetail, options: PackOptions, tally: Tally): Promise<void> {
	const ids = new Set(detail.entries.flatMap(entry => entry.timelapseUrls.map(lapseId)).filter(id => id !== null))
	for (const id of ids) {
		const api = `${LAPSE_API}?id=${encodeURIComponent(id)}`
		const blob = await keepOrCount(cache, api, () => patient(api, { credentials: "omit" }), tally)
		const answer = blob ? await blob.text() : await (await cache.match(api))?.text()
		if (!answer) continue
		let timelapse: { playbackUrl?: unknown; thumbnailUrl?: unknown } | undefined
		try {
			// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Lapse's answer, checked field by field below
			timelapse = (JSON.parse(answer) as { data?: { timelapse?: { playbackUrl?: unknown; thumbnailUrl?: unknown } } })
				.data?.timelapse
		} catch {
			continue
		}
		if (typeof timelapse?.thumbnailUrl === "string") await keepMedia(cache, timelapse.thumbnailUrl, tally)
		if (options.videos && typeof timelapse?.playbackUrl === "string")
			await keepMedia(cache, timelapse.playbackUrl, tally)
	}
}

async function packOne(id: string, options: PackOptions): Promise<ReviewViewer | null> {
	const tally: Tally = { bytes: 0, missing: 0 }
	const response = await same(`/api/reviews/${encodeURIComponent(id)}/offline`)
	if (!response.ok)
		throw new Error(response.status === 404 ? "Not found, or your own work" : `The server answered ${response.status}`)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route's own JSON
	const { detail, packedAt, viewer } = (await response.json()) as StoredDetail & { viewer: ReviewViewer }
	const pack: OfflinePack = {
		bytes: 0,
		id,
		kind: detail.ship.kind,
		maker: detail.maker.name,
		missing: 0,
		packedAt,
		status: "downloading",
		title: detail.project.title,
	}
	await updatePacks(packs => [...packs.filter(p => p.id !== id), pack])
	const cache = await caches.open(packCacheName(id))
	try {
		if (detail.project.githubRepo) await packRepo(cache, id, tally)
		await pool(mediaOf(detail), 4, url => keepMedia(cache, url, tally))
		await packLapses(cache, detail, options, tally)
		// Written last: a submission only opens offline once everything else has been tried.
		await writeDetail(id, { detail, packedAt })
		await updatePacks(packs =>
			packs.map(p => (p.id === id ? { ...pack, bytes: tally.bytes, missing: tally.missing, status: "ready" } : p)),
		)
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err)
		await updatePacks(packs =>
			packs.map(p =>
				p.id === id ? { ...pack, bytes: tally.bytes, error, missing: tally.missing, status: "failed" } : p,
			),
		)
	}
	return viewer
}

/** Downloads each submission in turn. One that fails is marked and the rest carry on. */
export async function downloadSubmissions(
	ids: string[],
	options: PackOptions,
	onProgress: (progress: PackProgress | null) => void,
): Promise<void> {
	await registerWorker()
	await navigator.storage?.persist?.().catch(() => false)
	onProgress({ done: 0, id: "", label: "Keeping the review screen for offline use", total: ids.length })
	await keepShell()
	for (const [index, id] of ids.entries()) {
		onProgress({ done: index, id, label: `Downloading ${index + 1} of ${ids.length}`, total: ids.length })
		try {
			const viewer = await packOne(id, options)
			if (viewer) await writeViewer(viewer)
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err)
			await updatePacks(packs => [
				...packs.filter(p => p.id !== id),
				{
					bytes: 0,
					error,
					id,
					kind: "",
					maker: "",
					missing: 0,
					packedAt: new Date().toISOString(),
					status: "failed",
					title: id,
				},
			])
		}
	}
	onProgress(null)
}
