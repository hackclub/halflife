import "server-only"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { HttpError } from "@/lib/errors"
import { POST_UPLOAD_FOLDER } from "@/lib/feed"
import prisma from "@/lib/prisma"
import db from "@/lib/prisma8"
import { parseDbTimestamp } from "@/lib/time"
import {
	buildObjectKey,
	deleteObject,
	isOwnedKey,
	isUploadConfigured,
	isVideoBytes,
	type PresignedUpload,
	presignUpload,
	publicUrlFor,
	putObject,
	validateUpload,
} from "@/lib/uploads/r2"
import { verifyStoredUpload } from "@/lib/uploads/verify"

/**
 * Handing recording off to a phone.
 *
 * The desktop mints a handoff, shows its token as a QR code, and the phone opens that URL and uploads a video – with no sign-in on the phone, which is the entire point of the feature.
 *
 * That makes the URL a bearer credential, so it is treated like one: high entropy, stored only as a hash, single use claimed under a guarded update, and a lifetime measured in minutes because the code sits on a screen other people can see. What it authorises is deliberately tiny – upload one video into one user's own prefix – so the worst case is a reel the owner did not record, not access to an account.
 */

/** Minutes a QR code stays good for. Long enough to find your phone. */
export const HANDOFF_TTL_MINUTES = 10

/**
 * The most this path takes.
 *
 * A phone video is tens of megabytes, so 64 MiB is generous for the thing this route is for and a quarter of what the signed-in upload route allows. It lives here rather than in the route because the direct-upload path has to enforce the same ceiling, and the old form path would otherwise have enforced a different one.
 */
export const HANDOFF_MAX_UPLOAD_BYTES = 64 * 1024 * 1024

/** How many upload starts one address may make in a minute. */
export const HANDOFF_MAX_PER_MINUTE = 5

/** Only video: this path exists to receive a recording. */
const ALLOWED_PREFIX = "video/"

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex")
}

export interface NewHandoff {
	expiresAt: Date
	id: string
	/** The only time the plaintext token exists. Never stored, never logged. */
	token: string
}

/**
 * Mint a handoff, and retire the user's other unspent ones.
 *
 * Retiring the old ones matters: without it, every QR a participant ever generated stays live until its own expiry, so a code someone photographed off a screen ten minutes ago still works. One live code per person at a time is the behaviour people already expect from a pairing screen.
 */
