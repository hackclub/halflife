import "server-only"
import { HttpError } from "@/lib/errors"
import db, { type DbOrTx, isUniqueViolation } from "@/lib/prisma8"
import type { UploadFolder } from "@/lib/uploads/r2"

/**
 * The record of an object the server checked after it landed.
 *
 * A key is not evidence of an upload. The key travels back through the browser between `/confirm` and whatever row
 * points at it, so without this a client can publish a reel with nothing behind it, tick a checkpoint off it, or name
 * an object it never sent. Every write that accepts a key asks for the row and takes the size and type from it.
 */
export interface ConfirmedUpload {
	byteSize: number
	contentHash: string | null
	contentType: string
	folder: string
	objectKey: string
	userId: string
}

export interface ConfirmUploadInput {
	byteSize: number
	/** The SHA-256 of the bytes when they were hashed; null for anything not named after its content. */
	contentHash?: string | null
	contentType: string
	folder: UploadFolder
	objectKey: string
	userId: string
}

/** Record what the bucket actually holds, after the size, type and bytes have been checked. */
export async function recordConfirmedUpload(input: ConfirmUploadInput, client: DbOrTx = db): Promise<ConfirmedUpload> {
	const row = {
		byteSize: input.byteSize,
		contentHash: input.contentHash ?? null,
		contentType: input.contentType,
		folder: input.folder,
		userId: input.userId,
	}
	// The unique index is on `objectKey`, which the upsert helper cannot conflict on, so this reads then writes and
	// retries once as an update if two confirms for the same key race.
	const existing = await client.orm.public.UploadedObject.where({ objectKey: input.objectKey }).select("id").first()
	if (existing) {
		await client.orm.public.UploadedObject.where({ id: existing.id }).update(row)
		return { objectKey: input.objectKey, ...row }
	}
	try {
		await client.orm.public.UploadedObject.create({ objectKey: input.objectKey, ...row })
	} catch (err) {
		if (!isUniqueViolation(err)) throw err
		await client.orm.public.UploadedObject.where({ objectKey: input.objectKey }).update(row)
	}
	return { objectKey: input.objectKey, ...row }
}

/** The confirmed records for these keys, keyed by object key. Keys with no record are simply absent. */
export async function confirmedUploads(userId: string, keys: readonly string[]): Promise<Map<string, ConfirmedUpload>> {
	const unique = [...new Set(keys)]
	if (unique.length === 0) return new Map()
	const rows = await db.orm.public.UploadedObject.where({ userId })
		.where(row => row.objectKey.in(unique))
		.all()
	return new Map(rows.map(row => [row.objectKey, row]))
}

/**
 * The record for one key, or a refusal.
 *
 * Only the caller's own uploads, only in the folders named. A key that was never confirmed is refused here rather
 * than written: that is the difference between an uploaded file and a name somebody typed.
 */
export async function requireConfirmedUpload(
	userId: string,
	objectKey: string,
	folders: readonly UploadFolder[],
): Promise<ConfirmedUpload> {
	const found = (await confirmedUploads(userId, [objectKey])).get(objectKey)
	if (!found || !folders.some(folder => folder === found.folder))
		throw new HttpError("VALIDATION_FAILED", "That upload has not been confirmed. Upload the file again")
	return found
}

/** The same check for a set of keys: every one must be confirmed, in one of the folders. */
export async function requireConfirmedUploads(
	userId: string,
	keys: readonly string[],
	folders: readonly UploadFolder[],
): Promise<Map<string, ConfirmedUpload>> {
	const records = await confirmedUploads(userId, keys)
	for (const key of new Set(keys)) {
		const found = records.get(key)
		if (!found || !folders.some(folder => folder === found.folder))
			throw new HttpError("VALIDATION_FAILED", "That upload has not been confirmed. Upload the file again")
	}
	return records
}
