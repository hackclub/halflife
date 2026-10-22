"use client"

import Image from "next/image"
import Link from "next/link"
import { useRef, useState } from "react"
import { IconArrowRight, IconClock } from "@/components/platform/icons"
import { Panel } from "@/components/platform/ui"
import { DISPLAY_STARTERS, type DisplayStarter, displayPhotoSrc } from "@/lib/config/display-starters"
import { cx } from "@/lib/cx"

/** The one entrance on the page: the panel's new contents rise in when you pick another display, and never on first paint. */
const RISE = "animate-[hl-rise_0.42s_var(--ease-out-expo)_both]"

/** The grid's column count at each width, with the classes that show or hide a filler tile there. Written out whole so Tailwind finds them. */
const COLUMNS = [
	[2, "block", "hidden"],
	[3, "min-[30rem]:block", "min-[30rem]:hidden"],
	[4, "sm:block", "sm:hidden"],
	[7, "lg:block", "lg:hidden"],
] as const

/** How many empty cells the last row has at a column count. */
const filler = (cols: number): number => (cols - (DISPLAY_STARTERS.length % cols)) % cols

/** Hatched tiles that square off the last row at every width, as Stasis's grid does, so the hairlines never end in a ragged edge. */
const PLACEHOLDERS = Array.from({ length: Math.max(...COLUMNS.map(([cols]) => filler(cols))) }, (_, id) => ({
	classes: COLUMNS.map(([cols, show, hide]) => (id < filler(cols) ? show : hide)).join(" "),
	id,
}))

const HATCH =
	"aspect-square bg-cream bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--color-line)_45%,transparent)_0_10px,transparent_10px_20px)]"

/**
 * Stasis's starter picker, drawn in the notebook: a big preview of the display you have picked, its details beside it, and every display in a contact sheet underneath, easiest first – flush square photos split by hairlines, grey until picked. Picking one swaps the panel in place and writes it to the URL, so the back link from a guide lands where you left.
 */
export function StarterPicker({ initial }: { initial: string }) {
	const [slug, setSlug] = useState(initial)
	const [picked, setPicked] = useState(false)
	const panel = useRef<HTMLDivElement>(null)
	const starter: DisplayStarter = DISPLAY_STARTERS.find(d => d.slug === slug) ?? DISPLAY_STARTERS[0]

	const pick = (next: string): void => {
		if (next === slug) return
		setSlug(next)
		setPicked(true)
		window.history.replaceState(null, "", `?display=${next}`)
		// Stacked, the strip sits below the fold of the panel it changes; bring the change into view.
		const top = panel.current?.getBoundingClientRect().top ?? 0
		if (top < 0) panel.current?.scrollIntoView({ behavior: "smooth", block: "start" })
	}

	return (
		<Panel className="bg-white" radius={22}>
			<div className="grid scroll-mt-24 lg:grid-cols-[1.3fr_1fr]" ref={panel}>
				<div className={cx("p-3 sm:p-4", picked && RISE)} key={`p-${starter.slug}`}>
					<div className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-cream">
						<Image
							alt={starter.photo.alt}
							className="object-cover"
							fetchPriority="high"
							fill
							loading="eager"
							sizes="(min-width: 1024px) 520px, 100vw"
							src={displayPhotoSrc(starter.photo.file)}
						/>
					</div>
					<p className="hand mt-2 px-1 text-[0.8rem] text-navy-soft">
						Photo: {starter.photo.credit.author}, {starter.photo.credit.licence}, via{" "}
						<a
							className="underline decoration-dashed underline-offset-4 hover:text-navy"
							href={starter.photo.credit.url}
							rel="noopener noreferrer"
							target="_blank"
						>
							Wikimedia Commons
						</a>
					</p>
				</div>

				<div
					className={cx(
						"flex flex-col border-t-2 border-dashed border-line px-5 pt-5 pb-6 sm:px-7 lg:border-t-0 lg:border-l-2 lg:pt-7",
						picked && RISE,
					)}
					key={`d-${starter.slug}`}
				>
					<h2 className="text-[clamp(1.9rem,3.6vw,2.6rem)] leading-[1.02] font-extrabold tracking-[-0.04em] text-balance text-navy">
						{starter.title}
					</h2>
					<p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
						<span className="label rounded-full bg-violet-pale px-2.5 py-1 text-violet-deep">Tier 1</span>
						<span className="hand inline-flex items-center gap-1.5 text-[0.86rem] text-navy-soft">
							<IconClock className="text-[1rem]" /> about {starter.hours} hours · {starter.level.toLowerCase()}
						</span>
					</p>
					<p className="mt-4 max-w-[52ch] text-[0.98rem] leading-relaxed text-navy-soft">{starter.lead}</p>

					<ul aria-label="On the board" className="mt-5 flex flex-wrap gap-1.5">
						{starter.parts.map(part => (
							<li className="rounded-full bg-cream px-2.5 py-1 text-[0.76rem] font-semibold text-navy-soft" key={part}>
								{part}
							</li>
						))}
					</ul>

					<Link
						className="label mt-6 inline-flex h-13 w-full items-center justify-center gap-2 rounded-xl border-2 border-violet-dark bg-violet-deep px-7 text-[0.95rem] text-white transition-[background-color,transform] duration-150 hover:bg-violet-dark active:translate-y-px lg:mt-auto"
						href={`/starter-projects/displays/${starter.slug}`}
					>
						Read the guide <IconArrowRight className="text-[1.1rem]" />
					</Link>
				</div>
			</div>

			<div className="border-t-2 border-dashed border-line px-1.5 pb-1.5">
				<div className="flex items-baseline justify-between gap-3 px-3 pt-4 pb-3 sm:px-4">
					<h2 className="label text-navy-soft">All seven displays</h2>
					<p className="hand text-[0.8rem] text-navy-soft">easiest first</p>
				</div>
				<ul className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-[16px] bg-line min-[30rem]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-7">
					{DISPLAY_STARTERS.map(d => {
						const on = d.slug === starter.slug
						return (
							<li key={d.slug}>
								<button
									aria-pressed={on}
									className="tile-corners group relative block aspect-square w-full overflow-hidden bg-cream focus-visible:-outline-offset-4"
									onClick={() => pick(d.slug)}
									type="button"
								>
									<Image
										alt=""
										className={cx(
											"object-cover transition-[filter,transform] duration-300 ease-(--ease-spring)",
											on ? "scale-105 rotate-[1.5deg]" : "grayscale",
										)}
										fill
										sizes="(min-width: 1024px) 150px, (min-width: 640px) 25vw, 50vw"
										src={displayPhotoSrc(d.photo.file)}
									/>
									<span
										className={cx(
											"absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-md px-1.5 py-0.5 text-left text-[0.78rem] leading-tight font-extrabold",
											on ? "bg-violet-deep text-white" : "bg-white/90 text-navy",
										)}
									>
										{d.title}
									</span>
								</button>
							</li>
						)
					})}
					{PLACEHOLDERS.map(p => (
						<li aria-hidden="true" className={cx(HATCH, p.classes)} key={p.id} />
					))}
				</ul>
			</div>
		</Panel>
	)
}
