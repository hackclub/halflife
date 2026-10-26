import type { ReactNode } from "react"
import { inline } from "@/components/platform/Markdown"
import { Panel } from "@/components/platform/ui"
import { DISPLAY_PHOTO_SIZES } from "@/lib/config/display-starters"
import { CopyCode } from "./CopyCode"

/**
 * A starter guide, rendered.
 *
 * The journal's `Markdown` is deliberately small, because every word of it is typed by a maker. A guide is ours, and needs what it leaves out: tables for wiring and footprints, credited photos, and sections a reader can jump between. So the blocks are parsed here and the inline marks – code, emphasis, links – still go through the journal's `inline`, which keeps links and images on the same allow-list.
 */

export interface GuideHeading {
	id: string
	text: string
}

const slugify = (text: string): string =>
	text
		.toLowerCase()
		.replaceAll(/[`*]/g, "")
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-|-$/g, "")

/** The guide's `##` sections, for the reading trail beside it. */
export function guideHeadings(source: string): GuideHeading[] {
	const out: GuideHeading[] = []
	let fenced = false
	for (const line of source.split("\n")) {
		if (line.startsWith("```")) fenced = !fenced
		if (fenced) continue
		const m = /^## (.+)$/.exec(line)
		if (m?.[1]) out.push({ id: slugify(m[1]), text: m[1] })
	}
	return out
}

const LANGUAGE: { [_: string]: string } = { cpp: "Arduino C++", python: "Python" }

const splitRow = (line: string): string[] =>
	line
		.trim()
		.replaceAll(/^\||\|$/g, "")
		.split("|")
		.map(cell => cell.trim())

function Table({ rows, id }: { rows: string[]; id: string }) {
	const [head = "", , ...body] = rows
	const columns = splitRow(head)
	return (
		<Panel className="bg-white" radius={14} variant={2}>
			<div className="thin-scroll overflow-x-auto">
				<table className="w-full min-w-[34rem] border-collapse text-left text-[0.9rem] leading-snug">
					<thead>
						<tr>
							{columns.map((cell, n) => (
								<th className="label px-4 pt-3.5 pb-2.5 align-bottom text-navy-soft" key={`${id}-h${n}`} scope="col">
									{inline(cell, `${id}-h${n}`)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{body.map((row, r) => (
							<tr className="border-t border-dashed border-line" key={`${id}-r${r}`}>
								{splitRow(row).map((cell, n) => (
									<td
										className={`px-4 py-2.5 align-top text-navy ${n === 0 ? "font-semibold" : ""}`}
										key={`${id}-r${r}-${n}`}
									>
										{inline(cell, `${id}-r${r}-${n}`)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Panel>
	)
}

function Figure({ alt, src, credit, id }: { alt: string; src: string; credit?: string; id: string }) {
	const size = DISPLAY_PHOTO_SIZES[src.slice(src.lastIndexOf("/") + 1)]
	return (
		<figure className="grid gap-2">
			{/* A plain img: a guide's photos keep their own crop and run at their own width */}
			<img
				alt={alt}
				className="block h-auto max-h-[34rem] w-full rounded-[14px] bg-white object-contain"
				height={size?.[1]}
				loading="lazy"
				src={src}
				width={size?.[0]}
			/>
			{credit && (
				<figcaption className="hand text-[0.84rem] leading-relaxed text-navy-soft">
					{inline(credit, `${id}-c`)}
				</figcaption>
			)}
		</figure>
	)
}

/** Everything that ends a paragraph. */
const BLOCK_START = /^(#{2,3} |```|\||!\[|\s*[-*+] |\s*\d+[.)] )/

export function GuideBody({ source }: { source: string }) {
	const lines = source.split("\n")
	const at = (n: number): string => lines[n] ?? ""
	const out: ReactNode[] = []
	let i = 0

	while (i < lines.length) {
		const line = at(i)
		const key = `g${i}`

		if (!line.trim()) {
			i += 1
			continue
		}

		const fence = /^```(\w*)\s*$/.exec(line)
		if (fence) {
			const body: string[] = []
			i += 1
			while (i < lines.length && !/^```\s*$/.test(at(i))) {
				body.push(at(i))
				i += 1
			}
			i += 1
			const code = body.join("\n")
			out.push(
				<div className="relative min-w-0" key={key}>
					<div className="flex items-center justify-between rounded-t-[14px] bg-navy-soft px-4 py-1.5">
						<span className="hand text-[0.8rem] text-white">{LANGUAGE[fence[1] ?? ""] ?? "Code"}</span>
						<CopyCode code={code} />
					</div>
					<pre className="thin-scroll overflow-x-auto rounded-b-[14px] bg-navy px-4 py-3.5 font-mono text-[0.82rem] leading-relaxed text-white">
						<code>{code}</code>
					</pre>
				</div>,
			)
			continue
		}

		const heading = /^(#{2,3}) (.+)$/.exec(line)
		if (heading) {
			const text = heading[2] ?? ""
			const id = slugify(text)
			out.push(
				heading[1] === "##" ? (
					<h2
						className="scroll-mt-28 pt-8 text-[1.65rem] leading-tight font-extrabold tracking-[-0.03em] text-balance text-navy first:pt-0"
						id={id}
						key={key}
					>
						{inline(text, key)}
					</h2>
				) : (
					<h3
						className="scroll-mt-28 pt-3 text-[1.15rem] leading-snug font-extrabold tracking-[-0.015em] text-navy"
						id={id}
						key={key}
					>
						{inline(text, key)}
					</h3>
				),
			)
			i += 1
			continue
		}

		if (line.startsWith("|")) {
			const rows: string[] = []
			while (i < lines.length && at(i).startsWith("|")) {
				rows.push(at(i))
				i += 1
			}
			out.push(<Table id={key} key={key} rows={rows} />)
			continue
		}

		const image = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line)
		if (image) {
			i += 1
			// A credit sits on the line right under its photo, in italics.
			const credit = /^\*(.+)\*\s*$/.exec(at(i))?.[1]
			if (credit) i += 1
			out.push(<Figure alt={image[1] ?? ""} credit={credit} id={key} key={key} src={image[2] ?? ""} />)
			continue
		}

		const bullet = /^\s*[-*+]\s+(.*)$/
		const number = /^\s*\d+[.)]\s+(.*)$/
		const list = bullet.test(line) ? bullet : number.test(line) ? number : null
		if (list) {
			const items: string[] = []
			while (i < lines.length && list.test(at(i))) {
				items.push(list.exec(at(i))?.[1] ?? "")
				i += 1
			}
			const ordered = list === number
			const List = ordered ? "ol" : "ul"
			out.push(
				<List
					className={`grid max-w-[68ch] gap-2 pl-5 text-[1rem] leading-[1.7] text-navy ${ordered ? "list-decimal marker:font-bold marker:text-navy-soft" : "list-disc marker:text-teal"}`}
					key={key}
				>
					{items.map((item, n) => (
						<li className="pl-1" key={`${key}-${n}`}>
							{inline(item, `${key}-${n}`)}
						</li>
					))}
				</List>,
			)
			continue
		}

		const para: string[] = []
		while (i < lines.length && at(i).trim() && (para.length === 0 || !BLOCK_START.test(at(i)))) {
			para.push(at(i))
			i += 1
		}
		out.push(
			<p className="max-w-[68ch] text-[1rem] leading-[1.75] text-navy" key={key}>
				{inline(para.join(" "), key)}
			</p>,
		)
	}

	return <div className="grid min-w-0 gap-5 [overflow-wrap:anywhere] *:min-w-0">{out}</div>
}
