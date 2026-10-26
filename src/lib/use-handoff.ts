"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { z } from "zod"
import { errorMessage } from "@/lib/api-error"
import { postForm, putFile, routeMissing, uploadFailure, uploadFailureFrom } from "@/lib/upload-progress"

/**
 * The desktop half of the phone handoff.
 *
 * Asks the server for a single-use code, shows it as a QR, and polls until a phone has uploaded something – then hands the object key back, to be used exactly as if the file had been chosen on this machine.
 *
 * A hook rather than a component because two very differently dressed surfaces need it: the platform's reel modal and the staff composer. The polling rules are the part worth not having two of.
 *
 * Polling rather than a socket: this waits minutes at most, ends on its own, and a websocket would be a deployment concern for something idle 99% of the time.
 *
 * ## The response shape
 *
 * A successful response from this API is the payload itself. There is no `data` envelope – `ok()` in lib/api.ts calls `NextResponse.json(body)` directly, and only `fail()` wraps, in `{ error: { code, message } }`. Reading `payload.data` here is how this feature spent its whole life throwing "cannot read properties of undefined".
 */

export interface MintedHandoff {
	expiresAt: string
	id: string
	/** Rendered SVG, produced server-side. The token never leaves this origin. */
	qrSvg: string
	url: string
}

export type HandoffStatus = "idle" | "minting" | "waiting" | "ready" | "expired"

/** The handoff routes' payloads. Parsed rather than asserted, because the poll reads a state it acts on and the mint reads a code it shows. */
const HandoffPollBody = z.object({ objectKey: z.string().optional(), state: z.string(), url: z.string().nullish() })
const MintedHandoffBody = z.object({ expiresAt: z.string(), id: z.string(), qrSvg: z.string(), url: z.string() })
const ConfirmedUploadBody = z.object({ objectKey: z.string(), url: z.string().nullish() })
const PresignedUploadBody = z.object({ objectKey: z.string(), uploadUrl: z.string() })

const POLL_MS = 2500

export function useHandoff(onReady: (objectKey: string, url: string | null) => void): {
	minted: MintedHandoff | null
	status: HandoffStatus
	error: string | null
	mint(): Promise<void>
	cancel(): void
} {
	const [minted, setMinted] = useState<MintedHandoff | null>(null)
	const [status, setStatus] = useState<HandoffStatus>("idle")
	const [error, setError] = useState<string | null>(null)
	const timer = useRef<ReturnType<typeof setInterval> | null>(null)

	// The callback is held in a ref so a caller that passes an inline arrow – which is every caller – does not restart the poll on each render. Written in an effect rather than during render: a ref touched while rendering is not safe under concurrent rendering, and the compiler enforces it.
	const ready = useRef(onReady)
	useEffect(() => {
		ready.current = onReady
	}, [onReady])

	const stop = useCallback(() => {
		if (timer.current) {
			clearInterval(timer.current)
			timer.current = null
		}
	}, [])

	useEffect(() => stop, [stop])

	const poll = useCallback(
		(id: string) => {
			stop()
			timer.current = setInterval(async () => {
				try {
					const res = await fetch(`/api/handoff/${id}`)
					if (!res.ok) return
					const parsed = HandoffPollBody.safeParse(await res.json())
					if (!parsed.success) return
					const payload = parsed.data
					if (payload.state === "ready" && payload.objectKey) {
						stop()
						setStatus("ready")
						ready.current(payload.objectKey, payload.url ?? null)
						// Tell the server we have it, so nothing keeps this row live.
						void fetch(`/api/handoff/${id}`, { method: "POST" })
					} else if (payload.state === "expired") {
						stop()
						setStatus("expired")
					}
				} catch {
					// A dropped poll is not worth surfacing; the next tick retries.
				}
			}, POLL_MS)
		},
		[stop],
	)

	const mint = useCallback(async () => {
		setStatus("minting")
		setError(null)
		try {
			const res = await fetch("/api/handoff", { method: "POST" })
			if (!res.ok) {
				const payload: unknown = await res.json().catch(() => null)
				setError(errorMessage(payload, `Could not make a code (${res.status})`))
				setStatus("idle")
				return
			}
			const handoff = MintedHandoffBody.parse(await res.json())
			setMinted(handoff)
			setStatus("waiting")
			poll(handoff.id)
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not make a code")
			setStatus("idle")
		}
	}, [poll])

	const cancel = useCallback(() => {
		stop()
		setMinted(null)
		setStatus("idle")
	}, [stop])

	return { cancel, error, mint, minted, status }
}

/**
 * Upload a file from this machine.
 *
 * Returns the R2 object key. Keys rather than URLs everywhere: the bucket or the CDN in front of it can move without rewriting a single stored row.
 *
 * The bytes go browser → R2 with a presigned PUT, not through this origin: a reel is 14 MiB at the median and an origin behind Cloudflare only gets about 100 seconds to answer, so the old form path turned a slow uplink into 524. The signed-in server checks what landed at `/confirm`. The form route stays as the fallback for a browser that cannot reach the bucket directly, which is what a missing CORS rule looks like.
 */
