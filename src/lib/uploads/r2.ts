/// <reference types="bun-types/s3" />
import "server-only"
import { createHash, randomUUID } from "node:crypto"
import type { S3Client as BunS3Client } from "bun"
import { sleep } from "@/lib/concurrency"
import { HttpError, messageOf } from "@/lib/errors"
import { isRecord } from "@/lib/unknown"

const DEFAULT_MAX_UPLOAD_BYTES = 104_857_600

/**
 * An unparseable UPLOAD_MAX_BYTES used to yield NaN, and every `size > NaN` comparison is false – which silently removed the cap instead of failing loudly. Fall back to the default rather than trusting the environment.
 */
function parseMaxBytes(raw: string | undefined): number {
	if (raw === undefined) return DEFAULT_MAX_UPLOAD_BYTES
	const parsed = Number(raw)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_BYTES
}

export const MAX_UPLOAD_BYTES = parseMaxBytes(process.env.UPLOAD_MAX_BYTES)

const EXTENSION_MIME: { [_: string]: string[] } = {
	gif: ["image/gif"],
	jpeg: ["image/jpeg"],
	jpg: ["image/jpeg"],
	mov: ["video/quicktime"],
	mp4: ["video/mp4"],
	png: ["image/png"],
	webm: ["video/webm"],
	webp: ["image/webp"],
}

/**
 * ISO base media (MP4/MOV) brands that are video.
 *
 * `ftyp` alone is not enough: the same box opens HEIC, AVIF and JPEG 2000 images, so a still image renamed `.mp4` with a `video/mp4` content type would otherwise pass. Only brands a video actually uses are accepted, and a file whose major brand is unusual still passes if a compatible brand is known.
 */
const VIDEO_FTYP_BRANDS = new Set([
	"isom",
	"iso2",
	"iso3",
	"iso4",
	"iso5",
	"iso6",
	"iso8",
	"iso9",
	"mp41",
	"mp42",
	"avc1",
	"avc3",
	"hvc1",
	"hev1",
	"dash",
	"mmp4",
	"M4V ",
	"M4VH",
	"M4VP",
	"qt  ",
	"3gp4",
	"3gp5",
	"3gp6",
	"3g2a",
	"3g2b",
	"F4V ",
	"F4P ",
])

/** Four ASCII bytes at `offset`, or fewer/`\0` when the buffer is short. */
function brandAt(bytes: Uint8Array, offset: number): string {
	let brand = ""
	for (let i = 0; i < 4; i += 1) brand += String.fromCodePoint(bytes[offset + i] ?? 0)
	return brand
}

function isIsoBmffVideo(bytes: Uint8Array): boolean {
	if (brandAt(bytes, 4) !== "ftyp") return false
	if (VIDEO_FTYP_BRANDS.has(brandAt(bytes, 8))) return true

	// The major brand can be generic (`isom`) with the real one listed among the compatible brands, so scan those too. The box size is big-endian; a size of 0 means "to end of file" and is treated as the whole buffer.
	const declared = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)
	const end = declared >= 16 ? Math.min(declared >>> 0, bytes.length) : bytes.length
	for (let offset = 16; offset + 4 <= end; offset += 4) if (VIDEO_FTYP_BRANDS.has(brandAt(bytes, offset))) return true
	return false
}

/**
 * Matroska/WebM codec ids are ASCII inside the Tracks element. A pure-audio WebM (Opus only) carries `A_*` ids and no video track, so the EBML magic alone is not enough; scan the head of the file for a video codec id.
 */
const WEBM_VIDEO_CODEC = /V_(VP8|VP9|AV1|MPEG4|MPEG2|THEORA|H264|H265|PRORES)/

function hasWebmVideoTrack(bytes: Uint8Array): boolean {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 1 << 20)).toString("latin1")
	return WEBM_VIDEO_CODEC.test(head)
}

/**
 * A MIME type and filename are only claims. These are the container signatures for the video formats the app accepts, so a renamed image or text file cannot become a reel by lying about its extension.
 */
