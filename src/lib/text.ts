/**
 * Text shaping shared by the surfaces that show an excerpt.
 */

/** One line, cut to `max` characters with an ellipsis. */
export function preview(text: string, max = 90): string {
	const flat = text.replaceAll(/\s+/g, " ").trim()
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * A Prisma 7 `contains` filter as a Prisma 8 `ilike` pattern.
 *
 * Prisma 7 escaped the LIKE wildcards in the search text; Prisma 8 takes the pattern as written, so a `%` or `_` in a name would otherwise match anything. Backslash is PostgreSQL's default LIKE escape.
 */
export function containsPattern(value: string): string {
	return `%${value.replace(/[\\%_]/g, "\\$&")}%`
}
