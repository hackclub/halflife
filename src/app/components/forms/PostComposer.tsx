"use client"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { PhoneHandoff } from "@/app/components/forms/PhoneHandoff"
import { Button, Callout, Field, Panel } from "@/app/components/ui"
import { isVideoFile, VIDEO_ACCEPT, VIDEO_TYPE_MESSAGE } from "@/lib/uploads/video-accept"
import { uploadFile } from "@/lib/use-handoff"

interface ApiError {
	error?: { message?: string }
}

export interface ComposerProject {
	id: string
	label: string
}

const KIND_OPTIONS = [
	{ label: "Just posting", value: "FREEFORM" },
	{ label: "Idea reel", value: "IDEA" },
	{ label: "Progress reel", value: "PROGRESS" },
	{ label: "Submission reel", value: "SUBMISSION" },
] as const

/**
 * Post a reel.
 *
 * Two requests, deliberately: the file goes to /api/upload and comes back as an object key, then /api/posts records the reel. Keeping them apart means a failed post does not have to re-send the video, and the upload route stays the one place that talks to R2.
 *
 * The key is not trusted on the way back through: the server checks it belongs to the poster before it will attach it to anything.
 */
export function PostComposer({
	projects,
	canAnnounce,
}: Readonly<{ projects: readonly ComposerProject[]; canAnnounce: boolean }>) {
	const router = useRouter()
	const fileRef = useRef<HTMLInputElement>(null)
	const [caption, setCaption] = useState("")
	const [kind, setKind] = useState<string>("FREEFORM")
	const [projectId, setProjectId] = useState<string>("")
	const [stage, setStage] = useState<"idle" | "uploading" | "posting">("idle")
	const [progress, setProgress] = useState(0)
	const [error, setError] = useState<string | null>(null)
	/**
	 * An object key that arrived from a phone. When set it stands in for the file input entirely – the bytes are already in R2, so there is nothing left to upload.
	 */
	const [handoffKey, setHandoffKey] = useState<string | null>(null)

	const busy = stage !== "idle"

	async function submit(e: React.SubmitEvent) {
		e.preventDefault()
		setError(null)

		const file = fileRef.current?.files?.[0]
		if (!file && !handoffKey) {
			setError("Record or pick a video first.")
			return
		}
		if (file && !isVideoFile(file)) {
			setError(VIDEO_TYPE_MESSAGE)
			return
		}

		try {
			let objectKey = handoffKey

			// A phone upload is already in the bucket; only a locally chosen file still has to be sent.
			if (!objectKey && file) {
				setStage("uploading")
				setProgress(0)
				;({ objectKey } = await uploadFile(file, "posts", setProgress))
			}

			if (!objectKey) {
				setError("Record or pick a video first.")
				return
			}

			setStage("posting")
			const created = await fetch("/api/posts", {
				body: JSON.stringify({
					caption,
					kind,
					objectKey,
					themeProjectId: projectId === "" ? null : projectId,
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			})
			if (!created.ok) {
				const payload = (await created.json().catch(() => ({}))) as ApiError
				setError(payload.error?.message ?? `Could not post (${created.status})`)
				return
			}

			setCaption("")
			setProjectId("")
			setHandoffKey(null)
			if (fileRef.current) fileRef.current.value = ""
			router.refresh()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong")
		} finally {
			setStage("idle")
		}
	}

	return (
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{error ? <Callout tone="danger">{error}</Callout> : null}

			<Panel title="Record on your phone">
				<PhoneHandoff onReady={setHandoffKey} />
			</Panel>

			{handoffKey ? (
				<Callout>
					Using the video from your phone.{" "}
					<button className="hl-btn" onClick={() => setHandoffKey(null)} type="button">
						Use a file instead
					</button>
				</Callout>
			) : (
				<Field hint="mp4, webm or mov. Or record on your phone above." label="Video">
					<input accept={VIDEO_ACCEPT} className="hl-input" disabled={busy} ref={fileRef} type="file" />
				</Field>
			)}

			<Field label="Caption">
				<textarea
					className="hl-textarea"
					disabled={busy}
					maxLength={2000}
					onChange={e => setCaption(e.target.value)}
					value={caption}
				/>
			</Field>

			<Field label="What kind of reel is this?">
				<select className="hl-select" disabled={busy} onChange={e => setKind(e.target.value)} value={kind}>
					{KIND_OPTIONS.map(option => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
					{canAnnounce ? <option value="ANNOUNCEMENT">Announcement from HQ</option> : null}
				</select>
			</Field>

			<Field hint="Optional. Idea and progress reels usually are." label="About a project?">
				<select className="hl-select" disabled={busy} onChange={e => setProjectId(e.target.value)} value={projectId}>
					<option value="">Not about a project</option>
					{projects.map(project => (
						<option key={project.id} value={project.id}>
							{project.label}
						</option>
					))}
				</select>
			</Field>

			{stage === "uploading" ? (
				<div>
					<progress
						aria-label="Uploading the video"
						max={1}
						style={{ height: "0.6rem", width: "100%" }}
						value={progress < 1 ? progress : undefined}
					/>
					<p className="hl-hint">{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Sent. Storing it…"}</p>
				</div>
			) : null}

			<div>
				<Button disabled={busy} type="submit" variant="primary">
					{stage === "uploading" ? "Uploading…" : stage === "posting" ? "Posting…" : "Post reel"}
				</Button>
			</div>
		</form>
	)
}
