"use client"

import { useRef, useState } from "react"
import { IconUpload, IconX } from "@/components/platform/icons"
import { UploadProgress } from "@/components/platform/UploadProgress"
import { Button } from "@/components/platform/ui"
import { uploadFile } from "@/lib/use-handoff"

const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif"

export interface UploadedImage {
	objectKey: string
	/** A local preview, so the thumbnail shows before the bucket serves it. */
	previewUrl: string
}

/**
 * Screenshots picked from this machine — several at once, and more later.
 *
 * Only a file picker: this is evidence that already exists on the screen it
 * was taken on, so there is nothing to record and no phone to hand off to.
 * Each file uploads on its own, so one that fails says so without losing the
 * others, and every one can be taken out again before the sheet is handed in.
 */
export function ImageUploads({
	images,
	onChange,
	folder,
	max,
	label,
}: {
	images: UploadedImage[]
	onChange: (next: UploadedImage[]) => void
	folder: string
	/** The server takes at most this many attachments with a submission. */
	max: number
	/** What the pictures are, for the thumbnails' alt text. */
	label: string
}) {
	const input = useRef<HTMLInputElement>(null)
	// One row per file still on its way up, in the order they were picked.
	const [pending, setPending] = useState<{ id: string; name: string; progress: number | null }[]>([])
	const busy = pending.length
	const [errors, setErrors] = useState<string[]>([])
	// The newest list, for uploads that finish after another has changed it.
	const latest = useRef(images)
	latest.current = images

	const room = max - images.length

	async function pick(files: FileList | null) {
		if (!files?.length) return
		const chosen = Array.from(files)
		const taken = chosen.slice(0, Math.max(0, room))
		const problems: string[] = []
		if (chosen.length > taken.length) {
			problems.push(`Only ${max} screenshots fit, so ${chosen.length - taken.length} were left out.`)
		}
		setErrors(problems)
		const batch = taken.map((file) => ({ file, id: crypto.randomUUID() }))
		setPending((p) => [...p, ...batch.map(({ file, id }) => ({ id, name: file.name, progress: null }))])

		await Promise.all(
			batch.map(async ({ file, id }) => {
				try {
					const { objectKey } = await uploadFile(file, folder, (progress) =>
						setPending((p) => p.map((row) => (row.id === id ? { ...row, progress } : row))),
					)
					// Uploads are named after their bytes, so re-picking a picture
					// already on the list hands back the key it already has. Adding it
					// again would put two thumbnails on one object and make removing
					// either remove both.
					if (latest.current.some((img) => img.objectKey === objectKey)) return
					const next = [...latest.current, { objectKey, previewUrl: URL.createObjectURL(file) }]
					latest.current = next
					onChange(next)
				} catch (err) {
					setErrors((e) => [...e, `${file.name}: ${err instanceof Error ? err.message : "did not upload"}`])
				} finally {
					setPending((p) => p.filter((row) => row.id !== id))
				}
			}),
		)
		if (input.current) input.current.value = ""
	}

	function remove(key: string) {
		const target = images.find((i) => i.objectKey === key)
		if (target) URL.revokeObjectURL(target.previewUrl)
		onChange(images.filter((i) => i.objectKey !== key))
	}

	return (
		<div className="grid gap-3">
			{images.length > 0 && (
				<ul className="flex flex-wrap gap-2.5" aria-label={`${label}s`}>
					{images.map((img, i) => (
						<li key={img.objectKey} className="relative">
							{/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview */}
							<img
								src={img.previewUrl}
								alt={`${label} ${i + 1}`}
								className="size-24 rounded-xl border-2 border-line bg-white object-cover"
							/>
							<button
								type="button"
								onClick={() => remove(img.objectKey)}
								aria-label={`Remove ${label.toLowerCase()} ${i + 1}`}
								className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full border-2 border-line bg-white text-navy-soft shadow-[0_2px_6px_rgb(0_0_0/0.15)] transition-colors hover:border-coral hover:text-coral-deep"
							>
								<IconX className="text-[0.75rem]" />
							</button>
						</li>
					))}
				</ul>
			)}

			{pending.length > 0 && (
				<ul className="grid max-w-[420px] gap-2.5" aria-label="Uploading">
					{pending.map((row) => (
						<li key={row.id}>
							<UploadProgress name={row.name} progress={row.progress} />
						</li>
					))}
				</ul>
			)}

			<div className="flex flex-wrap items-center gap-3">
				<Button variant="outline" disabled={busy > 0 || room <= 0} onClick={() => input.current?.click()}>
					<IconUpload className="text-base" />
					{busy > 0 ? "Uploading…" : images.length > 0 ? "Add more files" : "Select files"}
				</Button>
				<span className="hand text-[0.8rem] text-navy-soft tabular-nums">
					{images.length > 0 ? `${images.length} of ${max} added` : `PNG, JPG, WebP or GIF · up to ${max}`}
				</span>
			</div>

			<input
				ref={input}
				type="file"
				accept={IMAGE_TYPES}
				multiple
				className="sr-only"
				tabIndex={-1}
				aria-hidden="true"
				onChange={(e) => void pick(e.target.files)}
			/>

			{errors.map((e) => (
				<p key={e} role="alert" className="text-[0.84rem] font-semibold text-coral-deep">
					{e}
				</p>
			))}
		</div>
	)
}