export function isVideoBytes(bytes: Uint8Array): boolean {
	if (bytes.length < 12) return false

	// ISO base media (MP4/MOV): `....ftyp` at byte 4, then a brand that must be a video one – `heic`, `avif` and `jxl ` share the box and are not video.
	if (brandAt(bytes, 4) === "ftyp") return isIsoBmffVideo(bytes)

	// Matroska/WebM: EBML header 1A 45 DF A3, plus a video codec id.
	return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 && hasWebmVideoTrack(bytes)
}

export const UPLOAD_FOLDERS = ["sessions", "covers", "timelapses", "posts", "shop"] as const
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number]

export interface UploadedObjectSummary {
	key: string
	lastModified: Date | null
	size: number
	storageClass: string | null
	url: string | null
}

export interface UploadedObjectPage {
	nextCursor: string | null
	objects: UploadedObjectSummary[]
	prefix: string
}

export function isUploadConfigured(): boolean {
	return Boolean(
		process.env.S3_ACCESS_KEY_ID
			&& process.env.S3_SECRET_ACCESS_KEY
			&& process.env.S3_BUCKET_NAME
			&& process.env.S3_ENDPOINT,
	)
}

function credentials() {
	return {
		accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
		secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
	}
}

/**
 * The S3 endpoint, without a bucket segment.
 *
 * Some configurations put the bucket in the endpoint path, like `/my-bucket`. Bun appends the bucket to a path-style endpoint, so leaving it there addresses the bucket twice; strip that one segment here and pass the bucket separately, as every other deployment already does.
 */
function endpoint(): string | undefined {
	const raw = process.env.S3_ENDPOINT
	const bucket = process.env.S3_BUCKET_NAME
	if (!raw || !bucket) return raw
	try {
		const url = new URL(raw)
		if (url.pathname.replaceAll(/^\/+|\/+$/g, "") !== bucket) return raw
		url.pathname = url.pathname.replace(/\/[^/]+\/?$/, "")
		return url.toString().replace(/\/$/, "")
	} catch {
		// Not a URL; the client will report that as a configuration error when it runs.
		return raw
	}
}

let cachedClient: BunS3Client | undefined

/**
 * The Bun S3 client, made on first use.
 *
 * Loaded at call time rather than at module load so a runtime without Bun still serves every page that only mints public URLs; the pages that read or write objects are the ones that need it. Production runs on Bun, which is where this exists.
 */
async function client(): Promise<BunS3Client> {
	if (cachedClient) return cachedClient
	const bun = await import("bun").catch(err => {
		console.error("[uploads] the Bun S3 client could not be loaded:", err)
		throw new HttpError("NOT_CONFIGURED", "File uploads need the Bun runtime on this deployment.")
	})
	cachedClient = new bun.S3Client({
		...credentials(),
		bucket: process.env.S3_BUCKET_NAME,
		endpoint: endpoint(),
		region: "auto",
	})
	return cachedClient
}

