import { sanitize as domPurifySanitize } from "isomorphic-dompurify"

/**
 * Zod validates shape; these validate content. They are not substitutes for each other, and both run on every free-text field before it is persisted.
 */

/**
 * Strips all markup. For anything stored and rendered as plain text.
 *
 * The result is the text itself, not HTML: DOMPurify's serialised output escapes `&`, `<` and `>`, and every reader of these fields treats them as text – React escapes them again, Airtable and Loops store them as typed, Slack escapes them on the way out (see `escapeSlackText`). Stored escaped, a maker's "<3" showed on their own page as "&lt;3". Taking the fragment's text keeps the stripping and drops the escaping, and it also decodes text that was stored escaped before this changed, which is what the repair script relies on (scripts/repair-escaped-text.ts).
 */
export function sanitize(input: string): string {
	return (
		domPurifySanitize(input, { ALLOWED_ATTR: [], ALLOWED_TAGS: [], RETURN_DOM_FRAGMENT: true }).textContent ?? ""
	).trim()
}

/** Allows safe markup. Only for journal content, which renders as rich text. */
export function sanitizeHtml(input: string): string {
	return domPurifySanitize(input, {
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
