import "server-only"
import { HttpError } from "@/lib/errors"
import {
	deleteObject,
	hashObject,
	isVideoBytes,
	MAX_UPLOAD_BYTES,
	readObjectHead,
	statObject,
	validateUpload,
} from "@/lib/uploads/r2"
import { sniffImage } from "@/lib/uploads/remote"

export type StoredUploadKind = "image" | "video"

export interface VerifiedStoredUpload {
	contentType: string
	ext: string
	size: number
	storedType: string | null
}

const DISCARDED = "That upload did not pass the checks, so it was discarded. Try again."

/**
 * Check an object the browser PUT straight into the bucket.
 *
 * Nothing about a direct upload is known until it has landed, so the checks the old route ran before `putObject` now run after it: the real size from the bucket rather than the client's claim, the bytes themselves, and for pictures the content hash the key is named after. That last one is what keeps a picture idempotent – the journal counts its evidence by URL, so if two uploads of the same screenshot got different keys they would count as two pictures.
 *
 * The stored Content-Type is checked here too, because a presigned PUT does not enforce the type it was signed with: R2 accepts any header the caller sends (measured against a live bucket). Without this a `.mp4` could be stored as `text/html` and served that way from the public asset host.
 *
 * A rejected object is deleted rather than left behind. The bucket is not a place to keep things the app refused, and an orphaned reel would still be billable storage.
 */
export async function verifyStoredUpload(
	key: string,
	kind: StoredUploadKind,
	expectedType: string,
	maxBytes = MAX_UPLOAD_BYTES,
): Promise<VerifiedStoredUpload> {
	const stat = await statObject(key)
	if (stat.size <= 0 || stat.size > maxBytes) {
		await discard(key)
		throw new HttpError("VALIDATION_FAILED", stat.size <= 0 ? DISCARDED : `Files must be under ${maxBytes} bytes`)
	}

	if (stat.type !== expectedType) {
		await discard(key)
		throw new HttpError("VALIDATION_FAILED", "That upload arrived with the wrong content type. Try it again.")
	}

	const ext = key.split(".").pop()?.toLowerCase() ?? ""

	if (kind === "video") {
		// A range, not the whole reel: the container signature and its brand list sit in the first few hundred bytes, and a WebM track list within the first megabyte.
		const head = await readObjectHead(key, 2 * 1024 * 1024)
		if (!isVideoBytes(head)) {
			await discard(key)
			throw new HttpError("VALIDATION_FAILED", "That file does not look like a video")
		}
		return { contentType: expectedType, ext, size: stat.size, storedType: stat.type }
	}

	const { head, sha256 } = await hashObject(key)
	const sniffed = sniffImage(head)
	if (!sniffed) {
		await discard(key)
		throw new HttpError("VALIDATION_FAILED", "That file does not look like a PNG, JPEG, GIF or WebP image")
	}

	// The key for a picture is `<folder>/<userId>/<sha256>.<ext>`. If the name and the bytes disagree, the client did not mint this key from the picture it sent, and letting it through would break the one-picture-one-URL rule above. The extension has to agree with the bytes as well, so a `.png` name cannot hide a JPEG.
	const expected = key.split("/").pop()?.split(".")[0] ?? ""
	const extensionAgrees = validateUpload(`x.${ext}`, sniffed.contentType, stat.size).ok
	if (expected !== sha256 || !extensionAgrees) {
		await discard(key)
		throw new HttpError("VALIDATION_FAILED", DISCARDED)
	}

	return { contentType: sniffed.contentType, ext: sniffed.ext, size: stat.size, storedType: stat.type }
}

/** Best-effort: a deletion that fails must not replace the reason the upload was refused. */
async function discard(key: string): Promise<void> {
	await deleteObject(key).catch(err => console.error("[uploads] could not discard a rejected upload:", key, err))
}
