/**
 * Text shaping shared by the surfaces that show an excerpt.
 */

/** One line, cut to `max` characters with an ellipsis. */
export function preview(text: string, max = 90): string {
	const flat = text.replaceAll(/\s+/g, " ").trim()
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
