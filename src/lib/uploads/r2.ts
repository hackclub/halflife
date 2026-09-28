import "server-only"
import { randomUUID } from "node:crypto"
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { HttpError } from "@/lib/errors"

const DEFAULT_MAX_UPLOAD_BYTES = 104_857_600

/**
 * An unparseable UPLOAD_MAX_BYTES used to yield NaN, and every `size > NaN`
 * comparison is false — which silently removed the cap instead of failing
 * loudly. Fall back to the default rather than trusting the environment.
 */
function parseMaxBytes(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_UPLOAD_BYTES
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_BYTES
}

export const MAX_UPLOAD_BYTES = parseMaxBytes(process.env.UPLOAD_MAX_BYTES)

const EXTENSION_MIME: Record<string, string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  mp4: ["video/mp4"],
  webm: ["video/webm"],
  mov: ["video/quicktime"],
}

/**
 * ISO base media (MP4/MOV) brands that are video.
 *
 * `ftyp` alone is not enough: the same box opens HEIC, AVIF and JPEG 2000
 * images, so a still image renamed `.mp4` with a `video/mp4` content type would
 * otherwise pass. Only brands a video actually uses are accepted, and a file
 * whose major brand is unusual still passes if a compatible brand is known.
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
  for (let i = 0; i < 4; i += 1) brand += String.fromCharCode(bytes[offset + i] ?? 0)
  return brand
}

function isIsoBmffVideo(bytes: Uint8Array): boolean {
  if (brandAt(bytes, 4) !== "ftyp") return false
  if (VIDEO_FTYP_BRANDS.has(brandAt(bytes, 8))) return true

  // The major brand can be generic (`isom`) with the real one listed among the
  // compatible brands, so scan those too. The box size is big-endian; a size of
  // 0 means "to end of file" and is treated as the whole buffer.
  const declared = ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)
  const end = declared >= 16 ? Math.min(declared >>> 0, bytes.length) : bytes.length
  for (let offset = 16; offset + 4 <= end; offset += 4) {
    if (VIDEO_FTYP_BRANDS.has(brandAt(bytes, offset))) return true
  }
  return false
}

/**
 * A MIME type and filename are only claims. These are the container signatures
 * for the video formats the app accepts, so a renamed image or text file cannot
 * become a reel by lying about its extension.
 */
export function isVideoBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false

  // ISO base media (MP4/MOV): `....ftyp` at byte 4, then a brand that must be
  // a video one — `heic`, `avif` and `jxl ` share the box and are not video.
  if (brandAt(bytes, 4) === "ftyp") return isIsoBmffVideo(bytes)

  // Matroska/WebM: EBML header 1A 45 DF A3.
  return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
}

export const UPLOAD_FOLDERS = ["sessions", "covers", "timelapses", "posts"] as const
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number]

export interface UploadedObjectSummary {
  key: string
  size: number
  lastModified: Date | null
  storageClass: string | null
  url: string | null
}

export interface UploadedObjectPage {
  objects: UploadedObjectSummary[]
  nextCursor: string | null
  prefix: string
}

export function isUploadConfigured(): boolean {
  return !!(
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET_NAME &&
    process.env.S3_ENDPOINT
  )
}

function credentials() {
  return {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  }
}

function client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: credentials(),
  })
}

/** Some R2 configurations put the bucket in the endpoint path, e.g. `/my-bucket`. */
function endpointIncludesBucket(): boolean {
  const endpoint = process.env.S3_ENDPOINT
  const bucket = process.env.S3_BUCKET_NAME
  if (!endpoint || !bucket) return false
  try {
    const path = new URL(endpoint).pathname.replace(/^\/+|\/+$/g, "")
    return path === bucket
  } catch {
    return false
  }
}

function listingClient(): S3Client {
  const endpoint = process.env.S3_ENDPOINT
  if (!endpoint || !endpointIncludesBucket()) {
    return new S3Client({ region: "auto", endpoint, credentials: credentials() })
  }

  const root = new URL(endpoint)
  root.pathname = root.pathname.replace(/\/[^/]+$/, "")
  return new S3Client({
    region: "auto",
    endpoint: root.toString().replace(/\/$/, ""),
    credentials: credentials(),
  })
}

