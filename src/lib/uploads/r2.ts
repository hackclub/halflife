import "server-only"
import { randomUUID } from "node:crypto"
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
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

export function isUploadConfigured(): boolean {
  return !!(
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET_NAME &&
    process.env.S3_ENDPOINT
  )
}

function client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  })
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
 * `..` is refused separately. It cannot appear in a minted key, and a key that
 * contains one is trying to be a path rather than a name.
 */
export function isOwnedKey(userId: string, key: string): boolean {
  if (key.includes("..")) return false
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
