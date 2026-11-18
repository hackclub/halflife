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
		return
	}

	// Every URL-bearing attribute a sanitised subtree can load, not just <img src>. A repo's Markdown can carry
	// <video src>, <source src>, <audio src>, <track src> and poster=, and each of those is a credentialed GET the
	// reviewer's browser makes on the author's behalf – including at our own routes, which is why safeSrc refuses
	// them. srcset is a list, so a bad candidate is dropped rather than taking the whole attribute with it.
	for (const attribute of ["src", "poster"]) {
		const value = node.getAttribute(attribute)
		if (value === null) continue
		const safe = safeSrc(value)
		if (safe) node.setAttribute(attribute, safe)
		else node.removeAttribute(attribute)
	}

	const srcset = node.getAttribute("srcset")
	if (typeof srcset === "string" && srcset.length > 0) {
		const kept = srcset.split(",").flatMap(candidate => {
			const [url, ...descriptor] = candidate.trim().split(/\s+/)
			const safe = url ? safeSrc(url) : undefined
			return safe ? [[safe, ...descriptor].join(" ")] : []
		})
		if (kept.length > 0) node.setAttribute("srcset", kept.join(", "))
		else node.removeAttribute("srcset")
	}

	if (node.tagName === "IMG") node.setAttribute("loading", "lazy")
})

export function renderReviewMarkdown(source: string): string {
	if (!source.trim()) return ""
	const html = marked.parse(source, { async: false, breaks: true, gfm: true })
	return purifier.sanitize(html, { FORBID_TAGS: ["style", "form", "input", "button"], USE_PROFILES: { html: true } })
}
