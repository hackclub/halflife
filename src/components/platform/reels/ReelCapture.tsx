"use client"

import { useRef, useState } from "react"
import { IconFilm } from "@/components/platform/icons"
import { UploadProgress } from "@/components/platform/UploadProgress"
import { Button, cx, Panel } from "@/components/platform/ui"
import { uploadFile, useHandoff } from "@/lib/use-handoff"

/**
 * Getting a video out of someone and into the bucket.
 *
 * Two routes, because the program runs on hardware that is nowhere near the
 * machine the platform is open on. You can pick a file here, or scan a code and
 * film on your phone — which is the one that actually gets used, since the
 * bench and the laptop are rarely the same desk. The phone route needs no
 * sign-in on the phone: the QR carries a single-use token that expires in
 * minutes, so nobody has to type a Hack Club password into a borrowed handset.
 *
 * Either way what is stored is an R2 object key, never a URL. URLs are minted
 * at read time so the bucket or the CDN in front of it can move without
 * rewriting a single stored row.
 *
 * `onCaptured` also hands back something playable, for previewing the clip
 * before it is posted: a local blob URL when the file came from this machine
 * (instant, and it works on a deployment with no public bucket URL), or the
 * bucket's URL when it came from the phone. It is null when neither exists.
 */
export function ReelCapture({
  objectKey,
  onCaptured,
  folder = "posts",
  label = "Your reel",
}: {
  objectKey: string | null
  onCaptured: (objectKey: string | null, previewUrl?: string | null) => void
  folder?: string
  label?: string
}) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const handoff = useHandoff((key, url) => {
    onCaptured(key, url)
    setShowQr(false)
  })

  async function pick(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setProgress(null)
    setError(null)
    try {
      const { objectKey: key, url } = await uploadFile(file, folder, setProgress)
      onCaptured(key, file.type.startsWith("video/") ? URL.createObjectURL(file) : url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not upload")
    } finally {
      setBusy(false)
    }
  }

  if (objectKey) {
    return (
      <Panel tone="teal" radius={16} className="flex items-center gap-3 bg-cream px-4 py-3">
        <IconFilm className="shrink-0 text-[1.4rem] text-teal-deep" />
        <p className="min-w-0 flex-1 text-[0.9rem] leading-snug font-semibold text-navy">
          {label} is uploaded and ready to post.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            onCaptured(null)
            handoff.cancel()
          }}
        >
          Replace
        </Button>
      </Panel>
    )
  }

  return (
    <div className="grid gap-3">
      {error && (
        <p className="text-[0.85rem] font-semibold text-coral-deep" role="alert">
          {error}
        </p>
      )}

      {/* A reel is the biggest thing anyone uploads here, often over school
          wifi — without a bar, a minute of sending looks like a hang. */}
      {busy && <UploadProgress progress={progress} name="Your video" className="max-w-[420px]" />}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Choose a video"}
        </Button>
        <Button
          variant="outline"
          disabled={handoff.status === "minting"}
          onClick={() => {
            setShowQr(true)
            void handoff.mint()
          }}
        >
          {handoff.status === "minting" ? "Making a code…" : "Record on my phone"}
        </Button>
      </div>

      <input
        ref={input}
        type="file"
        accept="video/*"
        className="sr-only"
        // `capture` is a hint, not a constraint: on a phone it opens the camera
        // straight away, and on a laptop the browser ignores it and shows the
        // file picker, which is exactly what is wanted in both places.
        capture="environment"
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      {showQr && handoff.minted && handoff.status === "waiting" && (
        <Panel tone="line" radius={16} className="grid justify-items-center gap-3 bg-paper p-5">
          {/* Server-rendered SVG from our own origin — the token is never sent
              to a third-party QR service.
              The SVG carries its own width, so it is forced to the box rather
              than trusted to fit: at its natural 200px it overflowed and sat on
              top of the caption. */}
          <div
            aria-label="QR code linking to the upload page"
            className="w-[180px] [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: handoff.minted.qrSvg }}
          />
          <p className="hand text-center text-[0.85rem] text-navy-soft">
            Scan it, film it, and the video lands here. Works once, expires shortly.
          </p>
          <p className="label text-sky-deep">Waiting for your phone…</p>
        </Panel>
      )}

      {handoff.status === "expired" && (
        <p className={cx("hand text-[0.85rem] text-coral-deep")}>That code expired. Make another one.</p>
      )}
      {handoff.error && (
        <p className="text-[0.85rem] font-semibold text-coral-deep" role="alert">
          {handoff.error}
        </p>
      )}
    </div>
  )
}
