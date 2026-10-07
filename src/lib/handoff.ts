import "server-only"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { HttpError } from "@/lib/errors"
import { POST_UPLOAD_FOLDER } from "@/lib/feed"
import prisma from "@/lib/prisma"
import {
	buildObjectKey,
	isUploadConfigured,
	isVideoBytes,
	MAX_UPLOAD_BYTES,
	publicUrlFor,
	putObject,
	validateUpload,
} from "@/lib/uploads/r2"

/**
 * Handing recording off to a phone.
 *
 * The desktop mints a handoff, shows its token as a QR code, and the phone
 * opens that URL and uploads a video — with no sign-in on the phone, which is
 * the entire point of the feature.
 *
 * That makes the URL a bearer credential, so it is treated like one: high
 * entropy, stored only as a hash, single use claimed under a guarded update,
 * and a lifetime measured in minutes because the code sits on a screen other
 * people can see. What it authorises is deliberately tiny — upload one video
 * into one user's own prefix — so the worst case is a reel the owner did not
 * record, not access to an account.
 */

/** Minutes a QR code stays good for. Long enough to find your phone. */
export const HANDOFF_TTL_MINUTES = 10

/** Only video: this path exists to receive a recording. */
const ALLOWED_PREFIX = "video/"

function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex")
}

export interface NewHandoff {
	id: string
	/** The only time the plaintext token exists. Never stored, never logged. */
	token: string
	expiresAt: Date
}

/**
 * Mint a handoff, and retire the user's other unspent ones.
 *
 * Retiring the old ones matters: without it, every QR a participant ever
 * generated stays live until its own expiry, so a code someone photographed
 * off a screen ten minutes ago still works. One live code per person at a
 * time is the behaviour people already expect from a pairing screen.
 */
export async function createHandoff(userId: string): Promise<NewHandoff> {
	if (!isUploadConfigured()) {
		throw new HttpError("NOT_CONFIGURED", "File uploads are not configured on this deployment")
	}

	const token = randomBytes(32).toString("base64url")
	const expiresAt = new Date(Date.now() + HANDOFF_TTL_MINUTES * 60_000)

	const handoff = await prisma.$transaction(async (tx) => {
		await tx.uploadHandoff.updateMany({
			where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
			data: { expiresAt: new Date() },
		})
		return tx.uploadHandoff.create({
			data: { tokenHash: hashToken(token), userId, expiresAt },
			select: { id: true, expiresAt: true },
		})
	})

	return { id: handoff.id, token, expiresAt: handoff.expiresAt }
}

export interface HandoffTarget {
	id: string
	userId: string
	expiresAt: Date
}

/**
 * Look a token up without spending it, for rendering the phone page.
 *
 * The comparison is timing-safe even though the lookup is by hash: an attacker
 * who can measure it learns nothing useful about a 32-byte random token, but
 * the cost of doing it properly is one function call.
 */
export async function resolveHandoff(token: string): Promise<HandoffTarget | null> {
	if (!token) return null
	const tokenHash = hashToken(token)

	const row = await prisma.uploadHandoff.findUnique({
		where: { tokenHash },
		select: { id: true, userId: true, expiresAt: true, usedAt: true, tokenHash: true },
	})
	if (!row) return null

	const a = Buffer.from(row.tokenHash, "hex")
	const b = Buffer.from(tokenHash, "hex")
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null

	if (row.usedAt) return null
	if (row.expiresAt <= new Date()) return null

	return { id: row.id, userId: row.userId, expiresAt: row.expiresAt }
}

export interface HandoffUploadResult {
	objectKey: string
}

/**
 * Spend a handoff on one uploaded file.
 *
 * The claim is a guarded `updateMany` rather than a read-then-write: two
 * phones pointed at the same QR code both pass a read check, and only one can
 * win an `UPDATE ... WHERE usedAt IS NULL`. The row is claimed BEFORE the
 * bytes go to R2, so a slow upload cannot be raced by a second one.
 */
export async function completeHandoff(
	token: string,
	file: { name: string; type: string; size: number; bytes: () => Promise<Buffer> },
): Promise<HandoffUploadResult> {
	const target = await resolveHandoff(token)
	if (!target) {
		throw new HttpError("NOT_FOUND", "This link has expired or has already been used")
	}

	if (!file.type.startsWith(ALLOWED_PREFIX)) {
		throw new HttpError("VALIDATION_FAILED", "That is not a video")
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		throw new HttpError("VALIDATION_FAILED", `Videos must be under ${MAX_UPLOAD_BYTES} bytes`)
	}
	const check = validateUpload(file.name, file.type, file.size)
	if (!check.ok) throw new HttpError("VALIDATION_FAILED", check.reason)

	const bytes = await file.bytes()
	if (!isVideoBytes(bytes)) {
		throw new HttpError("VALIDATION_FAILED", "That file does not look like a video")
	}

	// Claim first. Losing this race means another phone already used the code.
	const claimed = await prisma.uploadHandoff.updateMany({
		where: { id: target.id, usedAt: null, expiresAt: { gt: new Date() } },
		data: { usedAt: new Date() },
	})
	if (claimed.count !== 1) {
		throw new HttpError("CONFLICT", "This link has already been used")
	}

	// The owner comes from the handoff row, never from the request, so a token
	// can only ever write into the prefix of the person who generated it.
	const key = buildObjectKey(target.userId, POST_UPLOAD_FOLDER, check.ext)

	try {
		await putObject(key, bytes, file.type)
	} catch (err) {
		// The code stays spent: re-arming it here gave anyone holding a photo
		// of the QR unlimited attempts past the first claim (each R2 failure
		// freed the code again). Minting a fresh code is one click on the
		// desktop, so a failed upload asks for a new code instead of retrying
		// the old one.
		throw err
	}

	await prisma.uploadHandoff.update({
		where: { id: target.id },
		data: { objectKey: key, contentType: file.type, byteSize: file.size },
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
		where: { id, userId },
		select: { expiresAt: true, usedAt: true, objectKey: true, contentType: true },
	})
	if (!row) return null

	if (row.objectKey) {
		// The URL comes along so the desktop can play what the phone filmed before
		// it is posted; it is minted here, at read time, like every other one.
		return {
			state: "ready",
			objectKey: row.objectKey,
			contentType: row.contentType,
			url: publicUrlFor(row.objectKey),
		}
	}
	// Expiry only ends the wait while nothing has been uploaded; a video that
	// landed a second before the deadline is still the user's.
	if (row.expiresAt <= new Date()) return { state: "expired" }
	return { state: "waiting", expiresAt: row.expiresAt }
}

/** Mark a handoff as picked up, so the desktop stops polling it. */
export async function claimHandoff(id: string, userId: string): Promise<void> {
	await prisma.uploadHandoff.updateMany({
		where: { id, userId },
		data: { claimedAt: new Date() },
	})
}