export async function listUploadedObjects(
	opts: { prefix?: string; cursor?: string; limit?: number } = {},
): Promise<UploadedObjectPage> {
	if (!isUploadConfigured()) throw new HttpError("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	const prefix = opts.prefix ?? ""
	try {
		const s3 = await client()
		const result = await withBucketRetry(() =>
			s3.list({
				continuationToken: opts.cursor || undefined,
				maxKeys: Math.min(Math.max(opts.limit ?? 100, 1), 1000),
				prefix: prefix || undefined,
			}),
		)

		return {
			nextCursor: result.isTruncated ? (result.nextContinuationToken ?? null) : null,
			objects: (result.contents ?? []).flatMap(object => {
				if (!object.key) return []
				return [
					{
						key: object.key,
						lastModified: object.lastModified ? new Date(object.lastModified) : null,
						size: object.size ?? 0,
						storageClass: object.storageClass ?? null,
						url: publicUrlFor(object.key),
					},
				]
			}),
			prefix,
		}
	} catch (err) {
		throw asUploadError(err)
	}
}

/** Both extension and MIME type must be on the allowlist and must agree. */
export function validateUpload(
	filename: string,
	contentType: string,
	size: number,
): { ok: true; ext: string } | { ok: false; reason: string } {
	if (size > MAX_UPLOAD_BYTES) return { ok: false, reason: `File is larger than ${MAX_UPLOAD_BYTES} bytes` }

	const ext = filename.split(".").pop()?.toLowerCase() ?? ""
	const allowed = EXTENSION_MIME[ext]
	if (!allowed) return { ok: false, reason: `Unsupported file type: .${ext}` }
	if (!allowed.includes(contentType)) return { ok: false, reason: `Content type ${contentType} does not match .${ext}` }

	return { ext, ok: true }
}

/**
 * The SHA-256 of a file's bytes, as hex.
 *
 * Pictures are named after this rather than a random id, so the same screenshot picked twice – in one sitting, or later from another device – is one object and one URL. The journal counts its evidence by URL, so a random name per upload let one picture count as many.
 */
export function contentHash(body: Buffer): string {
	return createHash("sha256").update(body).digest("hex")
}

/**
 * Keys are namespaced by user. Stasis's flat `folder/timestamp-random.ext` makes abuse untraceable and orphan cleanup impossible.
 *
 * `name` is the object's name inside the user's folder. It defaults to a random UUID; images pass their content hash instead (see `contentHash`), so re-uploading one picture lands on the key it already has rather than on a second copy.
 */
export function buildObjectKey(userId: string, folder: string, ext: string, name: string = randomUUID()): string {
	return `${folder}/${userId}/${name}.${ext}`
}

/**
 * Does this key belong to this user?
 *
 * Every key this app mints is `<folder>/<userId>/<uuid>.<ext>`, so the owner is the second segment. Anything else came from somewhere else.
 *
 * This has to be checked wherever a client hands a key back, because keys are not secrets: the feed returns a full `videoUrl` for every reel, so any participant can read another participant's key and offer it as their own. Without this, someone could attach a stranger's timelapse to their journal as evidence for hours they did not work – which is the one thing the timelapse rule exists to make hard.
 *
 * `..` is refused separately, and so is `%`. Neither can appear in a minted key, and a key containing either is trying to be a path rather than a name: the browser resolves `covers/me/../../sessions/other/x` before it fetches, and the URL parser treats a `%2e%2e` segment as a double-dot too – so a check for a literal `..` alone would let both escape the user's own prefix.
 */
export function isOwnedKey(userId: string, key: string): boolean {
	if (key.includes("..") || key.includes("%")) return false
	return key.split("/")[1] === userId
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
	try {
		const s3 = await client()
		await withBucketRetry(() => s3.write(key, body, { type: contentType }))
	} catch (err) {
		throw asUploadError(err)
	}
}

/**
 * How long a presigned upload URL is good for.
 *
 * Long enough for a phone to find its file and start sending, short enough that a URL copied out of a devtools panel is not a standing invitation to write into someone's folder. The bytes do not have to arrive within the window once the PUT has started.
 */
export const PRESIGN_TTL_SECONDS = 300

export interface PresignedUpload {
	expiresAt: Date
	objectKey: string
	uploadUrl: string
}

/**
 * A URL that lets the browser PUT one object straight into the bucket.
 *
 * Every upload used to travel through this app first, and Cloudflare gives an origin about 100 seconds to answer. A reel is 14 MiB at the median here, which is already past that budget on a school uplink – so the edge returns 524 while the origin is still reading the body. A signed URL moves the transfer to R2, where no such timer exists, and leaves the origin free to serve pages.
 *
 * The key is minted by the caller from the session's own user id, so a URL can only ever write inside that user's prefix. What the URL cannot do is bound the size or pin the type: R2 accepts any Content-Type on a presigned PUT (measured - the signed value is not enforced), so `/confirm` checks the stored type and the real size afterwards and deletes anything that fails.
 */
export async function presignUpload(key: string, contentType: string): Promise<PresignedUpload> {
	if (!isUploadConfigured()) throw new HttpError("NOT_CONFIGURED", "File uploads are not configured on this deployment")
	try {
		const s3 = await client()
		const uploadUrl = s3.presign(key, { expiresIn: PRESIGN_TTL_SECONDS, method: "PUT", type: contentType })
		return { expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000), objectKey: key, uploadUrl }
	} catch (err) {
		throw asUploadError(err)
	}
}