export async function uploadFile(
	file: File,
	folder: string,
	/** The fraction sent, 0 to 1. 1 means sent, not yet stored. */
	onProgress?: (fraction: number) => void,
): Promise<{ objectKey: string; url: string | null }> {
	const presigned = await presignUpload(file, folder)
	if (!presigned) return uploadThroughServer(file, folder, onProgress)

	const put = await putFile(presigned.uploadUrl, file, onProgress)
	if (!put.ok) {
		// Status 0 means the browser never reached the bucket at all – CORS is not set on a deployment that has not had the rule applied yet, or this network blocks it. The slow path still works.
		if (put.status === 0) return uploadThroughServer(file, folder, onProgress)
		throw new Error(`Storage refused the upload (${put.status}). Try again.`)
	}

	const res = await fetch("/api/upload/confirm", {
		body: JSON.stringify({ contentType: file.type, objectKey: presigned.objectKey, size: file.size }),
		headers: { "content-type": "application/json" },
		method: "POST",
	})
	if (!res.ok) throw new Error(await uploadFailureFrom(res))

	const payload = ConfirmedUploadBody.parse(await res.json())
	return { objectKey: payload.objectKey, url: payload.url ?? null }
}

async function presignUpload(file: File, folder: string): Promise<{ objectKey: string; uploadUrl: string } | null> {
	// Pictures are keyed by their hash, and WebCrypto only exists in a secure context. A plain-HTTP deployment (a dev server on a LAN address, say) therefore takes the server path, which hashes after the upload instead.
	if (file.type.startsWith("image/") && !globalThis.crypto?.subtle) return null

	const res = await fetch("/api/upload/presign", {
		body: JSON.stringify({
			contentType: file.type,
			filename: file.name,
			folder,
			// Pictures are named after their bytes, so the key is minted here and `/confirm` checks the hash against what landed.
			...(file.type.startsWith("image/") ? { sha256: await sha256Hex(file) } : {}),
			size: file.size,
		}),
		headers: { "content-type": "application/json" },
		method: "POST",
	})
	if (res.ok) return PresignedUploadBody.parse(await res.json())
	// Only a deployment that does not have the route falls back; an ordinary refusal (an expired token, say) is the server's answer to show.
	if (routeMissing(res)) return null
	throw new Error(await uploadFailureFrom(res))
}

/** The original path, for a browser that cannot PUT to the bucket. Slow, and still subject to the edge timeout. */
async function uploadThroughServer(
	file: File,
	folder: string,
	onProgress?: (fraction: number) => void,
): Promise<{ objectKey: string; url: string | null }> {
	const body = new FormData()
	body.set("file", file)
	body.set("folder", folder)
	const res = await postForm("/api/upload", body, onProgress)
	if (!res.ok) throw new Error(uploadFailure(res))

	const payload = ConfirmedUploadBody.parse(res.json)
	return { objectKey: payload.objectKey, url: payload.url ?? null }
}

/**
 * The phone's side of a handoff, sent straight to the bucket.
 *
 * Same shape as `uploadFile`, but the token is the credential instead of a session, and there is no image path: a handoff only receives video.
 */
export async function uploadHandoffFile(
	token: string,
	file: File,
	onProgress?: (fraction: number) => void,
): Promise<void> {
	const res = await fetch("/api/handoff/presign", {
		body: JSON.stringify({
			contentType: file.type,
			filename: file.name,
			size: file.size,
			token,
		}),
		headers: { "content-type": "application/json" },
		method: "POST",
	})
	if (!res.ok) {
		if (routeMissing(res)) return uploadHandoffThroughServer(token, file, onProgress)
		throw new Error(await uploadFailureFrom(res))
	}
	const presigned = PresignedUploadBody.parse(await res.json())

	const put = await putFile(presigned.uploadUrl, file, onProgress)
	if (!put.ok) {
		if (put.status === 0) return uploadHandoffThroughServer(token, file, onProgress)
		throw new Error(`Storage refused the upload (${put.status}). Try again.`)
	}

	const confirm = await fetch("/api/handoff/confirm", {
		body: JSON.stringify({
			contentType: file.type,
			filename: file.name,
			objectKey: presigned.objectKey,
			size: file.size,
			token,
		}),
		headers: { "content-type": "application/json" },
		method: "POST",
	})
	if (!confirm.ok) throw new Error(await uploadFailureFrom(confirm))
}

async function uploadHandoffThroughServer(
	token: string,
	file: File,
	onProgress?: (fraction: number) => void,
): Promise<void> {
	const body = new FormData()
	body.append("token", token)
	body.append("file", file)
	const res = await postForm("/api/handoff/upload", body, onProgress)
	if (!res.ok) throw new Error(uploadFailure(res))
}

/**
 * The hash the picture's key is named after.
 *
 * WebCrypto has no streaming digest, so this holds the picture in memory – they are screenshots, and the ceiling is checked by the server anyway. A secure context is required, which every deployment of this app is.
 */
async function sha256Hex(file: File): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
}