export async function createHandoff(userId: string): Promise<NewHandoff> {
	if (!isUploadConfigured()) throw new HttpError("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	const token = randomBytes(32).toString("base64url")
	const expiresAt = new Date(Date.now() + HANDOFF_TTL_MINUTES * 60_000)

	const handoff = await prisma.$transaction(async tx => {
		await tx.uploadHandoff.updateMany({
			data: { expiresAt: new Date() },
			where: { expiresAt: { gt: new Date() }, usedAt: null, userId },
		})
		return tx.uploadHandoff.create({
			data: { expiresAt, tokenHash: hashToken(token), userId },
			select: { expiresAt: true, id: true },
		})
	})

	return { expiresAt: handoff.expiresAt, id: handoff.id, token }
}

export interface HandoffTarget {
	expiresAt: Date
	id: string
	userId: string
}

/**
 * Look a token up without spending it, for rendering the phone page.
 *
 * The comparison is timing-safe even though the lookup is by hash: an attacker who can measure it learns nothing useful about a 32-byte random token, but the cost of doing it properly is one function call.
 */
export async function resolveHandoff(token: string): Promise<HandoffTarget | null> {
	if (!token) return null
	const tokenHash = hashToken(token)

	const row = await db.orm.public.UploadHandoff.where({ tokenHash })
		.select("expiresAt", "id", "tokenHash", "usedAt", "userId")
		.first()
	if (!row) return null

	const a = Buffer.from(row.tokenHash, "hex")
	const b = Buffer.from(tokenHash, "hex")
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null

	const expiresAt = parseDbTimestamp(row.expiresAt)
	if (row.usedAt) return null
	if (expiresAt <= new Date()) return null

	return { expiresAt, id: row.id, userId: row.userId }
}

export interface HandoffUploadResult {
	objectKey: string
}

/** What a phone says it is sending, before or after the bytes have left it. */
export interface HandoffFileClaim {
	contentType: string
	filename: string
	size: number
}

/**
 * The checks both handoff paths share: this is a video, it fits, and its name agrees with its type.
 *
 * They run at presign, where a bad claim should stop the phone before it spends its data, and again at confirm, because a presigned URL is not a promise about what was actually sent.
 */
function validateHandoffFile(file: HandoffFileClaim): { ext: string } {
	if (!file.contentType.startsWith(ALLOWED_PREFIX)) throw new HttpError("VALIDATION_FAILED", "That is not a video")
	if (file.size > HANDOFF_MAX_UPLOAD_BYTES)
		throw new HttpError("VALIDATION_FAILED", `Videos must be under ${HANDOFF_MAX_UPLOAD_BYTES} bytes`)
	const check = validateUpload(file.filename, file.contentType, file.size)
	if (!check.ok) throw new HttpError("VALIDATION_FAILED", check.reason)
	return { ext: check.ext }
}

/**
 * Mint the URL the phone uploads to directly.
 *
 * The token is not spent here. Spending it is what `completeHandoffObject` does, after the bytes exist and have been checked – a code should not burn because a phone died mid-send before anything arrived.
 *
 * The key comes from the handoff's OWNER and a random name, never from the request, so the URL can only write into the prefix of the person who generated the code.
 */
export async function prepareHandoffUpload(token: string, file: HandoffFileClaim): Promise<PresignedUpload> {
	if (!isUploadConfigured()) throw new HttpError("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	const target = await resolveHandoff(token)
	if (!target) throw new HttpError("NOT_FOUND", "This link has expired or has already been used")

	const { ext } = validateHandoffFile(file)
	return presignUpload(buildObjectKey(target.userId, POST_UPLOAD_FOLDER, ext), file.contentType)
}

/**
 * Spend a handoff on an object the phone already PUT into the bucket.
 *
 * The object key travels back through the phone, so it is checked against the token's owner and the folder this app uses before it is believed. The video signature, the real size and the container type are checked from the bucket's copy, and a token that loses the claim race deletes its own upload rather than leaving an orphan.
 */
export async function completeHandoffObject(
	token: string,
	file: HandoffFileClaim & { objectKey: string },
): Promise<HandoffUploadResult> {
	if (!isUploadConfigured()) throw new HttpError("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	const target = await resolveHandoff(token)
	if (!target) throw new HttpError("NOT_FOUND", "This link has expired or has already been used")

	const { ext } = validateHandoffFile(file)
	const prefix = `${POST_UPLOAD_FOLDER}/${target.userId}/`
	const segments = file.objectKey.split("/")
	if (
		segments.length !== 3
		|| !isOwnedKey(target.userId, file.objectKey)
		|| !file.objectKey.startsWith(prefix)
		|| !file.objectKey.endsWith(`.${ext}`)
	)
		throw new HttpError("FORBIDDEN", "That object is not the upload this link made")

	const verified = await verifyStoredUpload(file.objectKey, "video", file.contentType, HANDOFF_MAX_UPLOAD_BYTES)

	// Claim after the bytes are known good, but before recording them. Two phones on one QR both get this far; only one wins the guarded update, and the loser's own copy is removed.
	const claimed = await prisma.uploadHandoff.updateMany({
		data: { usedAt: new Date() },
		where: { expiresAt: { gt: new Date() }, id: target.id, usedAt: null },
	})
	if (claimed.count !== 1) {
		await deleteObject(file.objectKey).catch(err =>
			console.error("[handoff] could not remove a losing upload:", file.objectKey, err),
		)
		throw new HttpError("CONFLICT", "This link has already been used")
	}

	await prisma.uploadHandoff.update({
		data: { byteSize: verified.size, contentType: file.contentType, objectKey: file.objectKey },
		where: { id: target.id },
	})

	return { objectKey: file.objectKey }
}

/**
 * Spend a handoff on one uploaded file sent through this origin.
 *
 * Kept for the form path, which is still the fallback when a browser cannot PUT directly to the bucket (no CORS rule yet, or a network that blocks it). The direct path is `completeHandoffObject`.
 *
 * The claim is a guarded `updateMany` rather than a read-then-write: two phones pointed at the same QR code both pass a read check, and only one can win an `UPDATE ... WHERE usedAt IS NULL`. The row is claimed BEFORE the bytes go to R2, so a slow upload cannot be raced by a second one.
 */
export async function completeHandoff(
	token: string,
	file: { name: string; type: string; size: number; bytes(): Promise<Buffer> },
): Promise<HandoffUploadResult> {
	const target = await resolveHandoff(token)
	if (!target) throw new HttpError("NOT_FOUND", "This link has expired or has already been used")

	const check = validateHandoffFile({ contentType: file.type, filename: file.name, size: file.size })

	const bytes = await file.bytes()
	if (!isVideoBytes(bytes)) throw new HttpError("VALIDATION_FAILED", "That file does not look like a video")

	// Claim first. Losing this race means another phone already used the code.
	const claimed = await prisma.uploadHandoff.updateMany({
		data: { usedAt: new Date() },
		where: { expiresAt: { gt: new Date() }, id: target.id, usedAt: null },
	})
	if (claimed.count !== 1) throw new HttpError("CONFLICT", "This link has already been used")

	// The owner comes from the handoff row, never from the request, so a token can only ever write into the prefix of the person who generated it.
	const key = buildObjectKey(target.userId, POST_UPLOAD_FOLDER, check.ext)

	// A failed upload is deliberately not retried, and not re-armed either: letting this re-arm the code gave anyone holding a photo of the QR unlimited attempts past the first claim, since every R2 failure freed the code again. Minting a fresh code is one click on the desktop, so a failed upload asks for a new one.
	await putObject(key, bytes, file.type)

	await prisma.uploadHandoff.update({
		data: { byteSize: file.size, contentType: file.type, objectKey: key },
		where: { id: target.id },
	})

	return { objectKey: key }
}

export type HandoffStatus =
	| { state: "waiting"; expiresAt: Date }
	| { state: "expired" }
	| { state: "ready"; objectKey: string; contentType: string | null; url: string | null }

/** What the desktop polls. Scoped to the owner, so ids are not guessable keys. */
export async function getHandoffStatus(id: string, userId: string): Promise<HandoffStatus | null> {
	const row = await prisma.uploadHandoff.findFirst({
		select: { contentType: true, expiresAt: true, objectKey: true, usedAt: true },
		where: { id, userId },
	})
	if (!row) return null

	if (row.objectKey)
		// The URL comes along so the desktop can play what the phone filmed before it is posted; it is minted here, at read time, like every other one.
		return {
			contentType: row.contentType,
			objectKey: row.objectKey,
			state: "ready",
			url: publicUrlFor(row.objectKey),
		}

	// Expiry only ends the wait while nothing has been uploaded; a video that landed a second before the deadline is still the user's.
	if (row.expiresAt <= new Date()) return { state: "expired" }
	return { expiresAt: row.expiresAt, state: "waiting" }
}

/** Mark a handoff as picked up, so the desktop stops polling it. Returns whether a row was actually claimed. */
export async function claimHandoff(id: string, userId: string): Promise<boolean> {
	const result = await prisma.uploadHandoff.updateMany({
		data: { claimedAt: new Date() },
		where: { id, userId },
	})
	return result.count === 1
}