export interface StoredObjectStat {
	size: number
	type: string | null
}

function isMissingObject(err: unknown): boolean {
	if (!isRecord(err)) return false
	return err.code === "NoSuchKey" || err.code === "NotFound" || (err.status ?? err.statusCode) === 404
}

/**
 * What actually landed in the bucket.
 *
 * Deliberately the bucket's answer rather than the client's: with a direct upload the size and type are claims until this asks. A missing object is a user-facing failure – the browser thought it had sent something, or the URL expired first – not a deployment fault.
 */
export async function statObject(key: string): Promise<StoredObjectStat> {
	try {
		const s3 = await client()
		const stat = await withBucketRetry(() => s3.stat(key))
		return { size: stat.size, type: stat.type || null }
	} catch (err) {
		if (isMissingObject(err))
			throw new HttpError("VALIDATION_FAILED", "That upload did not arrive. Try sending it again.")
		throw asUploadError(err)
	}
}

/** The first `bytes` of an object, fetched with a Range request so a video's header does not cost a whole reel. */
export async function readObjectHead(key: string, bytes: number): Promise<Buffer> {
	try {
		const s3 = await client()
		return Buffer.from(await withBucketRetry(() => s3.file(key).slice(0, bytes).arrayBuffer()))
	} catch (err) {
		if (isMissingObject(err))
			throw new HttpError("VALIDATION_FAILED", "That upload did not arrive. Try sending it again.")
		throw asUploadError(err)
	}
}

/**
 * Every byte of an object, hashed as it arrives.
 *
 * Pictures are named after their hash (see `contentHash`), which is what makes re-picking one idempotent and stops a single picture counting twice in the journal. A direct upload cannot hash the bytes before they are stored, so the client sends the hash it named the key with and this checks it against the bytes that actually landed. The first chunk comes back too, for the format sniff.
 */
export async function hashObject(key: string): Promise<{ head: Buffer; sha256: string }> {
	try {
		const s3 = await client()
		// A retry starts the hash over: the bytes from a failed attempt may be half a file, and the digest has to be of the whole object.
		const readAll = async () => {
			const reader = s3.file(key).stream().getReader()
			const hash = createHash("sha256")
			let head = Buffer.alloc(0)
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				const chunk = Buffer.from(value)
				hash.update(chunk)
				if (head.length < 4096) head = Buffer.concat([head, chunk.subarray(0, 4096 - head.length)])
			}
			return { head, sha256: hash.digest("hex") }
		}
		return await withBucketRetry(readAll)
	} catch (err) {
		if (isMissingObject(err))
			throw new HttpError("VALIDATION_FAILED", "That upload did not arrive. Try sending it again.")
		throw asUploadError(err)
	}
}

/**
 * The bucket's own answers that mean "the fault is mine, ask again".
 *
 * R2's `InternalError` is one of these, and its message already gives the advice – "We encountered an internal error. Please try again." – because the same request a moment later usually succeeds. `SlowDown`, `ServiceUnavailable` and `RequestTimeout` are the same story told at a different moment.
 *
 * Only an `S3Error` qualifies. A network failure reaches the route as some other error and keeps its own retry semantics, because a connection that never opened says nothing about the bucket's health.
 */
const TRANSIENT_S3_CODES = new Set(["InternalError", "RequestTimeout", "ServiceUnavailable", "SlowDown"])

/** Long enough for the bucket to move past a bad moment, short enough not to hold the request open while it does. */
const BUCKET_RETRY_DELAY_MS = 250

