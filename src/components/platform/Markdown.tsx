import type { ReactNode } from "react"
import { attrUrl } from "@/lib/attr-url"

/**
 * Enough Markdown for a journal entry, and deliberately no more: headings,
 * emphasis, code, links, images, lists, quotes and rules. Everything renders
 * as React elements rather than injected HTML, so an entry can never smuggle
 * markup into the page — which matters because every word of this is typed by
 * a maker and, on the Explore feed, read by everybody else.
 */

/** Links have to survive being typed by hand without becoming an attack. */
function safeHref(raw: string): string | undefined {
	const href = raw.trim()
	if (/^(https?:|mailto:)/i.test(href)) return href
	if (href.startsWith("/") || href.startsWith("#")) return href
	return undefined
}

/** The same guard for images, plus data URIs so a paste can be previewed. */
function safeSrc(raw: string): string | undefined {
	const src = raw.trim()
	if (/^https?:/i.test(src)) return src
	if (/^data:image\//i.test(src)) return src
	if (src.startsWith("/")) return src
	return undefined
}

/**
 * What makes two image URLs the same picture.
 *
 * Uploads are named after the SHA-256 of their bytes (`contentHash` in
 * `lib/uploads/r2`), so one picture is always one filename and two URLs for
 * it differ at most in their extension. Comparing whole URLs would still count
 * the same screenshot saved once as `a.png` and once as `a.jpg` as two. Any
 * URL that does not carry such a name — an outside host, a data URI — is its
 * own identity.
 */
function imageIdentity(src: string): string {
	if (src.startsWith("data:")) return src
	const path = src.split(/[?#]/, 1)[0] ?? ""
	const name = path.slice(path.lastIndexOf("/") + 1)
	const hash = /^([0-9a-f]{64})(?:\.[^.]*)?$/i.exec(name)?.[1]
	return hash ? hash.toLowerCase() : src
}

/**
 * How many images an entry carries. The session's evidence rule counts these
 * rather than a separate attachment list: the picture belongs in the sentence
 * that explains it, so the entry is the only place it can live.
 */
export function countImages(source: string): number {
	// Only ones that will actually render: counting by syntax alone would let
	// `![x](javascript:)` three times clear the bar with nothing to show. And
	// only once each — the same picture pasted again is the same picture, so a
	// maker cannot clear the evidence bar by repeating one image down the entry.
	const seen = new Set<string>()
	for (const match of source.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
		const raw = match[1]
		if (raw === undefined) continue
		const src = safeSrc(raw)
		if (src !== undefined) seen.add(imageIdentity(src))
	}
	return seen.size
}

/**
 * The images an entry shows, in the order it shows them. Pasted data URIs are
 * left out: they render inline, but as a thumbnail URL they would ship a whole
 * picture inside every payload that lists the project.
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
 * Cut as Markdown rather than as a string: slicing through `![a](url)` or
 * `**bold**` would leave a half-token that renders as literal syntax, so
 * tokens are kept whole and the cut falls on a word boundary between them.
 * Images cost nothing against the limit, but only the first one is kept — an
 * excerpt that is mostly photographs is not an excerpt.
 */
export function excerpt(source: string, limit: number): { text: string; cut: boolean } {
	const text = source.replace(/\r\n/g, "\n")
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

	return cut ? { text: `${text.slice(0, end).trimEnd()}…`, cut } : { text, cut }
}

/**
 * How much an entry actually says, for the 200-character floor.
 *
 * Images are the evidence half of an entry and are counted by `countImages`;
 * counting their markdown here too would let a pasted CDN URL — often a
 * hundred characters on its own — write most of the minimum. So every image,
 * alt text included, comes out before the length is taken: alt text is not
 * prose, and leaving it in would only move the padding into the brackets.
 */
export function proseLength(source: string): number {
	return source.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim().length
}

/**
 * Images lead the alternation. `[alt](src)` would otherwise match the link
 * form first and leave a stray "!" sitting in front of it.
 *
 * Groups: 1 alt, 2 src, 3 code, 4 **, 5 __, 6 *, 7 _, 8 link text, 9 href.
 */
const INLINE =
	/!\[([^\]]*)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g

function inline(text: string, key: string): ReactNode[] {
	const out: ReactNode[] = []
	let last = 0
	let n = 0
	INLINE.lastIndex = 0
	for (let m = INLINE.exec(text); m !== null; m = INLINE.exec(text)) {
		if (m.index > last) out.push(text.slice(last, m.index))
		const k = `${key}-${n}`
		n += 1

		if (m[2] !== undefined) {
			const src = safeSrc(m[2])
			out.push(
				src ? (
					// eslint-disable-next-line @next/next/no-img-element -- arbitrary remote source typed by the maker
					<img
						key={k}
						src={attrUrl(src)}
						alt={m[1]}
						loading="lazy"
						className="my-1 block max-w-full rounded-xl border-2 border-line"
					/>
				) : (
					<span key={k} className="hand text-navy-soft">
						{m[1] || "image"}
					</span>
				),
			)
		} else if (m[3] !== undefined) {
			out.push(
				<code key={k} className="rounded bg-violet-pale px-1 py-0.5 font-mono text-[0.88em] text-violet-deep">
					{m[3]}
				</code>,
			)
		} else if (m[4] !== undefined || m[5] !== undefined) {
			out.push(
				<strong key={k} className="font-extrabold text-navy">
					{m[4] ?? m[5]}
				</strong>,
			)
		} else if (m[6] !== undefined || m[7] !== undefined) {
			out.push(<em key={k}>{m[6] ?? m[7]}</em>)
		} else {
			const href = safeHref(m[9] ?? "")
			out.push(
				href ? (
					<a
						key={k}
						href={attrUrl(href)}
						target="_blank"
						rel="noreferrer"
						className="font-semibold text-sky-ink underline decoration-2 underline-offset-[3px] transition-colors hover:text-coral-deep hover:decoration-coral"
					>
						{m[8]}
					</a>
				) : (
					<span key={k}>{m[8]}</span>
				),
			)
		}
		last = m.index + m[0].length
	}
	if (last < text.length) out.push(text.slice(last))
	return out
}

const HEADING = ["text-[1.15rem]", "text-[1.05rem]", "text-[0.98rem]"]

export function Markdown({ source, className }: { source: string; className?: string }) {
	const lines = source.replace(/\r\n/g, "\n").split("\n")
	// Every loop below is already bounded by `lines.length`; this states that
	// invariant in a form the compiler can use rather than asserting past it.
	const at = (n: number): string => lines[n] ?? ""
	const out: ReactNode[] = []
	let i = 0

	while (i < lines.length) {
		const line = at(i)
		const key = `b${i}`

		if (!line.trim()) {
			i += 1
			continue
		}

		// Fenced code: everything up to the closing fence is literal.
		const fence = /^```(\w*)\s*$/.exec(line)
		if (fence) {
			const body: string[] = []
			i += 1
			while (i < lines.length && !/^```\s*$/.test(at(i))) {
				body.push(at(i))
				i += 1
			}
			i += 1
			out.push(
				<pre
					key={key}
					className="thin-scroll overflow-x-auto rounded-xl bg-navy px-3.5 py-3 font-mono text-[0.8rem] leading-relaxed text-white"
				>
					<code>{body.join("\n")}</code>
				</pre>,
			)
			continue
		}

		if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			out.push(<hr key={key} className="border-t border-dashed border-line" />)
			i += 1
			continue
		}

		const heading = /^(#{1,3})\s+(.*)$/.exec(line)
		if (heading) {
			const level = (heading[1] ?? "#").length
			const Tag = (["h3", "h4", "h5"] as const)[level - 1] ?? "h3"
			out.push(
				<Tag key={key} className={`${HEADING[level - 1] ?? HEADING[0]} leading-tight font-extrabold text-navy`}>
					{inline(heading[2] ?? "", key)}
				</Tag>,
			)
			i += 1
			continue
		}

		if (/^>\s?/.test(line)) {
			const body: string[] = []
			while (i < lines.length && /^>\s?/.test(at(i))) {
				body.push(at(i).replace(/^>\s?/, ""))
				i += 1
			}
			out.push(
				<blockquote key={key} className="border-l-2 border-violet pl-3.5 text-navy-soft italic">
					{inline(body.join(" "), key)}
				</blockquote>,
			)
			continue
		}

		const bullet = /^\s*[-*+]\s+(.*)$/
		const number = /^\s*\d+[.)]\s+(.*)$/
		const isList = bullet.test(line) ? bullet : number.test(line) ? number : null
		if (isList) {
			const ordered = isList === number
			const items: string[] = []
			while (i < lines.length && isList.test(at(i))) {
				items.push(isList.exec(at(i))?.[1] ?? "")
				i += 1
			}
			const List = ordered ? "ol" : "ul"
			out.push(
				<List key={key} className={`grid gap-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-navy-faint`}>
					{items.map((item, n) => (
						<li key={`${key}-${n}`}>{inline(item, `${key}-${n}`)}</li>
					))}
				</List>,
			)
			continue
		}

		// A paragraph runs until a blank line or the start of another block.
		const para: string[] = []
		while (
			i < lines.length &&
			at(i).trim() &&
			!/^(#{1,3}\s|>|```|---|\*\*\*|___)/.test(at(i)) &&
			!bullet.test(at(i)) &&
			!number.test(at(i))
		) {
			para.push(at(i))
			i += 1
		}
		// The exclusion above tests a PREFIX, but the handlers above match whole
		// lines — `----` and ```` ```js foo ```` passed every handler and were also
		// declined here, so nothing advanced `i` and the render spun forever on one
		// line (which is exactly what a rogue journal entry did to Explore). Take
		// the line as a paragraph so progress is unconditional.
		if (para.length === 0) {
			para.push(at(i))
			i += 1
		}
		out.push(<p key={key}>{inline(para.join(" "), key)}</p>)
	}

	// Callers lay entries out as a grid, and a grid item will not shrink below
	// its longest unbroken run — a pasted image URL, a long link, a code line —
	// so one of those used to widen the whole entry and set every paragraph
	// scrolling sideways with it. `min-w-0` on each block lets them shrink back
	// to the column (a `<pre>` then scrolls inside itself, as it is built to),
	// and `overflow-wrap: anywhere` breaks a word that is wider than the line.
	return <div className={`min-w-0 [overflow-wrap:anywhere] *:min-w-0 ${className ?? ""}`}>{out}</div>
}
