"use client"

import DOMPurify from "isomorphic-dompurify"
import { marked } from "marked"
import { useMemo, useRef, useState } from "react"
import { Icon, type IconName } from "@/components/review/ui"

/**
 * Fabricate's write/preview Markdown editor, for the message a reviewer sends the maker.
 *
 * Two changes from Fabricate: the preview renders in the browser rather than through a server endpoint, and there is no image paste – a review note carries words, and Half Life's uploads are scoped to a maker's own journal. The flavour is plain Markdown because the note lands on the project page and in the maker's DM, not in a Slack thread.
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
	placeholder,
	value,
}: {
	id: string
	label?: string
	onChange(value: string): void
	placeholder?: string
	value: string
}) {
	const textarea = useRef<HTMLTextAreaElement>(null)
	const [mode, setMode] = useState<"write" | "preview">("write")
	const html = useMemo(() => (mode === "preview" ? previewHtml(value) : ""), [mode, value])

	function update(next: string, cursor?: number): void {
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
