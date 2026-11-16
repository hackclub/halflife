import "server-only"
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"
import db from "@/lib/prisma8"

/**
 * The rotating HCB refresh token, encrypted at rest.
 *
 * HCB revokes a refresh token the moment it is used and returns a new one with the exchange, so the token in `HCB_REFRESH_TOKEN` is a single-use bootstrap: a process that refreshes and forgets the replacement cannot refresh again after a restart, and every later attempt gets `invalid_grant`. The row here is what survives that. The env var is still required, because a deployment has to have one token to start from and an operator needs a way back in after a reset.
 *
 * Keyed from `BETTER_AUTH_SECRET` with an HKDF info string of its own, so this key is unrelated to the session signing key that shares the secret. Rotating `BETTER_AUTH_SECRET` logs everyone out and also makes the stored token unreadable; the operator then re-seeds it from the environment after clearing the row.
 */
const ID = "singleton"
const INFO = "half-life-hcb-refresh-token"

function deriveKey(): Buffer {
	const secret = process.env.BETTER_AUTH_SECRET
	if (!secret) throw new Error("BETTER_AUTH_SECRET is not set")
	return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32))
}

function encrypt(plaintext: string): string {
	const iv = randomBytes(12)
	const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv)
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
	return [iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":")
}

function decrypt(payload: string): string {
	const [ivB64, tagB64, dataB64] = payload.split(":")
	if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed HCB credential payload")
	const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"))
	decipher.setAuthTag(Buffer.from(tagB64, "base64"))
	return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}

/** The stored token, or null when none has been written yet (or the row cannot be read). Never throws: a database blip must not stop a refresh that the env token can still serve. */
export async function readStoredRefreshToken(): Promise<string | null> {
	try {
		const row = await db.orm.public.HcbCredential.whereUnique({ id: ID }).first()
		if (!row?.refreshToken) return null
		return decrypt(row.refreshToken)
	} catch (err) {
		console.warn("[hcb] could not read the stored refresh token:", err)
		return null
	}
}

/** Persist the token HCB returned with a refresh. Callers treat a failure as loud but not fatal: the access token it came with is still good for this process. */
export async function storeRefreshToken(token: string): Promise<void> {
	const refreshToken = encrypt(token)
	await db.orm.public.HcbCredential.upsert({
		conflictOn: { id: ID },
		create: { id: ID, refreshToken },
		update: { refreshToken },
	})
}
