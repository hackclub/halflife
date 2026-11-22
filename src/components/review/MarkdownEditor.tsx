"use client"

import DOMPurify from "dompurify"
import { marked } from "marked"
import { type ClipboardEvent, useEffect, useMemo, useRef, useState } from "react"
import { Icon, type IconName } from "@/components/review/ui"
import { uploadFile } from "@/lib/use-handoff"

/**
 * Fabricate's write/preview Markdown editor, for the message a reviewer sends the maker.
 *
 * One change from Fabricate: the preview renders in the browser rather than through a server endpoint. A pasted image goes to the bucket under the reviewer's own prefix, the same way a journal picture does, and lands in the note as a Markdown image. The flavour is plain Markdown because the note lands on the project page and in the maker's DM, not in a Slack thread.
 */

interface Tool {
	after?: string
	before: string
	icon?: IconName
	italic?: boolean
	label?: string
	line?: boolean
	title: string
}

const TOOLS: readonly Tool[] = Object.freeze([
	{ after: "**", before: "**", label: "B", title: "Bold" },
	{ after: "_", before: "_", italic: true, label: "I", title: "Italic" },
	{ before: "> ", icon: "quote", line: true, title: "Quote" },
	{ after: "`", before: "`", icon: "code", title: "Code" },
	{ after: "](https://)", before: "[", icon: "link", title: "Link" },
	{ before: "- ", icon: "list", line: true, title: "Bullet list" },
	{ before: "1. ", icon: "list-ordered", line: true, title: "Numbered list" },
])

const SYNTAX_HELP =
	"https://docs.github.com/github/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax"

const previewHtml = (source: string): string =>
	DOMPurify.sanitize(marked.parse(source, { async: false, breaks: true, gfm: true }), { USE_PROFILES: { html: true } })

