/**
 * The parsing half of the journal Markdown: the guards, the counts and the excerpt.
 *
 * Kept out of `components/platform/Markdown.tsx` because it has no JSX in it and is read from the server (`lib/thumbnail.ts` picks a project's cover out of a journal entry). The renderer imports the same guards and the token pattern, so what counts as an image and what renders as one cannot drift apart.
 */

/** Links have to survive being typed by hand without becoming an attack. */
export function safeHref(raw: string): string | undefined {
	const href = raw.trim()
	if (/^(https?:|mailto:)/i.test(href)) return href
	if (href.startsWith("/") || href.startsWith("#")) return href
	return undefined
}

/** The same guard for images, plus data URIs so a paste can be previewed. */
export function safeSrc(raw: string): string | undefined {
	const src = raw.trim()
	if (/^https?:/i.test(src)) return src
	if (/^data:image\//i.test(src)) return src
	// No site-relative paths: uploaded images are absolute R2 URLs, so a relative `![x](/signed-out)` can only be aimed at our own routes – and loading one as an image fires a credentialed GET at it (which is how one logged out every viewer of Explore).
	return undefined
}

/**
 * What makes two image URLs the same picture.
 *
 * Uploads are named after the SHA-256 of their bytes (`contentHash` in `lib/uploads/r2`), so one picture is always one filename and two URLs for it differ at most in their extension. Comparing whole URLs would still count the same screenshot saved once as `a.png` and once as `a.jpg` as two. Any URL that does not carry such a name – an outside host, a data URI – is its own identity.
 */
function imageIdentity(src: string): string {
	if (src.startsWith("data:")) return src
	const path = src.split(/[?#]/, 1)[0] ?? ""
	const name = path.slice(path.lastIndexOf("/") + 1)
	const hash = /^([0-9a-f]{64})(?:\.[^.]*)?$/i.exec(name)?.[1]
	return hash ? hash.toLowerCase() : src
}

/**
 * How many images an entry carries. The session's evidence rule counts these rather than a separate attachment list: the picture belongs in the sentence that explains it, so the entry is the only place it can live.
 */
export function countImages(source: string): number {
	// Only ones that will actually render: counting by syntax alone would let `![x](javascript:)` three times clear the bar with nothing to show. And only once each – the same picture pasted again is the same picture, so a maker cannot clear the evidence bar by repeating one image down the entry.
	const seen = new Set<string>()
	for (const match of source.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
		const [, raw] = match
		if (raw === undefined) continue
		const src = safeSrc(raw)
		if (src !== undefined) seen.add(imageIdentity(src))
	}
	return seen.size
}

/**
 * The images an entry shows, in the order it shows them. Pasted data URIs are left out: they render inline, but as a thumbnail URL they would ship a whole picture inside every payload that lists the project.
 */
export function imageSources(source: string): string[] {
	const out: string[] = []
	for (const m of source.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
		const src = m[1] !== undefined ? safeSrc(m[1]) : undefined
		if (src && !/^data:/i.test(src)) out.push(src)
	}
	return out
}

/**
 * The opening of an entry, cut to about `limit` characters of what it says.
 *
 * Cut as Markdown rather than as a string: slicing through `![a](url)` or `**bold**` would leave a half-token that renders as literal syntax, so tokens are kept whole and the cut falls on a word boundary between them. Images cost nothing against the limit, but only the first one is kept – an excerpt that is mostly photographs is not an excerpt.
 */
export function excerpt(source: string, limit: number): { text: string; cut: boolean } {
	const text = source.replaceAll("\r\n", "\n")
	let used = 0
	let images = 0
	let last = 0
	// Where the excerpt would end if it stopped right here.
	let end = text.length
	let cut = false

	const spend = (from: number, to: number): boolean => {
		const plain = text.slice(from, to)
		if (used + plain.length <= limit) {
			used += plain.length
			return false
		}
		const room = limit - used
		const space = plain.lastIndexOf(" ", room)
		end = from + (space > room / 2 ? space : room)
		return true
	}

	INLINE.lastIndex = 0
	for (let m = INLINE.exec(text); m !== null; m = INLINE.exec(text)) {
		if (spend(last, m.index)) {
			cut = true
			break
		}
		if (m[2] !== undefined) {
			images += 1
			if (images > 1) {
				end = m.index
				cut = true
				break
			}
		} else {
			const shown = (m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? m[8] ?? "").length
			if (used + shown > limit) {
				end = m.index
				cut = true
				break
			}
			used += shown
		}
		last = m.index + m[0].length
	}
	if (!cut && spend(last, text.length)) cut = true

	return cut ? { cut, text: `${text.slice(0, end).trimEnd()}…` } : { cut, text }
}

/**
 * How much an entry actually says, for the 200-character floor.
 *
 * Images are the evidence half of an entry and are counted by `countImages`; counting their markdown here too would let a pasted CDN URL – often a hundred characters on its own – write most of the minimum. So every image, alt text included, comes out before the length is taken: alt text is not prose, and leaving it in would only move the padding into the brackets.
 */
export function proseLength(source: string): number {
	return source.replaceAll(/!\[[^\]]*\]\([^)]*\)/g, "").trim().length
}

/**
 * Images lead the alternation. `[alt](src)` would otherwise match the link form first and leave a stray "!" sitting in front of it.
 *
 * Groups: 1 alt, 2 src, 3 code, 4 **, 5 __, 6 *, 7 _, 8 link text, 9 href.
 *
 * Shared with the renderer rather than copied, so a token the counter understands is always a token the renderer does.
 */
export const INLINE =
	/!\[([^\]]*)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g
