import "server-only"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { createReadStream, createWriteStream } from "node:fs"
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { isRecord } from "@/lib/unknown"

/**
 * Server-side STEP/IGES/BREP → GLB conversion for the review file viewer – Fabricate's `ModelConversion`, on this server.
 *
 * The viewer reads models in the browser, and hands anything over 100 MB (or anything that runs the browser out of memory) to `/api/reviews/[id]/files/convert`, which lands here. The converting itself happens on FART (`FART_URL`, hackclub/fart), which runs OpenCascade for Fabricate too: this asks it for the model with `FART_TOKEN`, one at a time, until it is done, then downloads the GLB. FART's README lists the endpoints this depends on.
 *
 * Results are kept on local disk, named for the (repo, commit, path) they came from, so a model converted once is served from disk afterwards; the directory is capped and the oldest results go first. State that is not on disk – queued, working, failed – lives in memory, which is enough for one replica: a restart only loses work in progress, and the viewer starts it again.
 */

const EXTENSIONS: ReadonlySet<string> = new Set(["step", "stp", "iges", "igs", "brep", "brp"])
const OUTPUT_LIMIT = 1024 * 1024 * 1024
const POLL_MS = 2000
// FART converts one model at a time for up to 15 minutes each, so ours may wait behind another.
const TIMEOUT_MS = 25 * 60 * 1000
const REQUEST_TIMEOUT_MS = 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
// Consecutive failed calls (about a minute's worth) before FART counts as down rather than restarting.
const MAX_MISSES = 30
const FAILED_TTL_MS = 60 * 60 * 1000
const DISK_BUDGET = (Number(process.env.MODEL_CONVERSION_DISK_MB) || 4096) * 1024 * 1024
const DIR = process.env.MODEL_CONVERSION_DIR || join(tmpdir(), "halflife-model-conversions")

export type ConversionState = "queued" | "working" | "done" | "failed"

export interface ConversionStatus {
	error?: string
	message?: string
	size?: number
	state: ConversionState
}

interface RemoteStatus {
	error?: string
	message?: string
	state?: string
}

/** Marks an error whose message is meant for the reviewer; anything else is logged and reported generically. */
const REVIEWER_FACING = Symbol("reviewer-facing")

const failure = (message: string): Error => new Error(message, { cause: REVIEWER_FACING })

const isFailure = (err: unknown): err is Error => err instanceof Error && err.cause === REVIEWER_FACING

interface Pending {
	at: number
	status: ConversionStatus
}

const pending = new Map<string, Pending>()
let queue: Promise<void> = Promise.resolve()

const fartUrl = (): string => (process.env.FART_URL ?? "").trim().replace(/\/+$/, "")

const fartToken = (): string => (process.env.FART_TOKEN ?? "").trim()

/** Whether FART is configured; without it, conversion answers that it is not set up. */
export const conversionAvailable = (): boolean => fartUrl() !== "" && fartToken() !== ""

export const isConvertible = (path: string): boolean => EXTENSIONS.has(extname(path).slice(1).toLowerCase())

const resultPath = (key: string): string => join(DIR, `${key}.glb`)

function readRemoteStatus(body: unknown): RemoteStatus | null {
	if (!isRecord(body)) return null
	const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)
	return { error: text(body.error), message: text(body.message), state: text(body.state) }
}

async function resultSize(key: string): Promise<number | null> {
	try {
		const info = await stat(/* turbopackIgnore: true */ resultPath(key))
		return info.size > 0 ? info.size : null
	} catch {
		return null
	}
}

export class ModelConversion {
	constructor(
		readonly repo: string,
		readonly sha: string,
		readonly path: string,
	) {}

	get key(): string {
		return createHash("sha256").update(`${this.repo}\n${this.sha}\n${this.path}`).digest("hex")
	}

	async status(): Promise<ConversionStatus | null> {
		const size = await resultSize(this.key)
		if (size !== null) return { size, state: "done" }
		const entry = pending.get(this.key)
		if (!entry) return null
		if (entry.status.state === "failed" && Date.now() - entry.at > FAILED_TTL_MS) {
			pending.delete(this.key)
			return null
		}
		return entry.status
	}

	/** Start converting unless it is already done, underway or recently failed, and say where it stands. */
	async start(): Promise<ConversionStatus> {
		const current = await this.status()
		if (current) return current
		const queued: ConversionStatus = { message: "Waiting for the server", state: "queued" }
		this.set(queued)
		// One at a time, in the order asked: FART converts one at a time anyway, and this keeps one reviewer's batch from crowding its queue.
		const previous = queue
		queue = (async () => {
			await previous
			await this.run()
		})()
		return queued
	}

	/** The finished GLB as a stream, or null when there is none. */
	async open(): Promise<{ size: number; stream: ReturnType<typeof createReadStream> } | null> {
		const size = await resultSize(this.key)
		return size === null ? null : { size, stream: createReadStream(/* turbopackIgnore: true */ resultPath(this.key)) }
	}

	private set(status: ConversionStatus): void {
		pending.set(this.key, { at: Date.now(), status })
	}

