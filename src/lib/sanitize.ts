import DOMPurify from "isomorphic-dompurify"

/**
 * Zod validates shape; these validate content. They are not substitutes for each other, and both run on every free-text field before it is persisted.
 */

/** Strips all markup. For anything stored and rendered as plain text. */
export function sanitize(input: string): string {
	return DOMPurify.sanitize(input, { ALLOWED_ATTR: [], ALLOWED_TAGS: [] }).trim()
}

/** Allows safe markup. Only for journal content, which renders as rich text. */
export function sanitizeHtml(input: string): string {
	return DOMPurify.sanitize(input, {
		ALLOW_DATA_ATTR: false,
		ALLOWED_ATTR: ["href", "title", "target", "rel"],
		ALLOWED_TAGS: ["b", "i", "em", "strong", "a", "p", "br", "ul", "ol", "li", "blockquote", "code", "pre"],
		FORBID_ATTR: ["style", "on*"],
	})
}

export function sanitizeOptional(input: string | null | undefined): string | null {
	if (input === null || input === undefined) return null
	const cleaned = sanitize(input)
	return cleaned.length > 0 ? cleaned : null
}
