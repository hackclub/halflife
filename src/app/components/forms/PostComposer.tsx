"use client"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { PhoneHandoff } from "@/app/components/forms/PhoneHandoff"
import { Button, Callout, Field, Panel } from "@/app/components/ui"
import { postForm } from "@/lib/upload-progress"

type ApiError = {
	error?: { message?: string }
}

export type ComposerProject = {
	id: string
	label: string
}

const KIND_OPTIONS = [
	{ value: "FREEFORM", label: "Just posting" },
	{ value: "IDEA", label: "Idea reel" },
	{ value: "PROGRESS", label: "Progress reel" },
	{ value: "SUBMISSION", label: "Submission reel" },
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

	async function submit(e: React.FormEvent) {
		e.preventDefault()
		setError(null)

		const file = fileRef.current?.files?.[0]
		if (!file && !handoffKey) {
			setError("Record or pick a video first.")
			return
		}
		if (file && !file.type.startsWith("video/")) {
			setError("Choose a video file (MP4, WebM, or MOV).")
			return
		}

		try {
			let objectKey = handoffKey

			// A phone upload is already in the bucket; only a locally chosen file still has to be sent.
			if (!objectKey && file) {
				setStage("uploading")
				setProgress(0)
				const form = new FormData()
				form.append("file", file)
				form.append("folder", "posts")

				const uploaded = await postForm("/api/upload", form, setProgress)
				if (!uploaded.ok) {
					const payload = (uploaded.json ?? {}) as ApiError
					setError(payload.error?.message ?? `Upload failed (${uploaded.status})`)
					return
				}
				// No `data` envelope: ok() returns the payload itself, and only a failure is wrapped. See lib/api.ts.
				const data = uploaded.json as { objectKey: string }
				objectKey = data.objectKey
			}

			if (!objectKey) {
				setError("Record or pick a video first.")
				return
			}

			setStage("posting")
			const created = await fetch("/api/posts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					kind,
					caption,
					objectKey,
					themeProjectId: projectId === "" ? null : projectId,
				}),
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
		<form onSubmit={submit} className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}

			<Panel title="Record on your phone">
				<PhoneHandoff onReady={setHandoffKey} />
			</Panel>

			{handoffKey ? (
				<Callout>
					Using the video from your phone.{" "}
					<button type="button" className="hl-btn" onClick={() => setHandoffKey(null)}>
						Use a file instead
					</button>
				</Callout>
			) : (
				<Field label="Video" hint="mp4, webm or mov. Or record on your phone above.">
					<input ref={fileRef} className="hl-input" type="file" accept="video/*" disabled={busy} />
				</Field>
			)}

			<Field label="Caption">
				<textarea
					className="hl-textarea"
					value={caption}
					maxLength={2000}
					disabled={busy}
					onChange={(e) => setCaption(e.target.value)}
				/>
			</Field>

			<Field label="What kind of reel is this?">
				<select className="hl-select" value={kind} disabled={busy} onChange={(e) => setKind(e.target.value)}>
					{KIND_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
					{canAnnounce ? <option value="ANNOUNCEMENT">Announcement from HQ</option> : null}
				</select>
			</Field>

			<Field label="About a project?" hint="Optional. Idea and progress reels usually are.">
				<select className="hl-select" value={projectId} disabled={busy} onChange={(e) => setProjectId(e.target.value)}>
					<option value="">Not about a project</option>
					{projects.map((project) => (
						<option key={project.id} value={project.id}>
							{project.label}
						</option>
					))}
				</select>
			</Field>

			{stage === "uploading" ? (
				<div>
					<progress
						max={1}
						value={progress < 1 ? progress : undefined}
						aria-label="Uploading the video"
						style={{ width: "100%", height: "0.6rem" }}
					/>
					<p className="hl-hint">{progress < 1 ? `Uploading… ${Math.round(progress * 100)}%` : "Sent. Storing it…"}</p>
				</div>
			) : null}

			<div>
				<Button type="submit" variant="primary" disabled={busy}>
					{stage === "uploading" ? "Uploading…" : stage === "posting" ? "Posting…" : "Post reel"}
				</Button>
			</div>
		</form>
	)
}
