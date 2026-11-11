"use client"

/**
 * Loading Lapse timelapses for the review screen – Fabricate's `lib/lapse.ts`.
 *
 * As in Fabricate, a recording is looked up on Lapse's public API in the browser, which gives the current playback URL and the real time it covers, and a `<video>` is made ready for it. Three load at a time, and each is loaded once however many players ask for it. Fabricate's Lookout-link support is left out: Half Life links every recording by its Lapse id.
 *
 * The media itself comes from `lookout.hackclub.com`, which redirects to `lookout.hackclub-assets.com` – both already inside Half Life's CSP.
 */

const API_URL = "https://api.lapse.hackclub.com/api/timelapse/query"
const TIMELAPSE_URL = /^https:\/\/lapse\.hackclub\.com\/timelapse\/([\w-]{1,64})\/?$/
const CONCURRENCY = 3

export interface LapseVideo {
	element: HTMLVideoElement
	/** Seconds of real time the recording covers. */
	tracked: number
}

interface LapseTimelapse {
	duration?: unknown
	playbackUrl?: unknown
	thumbnailUrl?: unknown
}

const videos = new Map<string, Promise<LapseVideo>>()
const queue: (() => void)[] = []
let running = 0

export const lapseId = (url: string | null | undefined): string | null => url?.trim().match(TIMELAPSE_URL)?.[1] ?? null

function throttled<T>(task: () => Promise<T>): Promise<T> {
	const { promise, reject, resolve } = Promise.withResolvers<T>()
	const run = async (): Promise<void> => {
		running += 1
		try {
			resolve(await task())
		} catch (err) {
			reject(err)
		} finally {
			running -= 1
			queue.shift()?.()
		}
	}
	if (running < CONCURRENCY) void run()
	else queue.push(() => void run())
	return promise
}

const isRecord = (value: unknown): value is { [_: string]: unknown } =>
	typeof value === "object" && value !== null && !Array.isArray(value)

/** Lapse's `{ data: { timelapse } }`, or undefined when the answer is not that shape. */
function timelapseOf(body: unknown): LapseTimelapse | undefined {
	const data = isRecord(body) ? body.data : undefined
	const timelapse = isRecord(data) ? data.timelapse : undefined
	return isRecord(timelapse) ? timelapse : undefined
}

async function preload(id: string): Promise<LapseVideo> {
	const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, { credentials: "omit" })
	if (!res.ok) throw new Error(`Lapse returned ${res.status}`)
	const body: unknown = await res.json()
	const timelapse = timelapseOf(body)
	const playback = timelapse?.playbackUrl
	if (typeof playback !== "string" || !playback.startsWith("https://")) throw new Error("Timelapse is not ready")

	const element = document.createElement("video")
	element.className = "lapse__video"
	element.playsInline = true
	element.preload = "auto"
	if (typeof timelapse?.thumbnailUrl === "string" && timelapse.thumbnailUrl.startsWith("https://"))
		element.poster = timelapse.thumbnailUrl
	const tracked = typeof timelapse?.duration === "number" && timelapse.duration > 0 ? timelapse.duration : 0

	const { promise, reject, resolve } = Promise.withResolvers<LapseVideo>()
	element.addEventListener("loadeddata", () => resolve({ element, tracked }), { once: true })
	element.addEventListener("error", () => reject(new Error("Video failed to load")), { once: true })
	element.src = playback
	return promise
}

export function loadLapse(url: string): Promise<LapseVideo> {
	const id = lapseId(url)
	if (!id) return Promise.reject(new Error("Not a Lapse link"))
	let video = videos.get(id)
	if (!video) {
		const loading = throttled(() => preload(id))
		videos.set(id, loading)
		// A failed load is forgotten, so the next player to ask tries again.
		void (async () => {
			try {
				await loading
			} catch {
				videos.delete(id)
			}
		})()
		video = loading
	}
	return video
}
