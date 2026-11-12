import "server-only"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { constants, createReadStream, createWriteStream } from "node:fs"
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, unlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, extname, join } from "node:path"

/**
 * Server-side STEP/IGES/BREP → GLB conversion for the review file viewer – Fabricate's `ModelConversion`, on this server.
 *
 * The viewer reads models in the browser, and hands anything over 100 MB (or anything that runs the browser out of memory) to `/api/reviews/[id]/files/convert`, which lands here. The work is done by `vendor/step2glb`, a small OpenCascade program, run as a child process: it parses files makers uploaded, so it gets none of this app's environment, a memory and output cap, and a time limit, and only one runs at a time.
 *
 * Results are kept on local disk, named for the (repo, commit, path) they came from, so a model converted once is served from disk afterwards; the directory is capped and the oldest results go first. State that is not on disk – queued, working, failed – lives in memory, which is enough for one replica: a restart only loses work in progress, and the viewer starts it again.
 */

const EXTENSIONS: ReadonlySet<string> = new Set(["step", "stp", "iges", "igs", "brep", "brp"])
const MAX_BYTES = 300 * 1024 * 1024
const MAX_MB = MAX_BYTES / 1024 / 1024
const MEMORY_MB = Number(process.env.STEP2GLB_MEMORY_MB) || 3072
const OUTPUT_LIMIT = 1024 * 1024 * 1024
const TIMEOUT_MS = 15 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const FAILED_TTL_MS = 60 * 60 * 1000
const DISK_BUDGET = (Number(process.env.MODEL_CONVERSION_DISK_MB) || 4096) * 1024 * 1024
const LFS_POINTER = "version https://git-lfs.github.com/spec/"
const DIR = process.env.MODEL_CONVERSION_DIR || join(tmpdir(), "halflife-model-conversions")
// What the converter may see of this process's environment: enough to run OpenCascade, nothing that names a secret.
const CHILD_ENV: ReadonlySet<string> = new Set(["PATH", "LANG", "LC_ALL", "LD_LIBRARY_PATH", "MALLOC_CONF"])
const CHILD_ENV_PREFIXES: readonly string[] = Object.freeze(["CSF_", "MMGT_"])
const STEPS: { [_: string]: string } = Object.freeze({
	"Meshing solids": "Meshing solids on the server",
	"Reading the model": "Reading the model on the server",
	"Writing the model": "Writing the converted model",
})

export type ConversionState = "queued" | "working" | "done" | "failed"

export interface ConversionStatus {
	error?: string
	message?: string
	size?: number
	state: ConversionState
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
let converterPath: string | null | undefined

async function executable(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK)
		return true
	} catch {
		return false
	}
}

async function findConverter(): Promise<string | null> {
	const configured = process.env.STEP2GLB_PATH?.trim()
	if (configured && (await executable(configured))) return configured
	for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
		const candidate = join(dir, "step2glb")
		if (await executable(candidate)) return candidate
	}
	return null
}

/** The converter binary: `STEP2GLB_PATH`, else `step2glb` on the PATH, else none – and conversion answers that it is not set up. */
async function converter(): Promise<string | null> {
	if (converterPath === undefined) converterPath = await findConverter()
	return converterPath
}

export const conversionAvailable = async (): Promise<boolean> => (await converter()) !== null

export const isConvertible = (path: string): boolean => EXTENSIONS.has(extname(path).slice(1).toLowerCase())

const resultPath = (key: string): string => join(DIR, `${key}.glb`)