export function MarkdownEditor({
	id,
	label,
	onChange,
	onUploadingChange,
	placeholder,
	value,
}: {
	id: string
	label?: string
	onChange(value: string): void
	/** Whether a pasted image is still on its way, so the form can hold its send until the placeholder is a real link. */
	onUploadingChange?(uploading: boolean): void
	placeholder?: string
	value: string
}) {
	const textarea = useRef<HTMLTextAreaElement>(null)
	const [mode, setMode] = useState<"write" | "preview">("write")
	const html = useMemo(() => (mode === "preview" ? previewHtml(value) : ""), [mode, value])
	const [uploading, setUploading] = useState(0)
	const inFlight = useRef(0)
	const [uploadError, setUploadError] = useState<string | null>(null)
	const pasted = useRef(0)
	// An upload finishes after the reviewer may have typed on, so its placeholder is swapped in the text as it stands then, not as it stood at paste. Written here as well as in `update`, so two uploads finishing together do not each start from the same text.
	const latest = useRef(value)
	useEffect(() => {
		latest.current = value
	}, [value])

	function update(next: string, cursor?: number): void {
		latest.current = next
		onChange(next)
		if (cursor === undefined) return
		requestAnimationFrame(() => {
			textarea.current?.focus()
			textarea.current?.setSelectionRange(cursor, cursor)
		})
	}

	function apply(tool: Tool): void {
		const el = textarea.current
		if (!el) return
		const start = el.selectionStart
		const end = el.selectionEnd
		if (tool.line) {
			const lineStart = value.lastIndexOf("\n", start - 1) + 1
			update(value.slice(0, lineStart) + tool.before + value.slice(lineStart), end + tool.before.length)
			return
		}
		const selected = value.slice(start, end)
		const after = tool.after ?? ""
		update(
			value.slice(0, start) + tool.before + selected + after + value.slice(end),
			selected ? end + tool.before.length + after.length : start + tool.before.length,
		)
	}

	function swap(marker: string, next: string): void {
		const text = latest.current.replace(marker, next)
		latest.current = text
		onChange(text)
	}

	function track(delta: number): void {
		inFlight.current += delta
		setUploading(inFlight.current)
		onUploadingChange?.(inFlight.current > 0)
	}

	async function upload(file: File, marker: string): Promise<void> {
		track(1)
		try {
			// Clipboard pictures are all called "image.png" or have no name at all; the server checks the extension against the type, so name it after the type.
			const named = new File([file], `pasted.${file.type.slice("image/".length)}`, { type: file.type })
			const { url } = await uploadFile(named, "sessions")
			if (!url) throw new Error("The image uploaded but has no public link.")
			swap(marker, `![image](${url})`)
		} catch (err) {
			swap(marker, "")
			setUploadError(err instanceof Error ? err.message : "The image did not upload.")
		} finally {
			track(-1)
		}
	}

	function paste(e: ClipboardEvent<HTMLTextAreaElement>): void {
		const images = Array.from(e.clipboardData.files).filter(file => file.type.startsWith("image/"))
		if (images.length === 0) return
		e.preventDefault()
		const el = e.currentTarget
		const markers = images.map(() => {
			pasted.current += 1
			return `![Uploading image ${pasted.current}…]()`
		})
		const inserted = markers.join("\n")
		update(
			value.slice(0, el.selectionStart) + inserted + value.slice(el.selectionEnd),
			el.selectionStart + inserted.length,
		)
		setUploadError(null)
		for (const [n, file] of images.entries()) void upload(file, markers[n] ?? "")
	}

	return (
		<div className="mde">
			<div className="mde__bar">
				<div className="mde__tabs" role="tablist">
					<button
						aria-selected={mode === "write"}
						className={mode === "write" ? "mde__tab is-active" : "mde__tab"}
						onClick={() => setMode("write")}
						role="tab"
						type="button"
					>
						Write
					</button>
					<button
						aria-selected={mode === "preview"}
						className={mode === "preview" ? "mde__tab is-active" : "mde__tab"}
						onClick={() => setMode("preview")}
						role="tab"
						type="button"
					>
						Preview
					</button>
				</div>
				{mode === "write" ? (
					<div className="mde__tools">
						{TOOLS.map(tool => (
							<button
								aria-label={tool.title}
								className={tool.italic ? "mde__tool mde__tool--italic" : "mde__tool"}
								key={tool.title}
								onClick={() => apply(tool)}
								title={tool.title}
								type="button"
							>
								{tool.icon ? <Icon name={tool.icon} /> : tool.label}
							</button>
						))}
					</div>
				) : null}
			</div>
			{mode === "write" ? (
				<textarea
					aria-label={label}
					className="mde__text"
					id={id}
					onChange={e => update(e.target.value)}
					onPaste={paste}
					placeholder={placeholder}
					ref={textarea}
					value={value}
				/>
			) : (
				<div className="mde__preview user-md">
					{html ? (
						<div dangerouslySetInnerHTML={{ __html: html }} />
					) : (
						<p className="field__hint">Nothing to preview yet.</p>
					)}
				</div>
			)}
			<div className="mde__foot">
				{uploading > 0 ? (
					<span className="field__hint">Uploading image…</span>
				) : uploadError ? (
					<span className="field__hint" role="alert">
						{uploadError}
					</span>
				) : (
					<span className="field__hint">Paste an image to attach it.</span>
				)}
				<a
					aria-label="Markdown syntax reference"
					className="mde__help"
					href={SYNTAX_HELP}
					rel="noreferrer"
					target="_blank"
					title="Markdown syntax reference"
				>
					<span className="visually-hidden">Markdown syntax reference</span>
					<svg aria-hidden="true" className="mde__mark" viewBox="0 0 208 128">
						<rect fill="none" height="118" stroke="currentColor" strokeWidth="10" width="198" x="5" y="5" />
						<path
							d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0l-30-33h20V30h20v35h20z"
							fill="currentColor"
						/>
					</svg>
				</a>
			</div>
		</div>
	)
}