export async function listUploadedObjects(
  opts: { prefix?: string; cursor?: string; limit?: number } = {},
): Promise<UploadedObjectPage> {
  if (!isUploadConfigured()) {
    throw new HttpError("NOT_CONFIGURED", "File uploads are not configured on this deployment")
  }

  const prefix = opts.prefix ?? ""
  const bucket = process.env.S3_BUCKET_NAME!
  const bucketPrefix = endpointIncludesBucket() ? `${bucket}/` : ""
  const requestPrefix = bucketPrefix ? `${bucketPrefix}${prefix}` : prefix || undefined
  try {
    const result = await listingClient().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: requestPrefix || undefined,
        MaxKeys: Math.min(Math.max(opts.limit ?? 100, 1), 1000),
        ContinuationToken: opts.cursor || undefined,
      }),
    )

    return {
      objects: (result.Contents ?? []).flatMap((object) => {
        if (!object.Key) return []
        const key =
          bucketPrefix && object.Key.startsWith(bucketPrefix) ? object.Key.slice(bucketPrefix.length) : object.Key
        return [
          {
            key,
            size: object.Size ?? 0,
            lastModified: object.LastModified ?? null,
            storageClass: object.StorageClass ?? null,
            url: publicUrlFor(key),
          },
        ]
      }),
      nextCursor: result.IsTruncated ? (result.NextContinuationToken ?? null) : null,
      prefix,
    }
  } catch (err) {
    throw asConfigError(err)
  }
}

/** Both extension and MIME type must be on the allowlist and must agree. */
export function validateUpload(
  filename: string,
  contentType: string,
  size: number,
): { ok: true; ext: string } | { ok: false; reason: string } {
  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `File is larger than ${MAX_UPLOAD_BYTES} bytes` }
  }
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const allowed = EXTENSION_MIME[ext]
  if (!allowed) return { ok: false, reason: `Unsupported file type: .${ext}` }
  if (!allowed.includes(contentType)) {
    return { ok: false, reason: `Content type ${contentType} does not match .${ext}` }
  }
  return { ok: true, ext }
}

/**
 * Keys are namespaced by user. Stasis's flat `folder/timestamp-random.ext`
 * makes abuse untraceable and orphan cleanup impossible.
 */
export function buildObjectKey(userId: string, folder: string, ext: string): string {
  return `${folder}/${userId}/${randomUUID()}.${ext}`
}

/**
 * Does this key belong to this user?
 *
 * Every key this app mints is `<folder>/<userId>/<uuid>.<ext>`, so the owner is
 * the second segment. Anything else came from somewhere else.
 *
 * This has to be checked wherever a client hands a key back, because keys are
 * not secrets: the feed returns a full `videoUrl` for every reel, so any
 * participant can read another participant's key and offer it as their own.
 * Without this, someone could attach a stranger's timelapse to their journal as
 * evidence for hours they did not work — which is the one thing the timelapse
 * rule exists to make hard.
 *
 * `..` is refused separately, and so is `%`. Neither can appear in a minted
 * key, and a key containing either is trying to be a path rather than a name:
 * the browser resolves `covers/me/../../sessions/other/x` before it fetches,
 * and the URL parser treats a `%2e%2e` segment as a double-dot too — so a
 * check for a literal `..` alone would let both escape the user's own prefix.
 */
export function isOwnedKey(userId: string, key: string): boolean {
  if (key.includes("..") || key.includes("%")) return false
  return key.split("/")[1] === userId
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )
  } catch (err) {
    throw asConfigError(err)
  }
}

/**
 * Credentials the bucket rejected are an operator problem, not a user one.
 *
 * Without this they surface as an unhandled exception and the participant is
 * told "Something went wrong" — which happened, with a Cloudflare API token
 * pasted into `S3_ACCESS_KEY_ID`, and the phone only found out AFTER the video
 * had been recorded and uploaded. A 503 saying uploads are misconfigured is
 * both true and actionable; the detail stays in the server log, because the
 * message the bucket returns names the credential.
 *
 * Only client-side faults are translated. A network blip or a bucket outage is
 * genuinely transient and should keep its own error and its retry semantics.
 */
function asConfigError(err: unknown): unknown {
  const fault = (err as { $fault?: string })?.$fault
  const name = (err as { name?: string })?.name
  const credentialFault =
    fault === "client" &&
    ["InvalidArgument", "InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied", "NoSuchBucket"].includes(
      name ?? "",
    )
  if (!credentialFault) return err
  console.error("[uploads] the bucket rejected our credentials:", err)
  return new HttpError(
    "NOT_CONFIGURED",
    "File uploads are misconfigured on this deployment. Nothing you did caused this.",
  )
}

/**
 * Remove an object.
 *
 * Deleting a post row does not delete its bytes — a soft-deleted reel can be
 * restored by a moderator, and its video has to still be there when it is. So
 * this is for the orphan sweep and for the smoke test, not for the delete
 * path.
 */
export async function deleteObject(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }))
}

/**
 * Mint a public URL from a stored key. Keys are stored rather than URLs so the
 * bucket or CDN can move without rewriting every row.
 */
export function publicUrlFor(key: string | null | undefined): string | null {
  if (!key) return null
  const base = process.env.S3_PUBLIC_URL
  if (!base) return null
  return `${base.replace(/\/$/, "")}/${key}`
}
