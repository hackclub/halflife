"use client"
import { useCallback, useEffect, useRef, useState } from "react"
import { postForm } from "@/lib/upload-progress"

/**
 * The desktop half of the phone handoff.
 *
 * Asks the server for a single-use code, shows it as a QR, and polls until a
 * phone has uploaded something — then hands the object key back, to be used
 * exactly as if the file had been chosen on this machine.
 *
 * A hook rather than a component because two very differently dressed surfaces
 * need it: the platform's reel modal and the staff composer. The polling rules
 * are the part worth not having two of.
 *
 * Polling rather than a socket: this waits minutes at most, ends on its own,
 * and a websocket would be a deployment concern for something idle 99% of the
 * time.
 *
 * ## The response shape
 *
 * A successful response from this API is the payload itself. There is no `data`
 * envelope — `ok()` in lib/api.ts calls `NextResponse.json(body)` directly, and
 * only `fail()` wraps, in `{ error: { code, message } }`. Reading `payload.data`
 * here is how this feature spent its whole life throwing "cannot read
 * properties of undefined".
 */

export interface MintedHandoff {
  id: string
  /** Rendered SVG, produced server-side. The token never leaves this origin. */
  qrSvg: string
  url: string
  expiresAt: string
}

export type HandoffStatus = "idle" | "minting" | "waiting" | "ready" | "expired"

const POLL_MS = 2500

export function useHandoff(onReady: (objectKey: string, url: string | null) => void) {
  const [minted, setMinted] = useState<MintedHandoff | null>(null)
  const [status, setStatus] = useState<HandoffStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // The callback is held in a ref so a caller that passes an inline arrow —
  // which is every caller — does not restart the poll on each render. Written
  // in an effect rather than during render: a ref touched while rendering is
  // not safe under concurrent rendering, and the compiler enforces it.
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
          const status = (await res.json()) as {
            state: string
            objectKey?: string
            url?: string | null
          }
          if (status.state === "ready" && status.objectKey) {
            stop()
            setStatus("ready")
            ready.current(status.objectKey, status.url ?? null)
            // Tell the server we have it, so nothing keeps this row live.
            void fetch(`/api/handoff/${id}`, { method: "POST" })
          } else if (status.state === "expired") {
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
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(payload.error?.message ?? `Could not make a code (${res.status})`)
        setStatus("idle")
        return
      }
      const handoff = (await res.json()) as MintedHandoff
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

  return { minted, status, error, mint, cancel }
}

/**
 * Upload a file from this machine.
 *
 * Returns the R2 object key. Keys rather than URLs everywhere: the bucket or
 * the CDN in front of it can move without rewriting a single stored row.
 */
export async function uploadFile(
  file: File,
  folder: string,
  /** The fraction sent, 0 to 1. 1 means sent, not yet stored. */
  onProgress?: (fraction: number) => void,
): Promise<{ objectKey: string; url: string | null }> {
  const body = new FormData()
  body.set("file", file)
  body.set("folder", folder)
  const res = await postForm("/api/upload", body, onProgress)
  if (!res.ok) {
    const payload = (res.json ?? {}) as { error?: { message?: string } }
    throw new Error(payload.error?.message ?? `Upload failed (${res.status})`)
  }
  const payload = res.json as { objectKey: string; url: string | null }
  return { objectKey: payload.objectKey, url: payload.url ?? null }
}
