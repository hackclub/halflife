"use client"

import { useRef, useState } from "react"
import { WeekPainting } from "@/components/platform/art"
import { IconCamera } from "@/components/platform/icons"
import { ProjectThumb } from "@/components/platform/ProjectThumb"
import { UploadProgress } from "@/components/platform/UploadProgress"
import { Button } from "@/components/platform/ui"
import { useStore } from "@/lib/store"
import type { ProjectThumbnail } from "@/lib/thumbnail"
import { IMAGE_ACCEPT } from "@/lib/uploads/image-accept"
import { uploadFile } from "@/lib/use-handoff"

/**
 * The project's thumbnail – what its card and the review queue show.
 *
 * Until one is uploaded the newest picture in the journal stands in, and before there is one of those, the week's own scene on the week's colour, so an empty project still looks like the week it belongs to rather than a grey box. Changing it is one button on the image itself: pick a file, it uploads, the page re-reads.
 */
export function CoverImage({
	projectId,
	url,
	fallback,
	theme,
	accent,
	locked,
}: {
	projectId: string
	/** The one the maker chose. */
	url: string | null
	/** What stands in until they choose one: a journal image, then a reel frame. */
	fallback: ProjectThumbnail | null
	theme: string
	accent: string
	locked: string | null
}) {
	const shown: ProjectThumbnail | null = url ? { kind: "image", url } : fallback
	const { updateProject } = useStore()
	const input = useRef<HTMLInputElement>(null)
	const [busy, setBusy] = useState(false)
	// How much of a new thumbnail has gone up; null when none is uploading.
	const [progress, setProgress] = useState<number | null>(null)
	const [uploading, setUploading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function pick(file: File | undefined) {
		if (!file) return
		// The input's `accept` is advisory: a renamed file picked on purpose sails through it and fails confusingly at the upload.
		if (!file.type.startsWith("image/")) {
			setError("That file is not an image – pick a PNG or JPEG.")
			if (input.current) input.current.value = ""
			return
		}
		setBusy(true)
		setUploading(true)
		setProgress(null)
		setError(null)
		try {
			const { objectKey } = await uploadFile(file, "covers", setProgress)
			const refused = await updateProject(projectId, { coverImageKey: objectKey })
			if (refused) setError(refused)
		} catch (err) {
			setError((err as Error).message)
		} finally {
			setBusy(false)
			setUploading(false)
			if (input.current) input.current.value = ""
		}
	}

	async function clear() {
		setBusy(true)
		setError(null)
		const refused = await updateProject(projectId, { coverImageKey: null })
		if (refused) setError(refused)
		setBusy(false)
	}

	return (
		<div>
			<div
				className="relative grid aspect-21/9 place-items-center overflow-hidden rounded-2xl @3xl:aspect-4/3"
				style={{ background: shown ? "var(--color-navy)" : accent }}
			>
				{shown ? (
					<ProjectThumb className="absolute inset-0 size-full" thumb={shown} />
				) : (
					<WeekPainting
						alt=""
						className="sticker-shadow aspect-square h-[82%] max-w-full"
						sizes="(min-width: 768px) 360px, 50vw"
						theme={theme}
					/>
				)}
				{!url && fallback && (
					<div className="absolute inset-x-0 bottom-0 bg-navy/65 px-3 py-2">
						<p className="text-[0.74rem] font-semibold leading-snug text-white">
							No cover image set yet – this picture is a stand-in from your work.
						</p>
					</div>
				)}
				{/* The bar sits on the picture it is replacing, where the eye already
            is, on a veil dark enough to read over any thumbnail. */}
				{uploading && (
					<div className="absolute inset-0 grid items-end bg-navy/45 p-3">
						<div className="rounded-xl bg-white/95 px-3 py-2">
							<UploadProgress name="New cover image" progress={progress} />
						</div>
					</div>
				)}
				{busy && !uploading && (
					<span className="hand absolute inset-0 grid place-items-center bg-navy/55 text-[0.9rem] text-white">
						saving…
					</span>
				)}
			</div>

			{!locked && (
				<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
					<input
						accept={IMAGE_ACCEPT}
						aria-hidden="true"
						className="sr-only"
						onChange={e => pick(e.target.files?.[0])}
						ref={input}
						tabIndex={-1}
						type="file"
					/>
					<Button className="-ml-3.5" disabled={busy} onClick={() => input.current?.click()} size="sm" variant="ghost">
						<IconCamera className="text-base" /> {url ? "Change cover image" : "Add a cover image"}
					</Button>
					{url && (
						<button
							className="hand text-[0.8rem] text-navy-soft underline decoration-dashed underline-offset-4 hover:text-coral-deep"
							disabled={busy}
							onClick={() => clear()}
							type="button"
						>
							remove
						</button>
					)}
				</div>
			)}
			{!locked && (
				<p className="hand mt-1 text-[0.8rem] leading-snug text-navy-soft">
					Your cover has to be a photo or screenshot of the project itself – the first thing a reviewer sees, so not a
					logo or a stock photo.
				</p>
			)}
			{error && (
				<p className="mt-1 text-[0.8rem] font-semibold text-coral-deep" role="alert">
					{error}
				</p>
			)}
		</div>
	)
}
