import { type Dispatch, type DragEvent, type RefObject, type SetStateAction, useRef, useState } from "react"
import { MAX_SESSION_CONTENT } from "@/lib/schemas/session"
import {
	altFor,
	clampToContentLimit,
	droppedImages,
	type ImageSource,
	storeImage,
	withoutPlaceholder,
} from "./checkpoint-shared"

interface DragHandlers {
	onDragEnter(event: DragEvent<HTMLElement>): void
	onDragLeave(event: DragEvent<HTMLElement>): void
	onDragOver(event: DragEvent<HTMLElement>): void
	onDrop(event: DragEvent<HTMLElement>): void
}

export interface JournalImages {
	addJournalImages(sources: Iterable<ImageSource>): Promise<void>
	dragging: boolean
	dragHandlers: DragHandlers
	entry: RefObject<HTMLTextAreaElement | null>
	imageError: string | null
	uploading: number
}

/**
 * Pictures in the journal entry: picked, dropped or pasted, all landing in the text where the cursor is.
 *
 * Each goes in first as a placeholder, `![Uploading name…](uploading:n)`, which no renderer or image count accepts, and is swapped for its CDN link once the upload lands; a failed one is taken back out. One at a time, because uploads are rate-limited per account.
 */
export function useJournalImages({
	body,
	setBody,
}: {
	body: string
	setBody: Dispatch<SetStateAction<string>>
}): JournalImages {
	const entry = useRef<HTMLTextAreaElement>(null)
	// Images still on their way up. Each one holds a placeholder in the entry until its link comes back, and Finish waits for all of them.
	const [uploading, setUploading] = useState(0)
	const [imageError, setImageError] = useState<string | null>(null)
	// Files being dragged over the sheet. Counted, because every child the drag crosses fires its own enter and leave.
	const [dragging, setDragging] = useState(false)
	const dragDepth = useRef(0)
	const placeholderSeq = useRef(0)

	async function addJournalImages(sources: Iterable<ImageSource>) {
		const all = Array.from(sources)
		const images = all.filter(s => !(s instanceof File) || s.type.startsWith("image/"))
		const notices: string[] = []
		if (images.length < all.length) notices.push("Only images can go in an entry, so the rest were left out.")

		// Each image a paragraph of its own, wherever in the text it lands.
		const at = entry.current?.selectionEnd ?? body.length
		const before = body.slice(0, at)
		const after = body.slice(at)
		const lead = !before.trim() || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
		const trail = !after || after.startsWith("\n") ? "" : "\n\n"

		// As many as fit, in the order they were given. A picture costs more characters once its link is back than while it is still uploading, so this is the first of two asks about room, not the last.
		const items: { source: ImageSource; alt: string; placeholder: string }[] = []
		let block = ""
		for (const source of images) {
			const alt = altFor(source)
			placeholderSeq.current += 1
			const placeholder = `![Uploading ${alt}…](uploading:${placeholderSeq.current})`
			const piece = items.length === 0 ? lead + placeholder : `\n\n${placeholder}`
			if (before.length + (block + piece).length + trail.length + after.length > MAX_SESSION_CONTENT) break
			block += piece
			items.push({ alt, placeholder, source })
		}
		const short = images.length - items.length
		if (short > 0)
			notices.push(`This entry is full, so ${short === 1 ? "one image was" : `${short} images were`} left out.`)
		setImageError(notices.length > 0 ? notices.join(" ") : null)
		if (items.length === 0) return

		setBody(clampToContentLimit(before + block + trail + after))
		requestAnimationFrame(() => {
			const caret = before.length + block.length
			entry.current?.setSelectionRange(caret, caret)
		})

		setUploading(n => n + items.length)
		for (const item of items)
			try {
				const { url } = await storeImage(item.source)
				if (!url) throw new Error("Image uploads need a public URL before they can be added here")
				const markdown = `![${item.alt}](${url})`
				// The second ask about room. A picture is left out whole rather than the entry cut short – the tail of an entry is somebody's writing, and half an image reads worse than none of it.
				if (!roomFor(item.placeholder, markdown)) {
					swapPlaceholder(item.placeholder, null)
					setImageError(`This entry is full, so "${item.alt}" was left out.`)
					continue
				}
				swapPlaceholder(item.placeholder, markdown)
			} catch (err) {
				swapPlaceholder(item.placeholder, null)
				setImageError(err instanceof Error ? err.message : "The image did not upload")
			} finally {
				setUploading(n => n - 1)
			}
	}

	/**
	 * Whether `markdown` still fits once it stands in for `placeholder`.
	 *
	 * Read off the box rather than `body`, which is the render this handler was made in and has not moved since: the uploads run one at a time, so the box has caught up by the time a link lands and `body` has not.
	 */
	function roomFor(placeholder: string, markdown: string): boolean {
		const current = entry.current?.value ?? body
		return current.length - placeholder.length + markdown.length <= MAX_SESSION_CONTENT
	}

	/**
	 * Replace a placeholder with its link, or take it out (`null`), without moving the caret of someone who kept typing while it uploaded: setting a textarea's value sends the caret to the end, so it is put back, shifted by however much the text before it grew or shrank.
	 */
	function swapPlaceholder(placeholder: string, replacement: string | null) {
		const el = entry.current
		const keep =
			el && document.activeElement === el
				? { at: el.value.indexOf(placeholder), end: el.selectionEnd, length: el.value.length, start: el.selectionStart }
				: null
		setBody(current => {
			const next =
				replacement === null ? withoutPlaceholder(current, placeholder) : current.replace(placeholder, replacement)
			// The backstop under `roomFor`: should a link land against a box that moved underneath it, the entry is still not left longer than the server will take.
			return clampToContentLimit(next)
		})
		if (!keep || keep.at < 0) return
		requestAnimationFrame(() => {
			const box = entry.current
			if (!box) return
			const delta = box.value.length - keep.length
			const move = (p: number) => (p > keep.at ? p + delta : p)
			box.setSelectionRange(move(keep.start), move(keep.end))
		})
	}

	// A drag that could be carrying an image: files, or a picture dragged off another page, which comes as markup and an address rather than a file. Dragging a selection around the entry is plain text, and not ours.
	const mightBeImage = (e: DragEvent) =>
		["Files", "text/html", "text/uri-list"].some(t => e.dataTransfer.types.includes(t))

	return {
		addJournalImages,
		dragging,
		dragHandlers: {
			onDragEnter: e => {
				if (!mightBeImage(e)) return
				e.preventDefault()
				dragDepth.current += 1
				setDragging(true)
			},
			onDragLeave: e => {
				if (!mightBeImage(e)) return
				dragDepth.current = Math.max(0, dragDepth.current - 1)
				if (dragDepth.current === 0) setDragging(false)
			},
			onDragOver: e => {
				if (mightBeImage(e)) e.preventDefault()
			},
			onDrop: e => {
				dragDepth.current = 0
				setDragging(false)
				const found = droppedImages(e.dataTransfer)
				const files = Array.from(e.dataTransfer.files)
				// A link or some text is not an image: left to the textarea, which drops it in as text. Files are always caught, images or not, so a PDF let go over the sheet cannot open in the tab and take the unsaved entry with it.
				if (found.length === 0 && files.length === 0) return
				e.preventDefault()
				void addJournalImages(found.length > 0 ? found : files)
			},
		},
		entry,
		imageError,
		uploading,
	}
}
