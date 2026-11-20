import { sanitize as domPurifySanitize } from "isomorphic-dompurify"

/**
 * Zod validates shape; these validate content. They are not substitutes for each other, and both run on every plain-text field before it is persisted.
 *
 * Journal entries are the exception: they are Markdown, stored as typed, and made safe where they are rendered – as React elements on the platform (components/platform/Markdown), through DOMPurify on the review screen (lib/review-platform/markdown), and through `sanitize` on the way to Ari. Escaping them on the way in broke the Markdown itself: a quote stopped being a quote and code showed "&lt;".
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

export function sanitizeOptional(input: string | null | undefined): string | null {
	if (input === null || input === undefined) return null
	const cleaned = sanitize(input)
	return cleaned.length > 0 ? cleaned : null
}