	private async run(): Promise<void> {
		if (!conversionAvailable()) {
			this.set({ error: "Converting models on the server isn't set up here.", state: "failed" })
			return
		}
		const dir = await mkdtemp(join(tmpdir(), "model-conversion-"))
		try {
			const output = join(dir, "model.glb")
			await this.convert(output)
			this.set({ message: "Storing the converted model", state: "working" })
			await store(output, resultPath(this.key))
			pending.delete(this.key)
			void prune()
		} catch (err) {
			if (!isFailure(err)) console.error(`[model-conversion] ${this.repo}@${this.sha} ${this.path}:`, err)
			this.set({
				error: isFailure(err) ? err.message : "The server could not convert this model.",
				state: "failed",
			})
		} finally {
			await rm(dir, { force: true, recursive: true })
		}
	}

	/** Ask FART until the model is done, then download it. A missing result (FART restarted or pruned it) is asked for again. */
	private async convert(output: string): Promise<void> {
		const deadline = Date.now() + TIMEOUT_MS
		let misses = 0
		for (;;) {
			if (Date.now() > deadline) throw failure(`Converting took longer than ${TIMEOUT_MS / 60_000} minutes.`)
			const status = await this.remoteStatus()
			if (status?.state === "failed") throw failure(status.error || "The server could not convert this model.")
			if (status?.state === "done" && (await this.fetchConverted(output))) return
			if (status?.state === "queued" || status?.state === "working")
				this.set({ message: status.message || "Converting on the server", state: status.state })
			misses = status && status.state !== "done" ? 0 : misses + 1
			if (misses >= MAX_MISSES) throw failure("The conversion server isn't answering.")
			await sleep(POLL_MS)
		}
	}

	/** FART's state for this model, which also starts it if FART has none. Null when FART could not be reached; a refusal with a reason is final. */
	private async remoteStatus(): Promise<RemoteStatus | null> {
		let response: Response
		try {
			response = await fetch(this.remoteUrl("convert"), {
				cache: "no-store",
				headers: { Accept: "application/json", Authorization: `Bearer ${fartToken()}` },
				method: "POST",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			})
		} catch {
			return null
		}
		const status = readRemoteStatus(await response.json().catch(() => null))
		if (response.ok && status) return status
		if (response.status >= 400 && response.status < 500 && status?.error) throw failure(status.error)
		return null
	}

	private async fetchConverted(output: string): Promise<boolean> {
		let response: Response
		try {
			response = await fetch(this.remoteUrl("converted"), {
				cache: "no-store",
				headers: { Authorization: `Bearer ${fartToken()}` },
				signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
			})
		} catch {
			return false
		}
		if (!response.ok || !response.body) {
			await response.body?.cancel()
			return false
		}
		try {
			await streamTo(response.body, output)
			return true
		} catch (err) {
			if (isFailure(err)) throw err
			return false
		}
	}

	private remoteUrl(action: "convert" | "converted"): string {
		return `${fartUrl()}/api/repos/${this.repo}/${action}?${new URLSearchParams({ path: this.path, sha: this.sha })}`
	}
}

/** Stream a response body to a file, giving up past OUTPUT_LIMIT rather than filling the disk. */
async function streamTo(body: ReadableStream<Uint8Array>, target: string): Promise<void> {
	const reader = body.getReader()
	const file = createWriteStream(target)
	let received = 0
	try {
		for (let read = await reader.read(); !read.done; read = await reader.read()) {
			received += read.value.byteLength
			if (received > OUTPUT_LIMIT) throw failure(`The converted model is over ${OUTPUT_LIMIT / 1024 / 1024 / 1024} GB.`)
			if (!file.write(read.value)) await once(file, "drain")
		}
	} finally {
		await reader.cancel().catch(() => undefined)
		file.end()
		await once(file, "close")
	}
}

async function store(from: string, to: string): Promise<void> {
	await mkdir(/* turbopackIgnore: true */ DIR, { recursive: true })
	const staging = `${to}.partial`
	try {
		await rename(from, staging)
	} catch {
		// A rename across filesystems fails, and the temp dir and the result dir need not share one.
		await copyFile(from, staging)
		await unlink(from)
	}
	await rename(/* turbopackIgnore: true */ staging, to)
}

// The `turbopackIgnore` comments on this file's filesystem calls: their paths come from the environment at run time, and without them Turbopack traces the whole project into the server bundle in case they point inside it.

/** Keep the result directory under its budget, dropping the least recently written results first. */
async function prune(): Promise<void> {
	try {
		const names = (await readdir(/* turbopackIgnore: true */ DIR)).filter(name => name.endsWith(".glb"))
		const files = await Promise.all(
			names.map(async name => {
				const info = await stat(/* turbopackIgnore: true */ join(DIR, name))
				return { mtime: info.mtimeMs, name, size: info.size }
			}),
		)
		files.sort((a, b) => b.mtime - a.mtime)
		let total = 0
		for (const file of files) {
			total += file.size
			if (total > DISK_BUDGET) await unlink(/* turbopackIgnore: true */ join(DIR, file.name)).catch(() => undefined)
		}
	} catch {
		// Pruning is housekeeping; a failure here never fails a conversion.
	}
}
