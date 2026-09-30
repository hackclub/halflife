import DOMPurify from "isomorphic-dompurify"

/**
 * Zod validates shape; these validate content. They are not substitutes for
 * each other, and both run on every free-text field before it is persisted.
 */

/** Strips all markup. For anything stored and rendered as plain text. */
export function sanitize(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).trim()
}

/** Allows safe markup. Only for journal content, which renders as rich text. */
export function sanitizeHtml(input: string): string {
  return DOMPurify.sanitize(input)
}

export function sanitizeOptional(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const cleaned = sanitize(input)
  return cleaned.length > 0 ? cleaned : null
}
