"use client"

import type { DecisionBody } from "@/components/review/api"
import type { ReviewDetail, ReviewViewer } from "@/lib/review-platform/types"

/**
 * Where offline reviews live in the browser: Cache Storage, which the service worker (`public/review-offline-worker.js`) reads from as well.
 *
 * - `halflife-offline-meta` holds the list of packs, the outbox and the viewer, as JSON under made-up `/__offline/...` keys, plus the page itself (kept by the worker).
 * - `halflife-offline-pack-<id>` holds one submission: its review data under `/__offline/detail/<id>`, and every response its review screen asks for, under the address it asks for it by.
 * - `halflife-offline-assets` holds the build's files (kept by the worker).
 *
 * The outbox is the one thing here that cannot be downloaded again, so every change to it is also written to localStorage, and read back from there if the cache copy is ever missing.
 */

const META = "halflife-offline-meta"
const PACK_PREFIX = "halflife-offline-pack-"
const PACKS_KEY = "/__offline/packs"
const OUTBOX_KEY = "/__offline/outbox"
const VIEWER_KEY = "/__offline/viewer"
const OUTBOX_BACKUP = "halflife:offline-outbox"

export const WORKER_URL = "/review-offline-worker.js"
export const WORKER_SCOPE = "/reviews/offline"

export type PackStatus = "downloading" | "ready" | "failed"

export interface OfflinePack {
	bytes: number
	error?: string
	id: string
	kind: string
	maker: string
	/** Things the pack couldn't fetch (a picture, a file, a video): it still opens, without them. */
	missing: number
	packedAt: string
	status: PackStatus
	title: string
}

export interface QueuedHours {
	comments: string
	hoursApproved: number
	id: string
}

export interface QueuedReview {
	decidedAt: string | null
	decision: DecisionBody | null
	/** The last thing the sync said about this review, when it couldn't send it. */
	error: string | null
	hours: { [entryId: string]: QueuedHours }
	packedAt: string
	title: string
}

export interface Outbox {
	[submissionId: string]: QueuedReview
}

export interface StoredDetail {
	detail: ReviewDetail
	packedAt: string
}

export const offlineSupported = (): boolean =>
	typeof window !== "undefined" && "serviceWorker" in navigator && "caches" in window

export const packCacheName = (id: string): string => `${PACK_PREFIX}${id}`
export const detailKey = (id: string): string => `/__offline/detail/${encodeURIComponent(id)}`

async function readJson<T>(cacheName: string, key: string): Promise<T | null> {
	const hit = await (await caches.open(cacheName)).match(key)
	if (!hit) return null
	try {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by this module under this key
		return (await hit.json()) as T
	} catch {
		return null
	}
}

async function writeJson(cacheName: string, key: string, value: unknown): Promise<void> {
	await (await caches.open(cacheName)).put(key, Response.json(value))
}

// Every read-modify-write of the meta entries goes through one queue, so two quick saves cannot each read the old value and lose the other's change.
let queue: Promise<void> = Promise.resolve()
function serially<T>(task: () => Promise<T>): Promise<T> {
	const previous = queue
	const run = (async () => {
		await previous
		return task()
	})()
	queue = (async () => {
		try {
			await run
		} catch {
			// That write's failure is its own caller's to handle; the next one still runs.
		}
	})()
	return run
}

export const readPacks = async (): Promise<OfflinePack[]> => (await readJson<OfflinePack[]>(META, PACKS_KEY)) ?? []

export const updatePacks = (change: (packs: OfflinePack[]) => OfflinePack[]): Promise<void> =>
	serially(async () => writeJson(META, PACKS_KEY, change(await readPacks())))

function readBackup(): Outbox | null {
	try {
		const raw = localStorage.getItem(OUTBOX_BACKUP)
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- written by `writeOutbox`
		return raw ? (JSON.parse(raw) as Outbox) : null
	} catch {
		return null
	}
}

export async function readOutbox(): Promise<Outbox> {
	const cached = await readJson<Outbox>(META, OUTBOX_KEY)
	return cached ?? readBackup() ?? {}
}

async function writeOutbox(outbox: Outbox): Promise<void> {
	try {
		localStorage.setItem(OUTBOX_BACKUP, JSON.stringify(outbox))
	} catch {
		// The cache copy below still holds it.
	}
	await writeJson(META, OUTBOX_KEY, outbox)
}

export const updateOutbox = (change: (outbox: Outbox) => void): Promise<void> =>
	serially(async () => {
		const outbox = await readOutbox()
		change(outbox)
		await writeOutbox(outbox)
	})

/** The queued review for a submission, made on first use. */
export function queuedFor(outbox: Outbox, id: string, stored: StoredDetail): QueuedReview {
	outbox[id] ??= {
		decidedAt: null,
		decision: null,
		error: null,
		hours: {},
		packedAt: stored.packedAt,
		title: stored.detail.project.title,
	}
	return outbox[id]
}

export const readViewer = (): Promise<ReviewViewer | null> => readJson<ReviewViewer>(META, VIEWER_KEY)
export const writeViewer = (viewer: ReviewViewer): Promise<void> => writeJson(META, VIEWER_KEY, viewer)

export const readDetail = (id: string): Promise<StoredDetail | null> =>
	readJson<StoredDetail>(packCacheName(id), detailKey(id))
export const writeDetail = (id: string, stored: StoredDetail): Promise<void> =>
	writeJson(packCacheName(id), detailKey(id), stored)

/** Forgets a downloaded submission. Its queued review, if any, stays in the outbox until it is sent or dropped. */
export async function removePack(id: string): Promise<void> {
	await caches.delete(packCacheName(id))
	await updatePacks(packs => packs.filter(pack => pack.id !== id))
}

export async function registerWorker(): Promise<ServiceWorkerRegistration> {
	await navigator.serviceWorker.register(WORKER_URL, { scope: WORKER_SCOPE })
	return navigator.serviceWorker.ready
}

/** How much this site may keep and is keeping, when the browser says. */
export async function storageEstimate(): Promise<{ quota: number; usage: number } | null> {
	try {
		const estimate = await navigator.storage.estimate()
		return { quota: estimate.quota ?? 0, usage: estimate.usage ?? 0 }
	} catch {
		return null
	}
}
