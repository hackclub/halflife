import "server-only"
import DOMPurify from "isomorphic-dompurify"
import { marked } from "marked"
import { safeHref, safeSrc } from "@/lib/markdown"

/**
 * A journal entry's Markdown as sanitised HTML, for the review screen's `.user-md` blocks.
 *
 * Rendered on the server so the reviewer's browser is handed markup DOMPurify has already cleaned. The same link and image guards as the trail's own renderer (`lib/markdown`) apply on top: a relative image would fire a credentialed GET at one of our own routes, so it is dropped rather than drawn.
 */
const purifier = DOMPurify

purifier.addHook("afterSanitizeAttributes", node => {
	if (node.tagName === "A") {
		const href = safeHref(node.getAttribute("href") ?? "")
		if (href) node.setAttribute("href", href)
		else node.removeAttribute("href")
		node.setAttribute("target", "_blank")
		node.setAttribute("rel", "noopener noreferrer")
	}
	if (node.tagName === "IMG") {
		const src = safeSrc(node.getAttribute("src") ?? "")
		if (src) node.setAttribute("src", src)
		else node.removeAttribute("src")
		node.setAttribute("loading", "lazy")
	}
})

export function renderReviewMarkdown(source: string): string {
	if (!source.trim()) return ""
	const html = marked.parse(source, { async: false, breaks: true, gfm: true })
	return purifier.sanitize(html, { FORBID_TAGS: ["style", "form", "input", "button"], USE_PROFILES: { html: true } })
}
