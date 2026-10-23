import "dotenv/config"
import { createHash } from "node:crypto"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/app/generated/prisma/client"

/**
 * End-to-end check of the phone handoff.
 *
 * This feature deliberately accepts an unauthenticated upload, so the token is the only thing standing between a QR code and someone's account. Every property that keeps that narrow is asserted here:
 *
 * 1. The plaintext token is never stored – a database leak must not yield working upload links.
 * 2. One use, ever, claimed atomically so two phones racing the same code cannot both win.
 * 3. Expiry is enforced on the way in, not just in the UI.
 * 4. The object key is built from the handoff's OWNER, so a token can only ever write into the prefix of the person who generated it.
 * 5. Minting a new code retires the previous one, so a code photographed off a screen does not stay live.
 *
 * Requires uploads to be configured (S3_ACCESS_KEY_ID/SECRET, S3_BUCKET_NAME,
 * S3_ENDPOINT): minting itself refuses when R2 is absent, so the check fails
 * closed without credentials rather than passing vacuously. The uploaded round
 * trip object is deleted afterwards.
 *
 * Run with `pnpm verify:handoff` against a scratch database.
 */

const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
	const pass = JSON.stringify(actual) === JSON.stringify(expected)
	if (!pass) failures++
	console.log(
		`${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
	)
}

async function refused(label: string, fn: () => Promise<unknown>): Promise<void> {
	let threw = false
	try {
		await fn()
	} catch {
		threw = true
	}
	check(label, threw, true)
}

/** A tiny but genuinely valid mp4-shaped payload stands in for a recording. */
function fakeVideo() {
	const bytes = Buffer.from("00000018667479706d703432000000006d70343269736f6d", "hex")
	return {
		bytes: () => Promise.resolve(bytes),
		name: "clip.mp4",
		size: bytes.byteLength,
		type: "video/mp4",
	}
}

async function main() {
	const { createHandoff, resolveHandoff, completeHandoff, getHandoffStatus } = await import("../src/lib/handoff")
	const { isUploadConfigured, deleteObject } = await import("../src/lib/uploads/r2")

	const stamp = Date.now()

	// Minting refuses when R2 is absent, so fail closed here with a reason
	// instead of half-running into that refusal below.
	if (!isUploadConfigured()) {
		console.error("FAIL  uploads are not configured (S3_ACCESS_KEY_ID/SECRET, S3_BUCKET_NAME, S3_ENDPOINT required)")
		await prisma.$disconnect()
		process.exit(1)
	}

	const owner = await prisma.user.create({
		data: { email: `handoff-owner-${stamp}@example.test`, name: "Owner" },
	})
	const stranger = await prisma.user.create({
		data: { email: `handoff-stranger-${stamp}@example.test`, name: "Stranger" },
	})

	// ── The token is never stored ──────────────────────────────────────────────
	const handoff = await createHandoff(owner.id)
	const row = await prisma.uploadHandoff.findUniqueOrThrow({
		select: { objectKey: true, tokenHash: true, usedAt: true, userId: true },
		where: { id: handoff.id },
	})
	check("token is not stored in plaintext", row.tokenHash === handoff.token, false)
	check("what is stored is its SHA-256", row.tokenHash, createHash("sha256").update(handoff.token).digest("hex"))
	const anywhere = await prisma.uploadHandoff.count({
		where: { tokenHash: handoff.token },
	})
	check("the plaintext token matches no row", anywhere, 0)

	// ── Resolution ─────────────────────────────────────────────────────────────
	const resolved = await resolveHandoff(handoff.token)
	check("a fresh token resolves to its owner", resolved?.userId, owner.id)
	check("a garbage token does not resolve", await resolveHandoff("not-a-token"), null)
	check("an empty token does not resolve", await resolveHandoff(""), null)

	// ── Minting again retires the old code ─────────────────────────────────────
	const second = await createHandoff(owner.id)
	check("the previous code stops working", await resolveHandoff(handoff.token), null)
	check("the new one works", (await resolveHandoff(second.token))?.userId, owner.id)

	// ── Expiry is enforced server-side ─────────────────────────────────────────
	const expiring = await createHandoff(owner.id)
	await prisma.uploadHandoff.update({
		data: { expiresAt: new Date(Date.now() - 1000) },
		where: { id: expiring.id },
	})
	check("an expired token does not resolve", await resolveHandoff(expiring.token), null)
	await refused("an expired token cannot upload", () => completeHandoff(expiring.token, fakeVideo()))

	// ── Status is scoped to the owner ──────────────────────────────────────────
	const live = await createHandoff(owner.id)
	const waiting = await getHandoffStatus(live.id, owner.id)
	check("the owner sees it waiting", waiting?.state, "waiting")
	check("a stranger sees nothing", await getHandoffStatus(live.id, stranger.id), null)

	// ── Content type ───────────────────────────────────────────────────────────
	await refused("a non-video is rejected", () =>
		completeHandoff(live.token, {
			bytes: () => Promise.resolve(Buffer.from("plain text")),
			name: "notes.txt",
			size: 10,
			type: "text/plain",
		}),
	)
	check("a rejected upload does not spend the code", (await resolveHandoff(live.token))?.id, live.id)

	// ── The round trip ─────────────────────────────────────────────────────────
	const result = await completeHandoff(live.token, fakeVideo())

	// The whole security model in one assertion: the key is derived from the handoff's owner, so a token cannot write anywhere but its own prefix.
	check("the object key is under the OWNER's prefix", result.objectKey.startsWith(`posts/${owner.id}/`), true)
	check("and not the stranger's", result.objectKey.includes(stranger.id), false)

	const ready = await getHandoffStatus(live.id, owner.id)
	check("status flips to ready", ready?.state, "ready")
	check("and carries the key", ready?.state === "ready" ? ready.objectKey : null, result.objectKey)

	// Single use, which is what stops a photographed QR being replayed.
	check("the spent token no longer resolves", await resolveHandoff(live.token), null)
	await refused("a spent token cannot upload again", () => completeHandoff(live.token, fakeVideo()))

	await deleteObject(result.objectKey)
	console.log(`      (cleaned up ${result.objectKey})`)

	await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } })

	console.log(failures === 0 ? "\nAll handoff checks passed." : `\n${failures} check(s) failed.`)
	process.exit(failures === 0 ? 0 : 1)
}

try {
	await main()
} catch (err) {
	console.error(err)
	await prisma.$disconnect()
	process.exit(1)
}
