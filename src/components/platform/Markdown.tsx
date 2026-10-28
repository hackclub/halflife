import type { ReactNode } from "react"
import { attrUrl } from "@/lib/attr-url"
import { INLINE, safeHref, safeSrc } from "@/lib/markdown"

/**
 * Enough Markdown for a journal entry, and deliberately no more: headings, emphasis, code, links, images, lists, quotes and rules. Everything renders as React elements rather than injected HTML, so an entry can never smuggle markup into the page – which matters because every word of this is typed by a maker and, on the Explore feed, read by everybody else.
 */

export function inline(text: string, key: string): ReactNode[] {
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
					// arbitrary remote source typed by the maker
					<img
						alt={m[1]}
						className="my-1 block max-w-full rounded-xl border-2 border-line"
						key={k}
						loading="lazy"
						src={attrUrl(src)}
					/>
				) : (
					<span className="hand text-navy-soft" key={k}>
						{m[1] || "image"}
					</span>
				),
			)
		} else if (m[3] !== undefined)
			out.push(
				<code className="rounded bg-violet-pale px-1 py-0.5 font-mono text-[0.88em] text-violet-deep" key={k}>
					{m[3]}
				</code>,
			)
		else if (m[4] !== undefined || m[5] !== undefined)
			out.push(
				<strong className="font-extrabold text-navy" key={k}>
					{m[4] ?? m[5]}
				</strong>,
			)
		else if (m[6] !== undefined || m[7] !== undefined) out.push(<em key={k}>{m[6] ?? m[7]}</em>)
		else {
			const href = safeHref(m[9] ?? "")
			out.push(
				href ? (
					<a
						className="font-semibold text-sky-ink underline decoration-2 underline-offset-[3px] transition-colors hover:text-coral-deep hover:decoration-coral"
						href={attrUrl(href)}
						key={k}
						rel="noreferrer"
						target="_blank"
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
	const lines = source.replaceAll("\r\n", "\n").split("\n")
	// Every loop below is already bounded by `lines.length`; this states that invariant in a form the compiler can use rather than asserting past it.
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
					className="thin-scroll overflow-x-auto rounded-xl bg-navy px-3.5 py-3 font-mono text-[0.8rem] leading-relaxed text-white"
					key={key}
				>
					<code>{body.join("\n")}</code>
				</pre>,
			)
			continue
		}

		if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			out.push(<hr className="border-t border-dashed border-line" key={key} />)
			i += 1
			continue
		}

		const heading = /^(#{1,3})\s+(.*)$/.exec(line)
		if (heading) {
			const level = (heading[1] ?? "#").length
			const Tag = (["h3", "h4", "h5"] as const)[level - 1] ?? "h3"
			out.push(
				<Tag className={`${HEADING[level - 1] ?? HEADING[0]} leading-tight font-extrabold text-navy`} key={key}>
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
				<blockquote className="border-l-2 border-violet pl-3.5 text-navy-soft italic" key={key}>
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
				<List className={`grid gap-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-navy-faint`} key={key}>
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
			i < lines.length
			&& at(i).trim()
			&& !/^(#{1,3}\s|>|```|---|\*\*\*|___)/.test(at(i))
			&& !bullet.test(at(i))
			&& !number.test(at(i))
		) {
			para.push(at(i))
			i += 1
		}
		// The exclusion above tests a PREFIX, but the handlers above match whole lines – `----` and ```` ```js foo ```` passed every handler and were also declined here, so nothing advanced `i` and the render spun forever on one line (which is exactly what a rogue journal entry did to Explore). Take the line as a paragraph so progress is unconditional.
		if (para.length === 0) {
			para.push(at(i))
			i += 1
		}
		out.push(<p key={key}>{inline(para.join(" "), key)}</p>)
	}

	// Callers lay entries out as a grid, and a grid item will not shrink below its longest unbroken run – a pasted image URL, a long link, a code line – so one of those used to widen the whole entry and set every paragraph scrolling sideways with it. `min-w-0` on each block lets them shrink back to the column (a `<pre>` then scrolls inside itself, as it is built to), and `overflow-wrap: anywhere` breaks a word that is wider than the line.
	return <div className={`min-w-0 [overflow-wrap:anywhere] *:min-w-0 ${className ?? ""}`}>{out}</div>
}