const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/")

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
		// One at a time, in the order asked: the converter can use gigabytes, and two at once is how a pod runs out.
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
		const binary = await converter()
		if (!binary) {
			this.set({ error: "Converting models on the server isn't set up here.", state: "failed" })
			return
		}
		const dir = await mkdtemp(join(tmpdir(), "model-conversion-"))
		try {
			const input = join(dir, `model.${extname(this.path).slice(1).toLowerCase()}`)
			const output = join(dir, "model.glb")
			this.set({ message: "Downloading the file on the server", state: "working" })
			await this.download(input)
			await this.convert(binary, input, output, dir)
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

	private async download(target: string): Promise<void> {
		const base = `${this.repo}/${this.sha}/${encodePath(this.path)}`
		await fetchTo(`https://raw.githubusercontent.com/${base}`, target)
		const pointer = await lfsPointer(target)
		if (!pointer) return
		if (pointer.size > MAX_BYTES)
			throw failure(`This file is ${Math.round(pointer.size / 1024 / 1024)} MB, too large for the server to convert.`)
		await fetchTo(`https://media.githubusercontent.com/media/${base}`, target)
		if ((await sha256Of(target)) !== pointer.oid)
			throw failure("GitHub sent a Git LFS file that does not match its checksum.")
	}

	private async convert(binary: string, input: string, output: string, dir: string): Promise<void> {
		// The caps go on through the shell's `ulimit`, which Node cannot set on a child itself: address space for memory, file size for the output, and no core file when the cap kills it.
		const script = `ulimit -c 0 && ulimit -v ${MEMORY_MB * 1024} && ulimit -f ${Math.floor(OUTPUT_LIMIT / 512)} && exec "$0" "$@"`
		// NODE_ENV is a required key of the environment type here; it names nothing secret.
		const env: NodeJS.ProcessEnv = { HOME: dir, NODE_ENV: "production", TMPDIR: dir }
		for (const [name, value] of Object.entries(process.env)) {
			if (value === undefined) continue
			if (CHILD_ENV.has(name) || CHILD_ENV_PREFIXES.some(prefix => name.startsWith(prefix))) env[name] = value
		}
		// Its own process group, so a timeout kills the converter and not just the shell in front of it.
		const child = spawn("/bin/sh", ["-c", script, binary, input, output], { cwd: dir, detached: true, env })
		let stderr = ""
		let timedOut = false
		const timer = setTimeout(() => {
			timedOut = true
			if (child.pid) process.kill(-child.pid, "SIGKILL")
		}, TIMEOUT_MS)
		child.stdout.setEncoding("utf8")
		child.stdout.on("data", (chunk: string) => {
			for (const line of chunk.split("\n")) {
				const step = STEPS[line.trim()]
				if (step) this.set({ message: step, state: "working" })
			}
		})
		child.stderr.setEncoding("utf8")
		child.stderr.on("data", (chunk: string) => {
			stderr = (stderr + chunk).slice(-4000)
		})
		try {
			const closed: unknown[] = await once(child, "close")
			const [code, signal] = closed
			if (timedOut) throw failure("Converting took longer than 15 minutes.")
			// Killed by the kernel, almost always for crossing the memory cap.
			if (typeof signal === "string") throw failure("The model is too big even for the server to convert.")
			const size = await stat(output).then(
				info => info.size,
				() => 0,
			)
			if (code === 0 && size > 0) return
			const last = stderr.trim().split("\n").at(-1)?.trim()
			throw failure(last || "The server could not convert this model.")
		} finally {
			clearTimeout(timer)
		}
	}
}

/** Stream a URL to a file, giving up past MAX_BYTES rather than holding a file of any size in memory. */
async function fetchTo(url: string, target: string): Promise<void> {
	let response: Response
	try {
		response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
	} catch (err) {
		throw failure(`Downloading the file from GitHub failed: ${err instanceof Error ? err.message : "no answer"}`)
	}
	if (!response.ok || !response.body) throw failure(`GitHub would not hand over this file (${response.status}).`)
	if (Number(response.headers.get("content-length")) > MAX_BYTES)
		throw failure(`This file is over ${MAX_MB} MB, too large for the server to convert.`)
	const reader = response.body.getReader()
	const file = createWriteStream(target)
	let received = 0
	try {
		for (let read = await reader.read(); !read.done; read = await reader.read()) {
			received += read.value.byteLength
			if (received > MAX_BYTES) throw failure(`This file is over ${MAX_MB} MB, too large for the server to convert.`)
			if (!file.write(read.value)) await once(file, "drain")
		}
	} finally {
		await reader.cancel().catch(() => undefined)
		file.end()
		await once(file, "close")
	}
}

async function lfsPointer(path: string): Promise<{ oid: string; size: number } | null> {
	if ((await stat(path)).size > 1024) return null
	const text = await readFile(path, "utf8")
	if (!text.startsWith(LFS_POINTER)) return null
	const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1]
	const size = /^size (\d+)$/m.exec(text)?.[1]
	return oid && size ? { oid, size: Number(size) } : null
}

async function sha256Of(path: string): Promise<string> {
	const hash = createHash("sha256")
	for await (const chunk of createReadStream(path)) if (Buffer.isBuffer(chunk)) hash.update(chunk)
	return hash.digest("hex")
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