/** A bucket fault the caller can do nothing about except try the same request again. */
export function isTransientS3Error(err: unknown): boolean {
	if (!isRecord(err) || err.name !== "S3Error") return false
	if (typeof err.code === "string" && TRANSIENT_S3_CODES.has(err.code)) return true
	const status = typeof err.status === "number" ? err.status : err.statusCode
	return typeof status === "number" && status >= 500
}

/**
 * Run a bucket call, and once more if the bucket blamed itself.
 *
 * Everything this wraps is idempotent – a write to a fixed key, a read, a delete, a listing page – so a second attempt cannot create a second object or skip a page. One retry rather than a loop: the point is to ride out a single bad moment, not to hold the request open against a bucket that is down.
 *
 * A recovered moment is not logged. If the retry fails too, `asUploadError` says so in one line.
 */
async function withBucketRetry<T>(op: () => Promise<T>): Promise<T> {
	try {
		return await op()
	} catch (err) {
		if (!isTransientS3Error(err)) throw err
		await sleep(BUCKET_RETRY_DELAY_MS)
		return op()
	}
}

/**
 * Turn the bucket's refusals into answers the app can give.
 *
 * Credentials it rejected are an operator problem, not a user one. Without this they surface as an unhandled exception and the participant is told "Something went wrong" – which happened, with a Cloudflare API token pasted into `S3_ACCESS_KEY_ID`, and the phone only found out AFTER the video had been recorded and uploaded. A 503 saying uploads are misconfigured is both true and actionable; the detail stays in the server log, because the message the bucket returns names the credential.
 *
 * A bucket that is simply having a bad moment is an operator problem too, but a temporary one: by the time this runs it has already been retried once, so the participant gets a 503 that says to send it again instead of a stack trace and "Something went wrong". The log line is the bucket's own message and code, with no trace, because no frame in it would tell an operator anything they could act on.
 *
 * Anything left – a missing object, a network blip – keeps its own error and its retry semantics.
 */
function asUploadError(err: unknown): unknown {
	const details = isRecord(err) ? err : null
	const name = typeof details?.name === "string" ? details.name : undefined
	const code = typeof details?.code === "string" ? details.code : undefined
	// Bun's own refusals are configuration too: a bad endpoint, a missing credential or a signature it could not build.
	const bunConfigFault = code?.startsWith("ERR_S3_") === true
	const credentialFault =
		name === "S3Error"
		&& ["InvalidArgument", "InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied", "NoSuchBucket"].includes(
			code ?? "",
		)
	if (bunConfigFault || credentialFault) {
		console.error("[uploads] the bucket rejected our credentials:", err)
		return new HttpError(
			"NOT_CONFIGURED",
			"File uploads are misconfigured on this deployment. Nothing you did caused this.",
		)
	}
	if (isTransientS3Error(err)) {
		console.warn(`[uploads] the bucket is still failing (${code ?? "S3Error"}): ${messageOf(err)}`)
		return new HttpError(
			"UNAVAILABLE",
			"The file store had a problem on its side. Nothing you did caused this – send it again in a moment.",
		)
	}
	return err
}

/**
 * Remove an object.
 *
 * Deleting a post row does not delete its bytes – a soft-deleted reel can be restored by a moderator, and its video has to still be there when it is. So this is for the orphan sweep and for the smoke test, not for the delete path.
 */
export async function deleteObject(key: string): Promise<void> {
	try {
		const s3 = await client()
		await withBucketRetry(() => s3.delete(key))
	} catch (err) {
		throw asUploadError(err)
	}
}

/**
 * Mint a public URL from a stored key. Keys are stored rather than URLs so the bucket or CDN can move without rewriting every row.
 */
export function publicUrlFor(key: string | null | undefined): string | null {
	if (!key) return null
	// Rows imported from a sibling programme carry their old asset host rather than a key of ours, and there is nothing to mint; pass an absolute URL through untouched. A key this app minted never starts with a scheme.
	if (/^https?:\/\//i.test(key)) return key
	const base = process.env.S3_PUBLIC_URL
	if (!base) return null
	return `${base.replace(/\/$/, "")}/${key}`
}
