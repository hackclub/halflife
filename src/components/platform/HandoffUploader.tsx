"use client"
import { useRef, useState } from "react"
import { Button, Field, Meter, TextInput } from "@/components/platform/ui"
import { isVideoFile, VIDEO_ACCEPT, VIDEO_TYPE_MESSAGE } from "@/lib/uploads/video-accept"
import { uploadHandoffFile } from "@/lib/use-handoff"

/**
 * The phone half of the handoff.
 *
 * `capture="environment"` is what makes this worth building: on a phone it opens the rear camera straight into the native recorder, and hands back the platform's own format – an .mp4 on iOS, which is the one format everything plays. A MediaRecorder implementation here would be more code, worse on iOS, and would produce .webm that a chunk of the audience cannot watch.
 *
 * On a desktop browser the same input degrades to an ordinary file picker, which is a perfectly good fallback.
 *
 * Drawn in the platform kit, like the page that mounts it: the hand face on the asides, a real bordered field, the violet committing action and the teal meter are the same furniture a participant meets on the trail.
 */
export function HandoffUploader({ token }: Readonly<{ token: string }>) {
	const fileRef = useRef<HTMLInputElement>(null)
	const [state, setState] = useState<"idle" | "uploading" | "done">("idle")
	const [error, setError] = useState<string | null>(null)
	const [fileName, setFileName] = useState<string | null>(null)
	// Fraction sent. The phone is where the wait is longest, so it shows here.
	const [progress, setProgress] = useState(0)

	async function submit(e: React.SubmitEvent) {
		e.preventDefault()
		setError(null)

		const file = fileRef.current?.files?.[0]
		if (!file) {
			setError("Record or choose a video first.")
			return
		}
		if (!isVideoFile(file)) {
			setError(VIDEO_TYPE_MESSAGE)
			return
		}

		setState("uploading")
		setProgress(0)
		try {
			await uploadHandoffFile(token, file, setProgress)
			setState("done")
		} catch (err) {
			setError(err instanceof Error ? err.message : "Upload failed")
			setState("idle")
		}
	}

	if (state === "done")
		return (
			<p
				className="rounded-xl border-2 border-teal bg-mint/50 px-4 py-3 text-[0.92rem] leading-snug text-teal-ink"
				role="status"
			>
				Sent. Go back to your computer to finish the post. You can close this.
			</p>
		)

	return (
		<form className="grid gap-4" onSubmit={submit}>
			{error ? (
				<p
					className="rounded-xl border-2 border-coral bg-coral/10 px-4 py-3 text-[0.92rem] leading-snug font-semibold text-coral-dark"
					role="alert"
				>
					{error}
				</p>
			) : null}

			<Field hint="Tap to record, or pick one you already have." id="handoff-video" label="Video">
				<TextInput
					accept={VIDEO_ACCEPT}
					capture="environment"
					disabled={state === "uploading"}
					id="handoff-video"
					onChange={e => setFileName(e.target.files?.[0]?.name ?? null)}
					ref={fileRef}
					type="file"
				/>
			</Field>

			{fileName ? <p className="hand text-[0.84rem] text-navy-soft">{fileName}</p> : null}

			{state === "uploading" ? (
				<div className="grid gap-1.5">
					<Meter
						label={progress < 1 ? `Sending… ${Math.round(progress * 100)}%` : "Saving it…"}
						max={1}
						tone="teal"
						value={progress}
					/>
					<p className="hand text-[0.84rem] text-navy-soft">
						{progress < 1 ? "Keep this page open until it finishes." : "Sent. Saving it on the server…"}
					</p>
				</div>
			) : null}

			<div>
				<Button disabled={state === "uploading"} full size="lg" type="submit">
					{state === "uploading" ? "Sending…" : "Send to my computer"}
				</Button>
			</div>

			<p className="hand text-[0.84rem] text-navy-soft">This link works once, and only for the next few minutes.</p>
		</form>
	)
}
