import "server-only"
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

/**
 * AES-256-GCM with an HKDF-derived key. Stored as `iv:authTag:ciphertext`, all base64.
 *
 * Only address and birthday are encrypted, and only when PULL_HCA_PII=true. They exist solely to fill in the grant row and a shipping label, and are decrypted at the moment of use – never selected into anything a browser sees.
 */
const INFO = "half-life-pii-encryption"

function deriveKey(): Buffer {
	const secret = process.env.PII_ENCRYPTION_KEY
	if (!secret) throw new Error("PII_ENCRYPTION_KEY is not set")
	return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32))
}

export function isPiiConfigured(): boolean {
	return Boolean(process.env.PII_ENCRYPTION_KEY)
}

export function encryptPII(plaintext: string): string {
	const key = deriveKey()
	const iv = randomBytes(12)
	const cipher = createCipheriv("aes-256-gcm", key, iv)
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
	const authTag = cipher.getAuthTag()
	return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(":")
}

export function decryptPII(payload: string): string {
	const [ivB64, tagB64, dataB64] = payload.split(":")
	if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed PII payload")
	const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"))
	decipher.setAuthTag(Buffer.from(tagB64, "base64"))
	return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}

/**
 * Decrypt without throwing. One corrupt column must not take down the whole record – the grant sync would rather ship a missing address line than fail outright and leave someone unpaid.
 */
export function safeDecrypt(payload: string | null | undefined): string | null {
	if (!payload) return null
	try {
		return decryptPII(payload)
	} catch (err) {
		console.warn("[pii] failed to decrypt a field:", err)
		return null
	}
}

export interface DecryptedAddress {
	birthday: string | null
	city: string | null
	country: string | null
	line1: string | null
	line2: string | null
	phone: string | null
	state: string | null
	zip: string | null
}

export function decryptUserPII(user: {
	encryptedAddressStreet?: string | null
	encryptedAddressLine2?: string | null
	encryptedAddressCity?: string | null
	encryptedAddressState?: string | null
	encryptedAddressZip?: string | null
	encryptedAddressCountry?: string | null
	encryptedBirthday?: string | null
	encryptedPhone?: string | null
}): DecryptedAddress {
	return {
		birthday: safeDecrypt(user.encryptedBirthday),
		city: safeDecrypt(user.encryptedAddressCity),
		country: safeDecrypt(user.encryptedAddressCountry),
		line1: safeDecrypt(user.encryptedAddressStreet),
		line2: safeDecrypt(user.encryptedAddressLine2),
		phone: safeDecrypt(user.encryptedPhone),
		state: safeDecrypt(user.encryptedAddressState),
		zip: safeDecrypt(user.encryptedAddressZip),
	}
}
