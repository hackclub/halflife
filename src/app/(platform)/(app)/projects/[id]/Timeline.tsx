"use client"

import { useLayoutEffect, useRef, useState } from "react"
import { IconCheck, IconFilm, IconPencil, IconPlay, IconWarning } from "@/components/platform/icons"
import { Markdown } from "@/components/platform/Markdown"
import { ReportButton } from "@/components/platform/report/ReportButton"
import { Chip } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import { fmtDate, fmtHours } from "@/lib/projects"
import type { TimelineItem, TimelineLapse } from "@/lib/queries/project-page"

/**
 * The whole record of a project, newest first: every journal entry with the timelapses behind it, every reel, and each time a week was handed in and decided.
 *
 * One rule down the left and one marker per moment, so it reads as a single chronology rather than a feed of cards. The marker says what kind of moment it was; the body is only as big as what was put on the record, so a submission is a line and a journal entry is the entry.
 */
export function Timeline({
	items,
	weekFor,
	allowReport = false,
}: {
	items: TimelineItem[]
	/** The trail week a phase of this project ran in, for the "Week 3" labels. */
	weekFor: (phase: "DESIGN" | "BUILD") => number
	/**
	 * Whether journal entries and reels carry a report button. On for someone else's project, off on your own – reporting your own work is noise.
	 */
	allowReport?: boolean
}) {
	// Which week each moment belongs to is said once, where that week starts, rather than on every entry – and only once there are two weeks to tell apart. A reel carries no phase, so it sits in whichever week is running when it comes up.
	const phaseOf = (item: TimelineItem) => (item.kind === "reel" ? null : item.phase)
	const split = new Set(items.map(phaseOf).filter(Boolean)).size > 1
	let running: "DESIGN" | "BUILD" | null = null
	const rows: React.ReactNode[] = []
	for (const [i, item] of items.entries()) {
		// Annotated because `running` is assigned from this on the next pass, so
		// left to inference it is its own initializer.
		const phase: "DESIGN" | "BUILD" | null =
			phaseOf(item) ?? running ?? items.slice(i).map(phaseOf).find(Boolean) ?? null
		if (split && phase && phase !== running) {
			running = phase
			rows.push(
				<li key={`week-${phase}`} className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-4">
					<span
						aria-hidden="true"
						className="relative z-10 mx-auto mt-1.5 size-2.5 rounded-full bg-violet ring-4 ring-paper"
					/>
					<p className="flex items-center gap-3">
						<span className="label shrink-0 text-violet-deep">
							{PHASE[phase]} · {weekFor(phase) === 0 ? "warm-up" : `week ${weekFor(phase)}`}
						</span>
						<span aria-hidden="true" className="h-0 flex-1 border-t border-dashed border-line" />
					</p>
				</li>,
			)
		}
		rows.push(
			// The id is the anchor Explore's "See more" links to, so the entry someone was reading is the one they land on.
			<li key={item.id} id={item.id} className="relative grid scroll-mt-24 grid-cols-[32px_minmax(0,1fr)] gap-x-4">
				<Marker item={item} />
				<div className="min-w-0 pt-1">
					<Body item={item} allowReport={allowReport} />
				</div>
			</li>,
		)
	}

	return (
		<ol className="relative grid gap-6 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-0.5 before:rounded-full before:bg-line">
			{rows}
		</ol>
	)
}

function Marker({ item }: { item: TimelineItem }) {
	const look =
		item.kind === "session"
			? { tone: "bg-violet-pale text-violet-deep", icon: <IconPencil className="text-[0.85rem]" /> }
			: item.kind === "reel"
				? { tone: "bg-sky-pale text-sky-ink", icon: <IconFilm className="text-[0.9rem]" /> }
				: item.kind === "submitted"
					? { tone: "bg-gold-pale text-gold-ink", icon: <IconCheck className="text-[0.8rem]" strokeWidth={3} /> }
					: item.result === "APPROVED"
						? { tone: "bg-mint text-teal-ink", icon: <IconCheck className="text-[0.8rem]" strokeWidth={3} /> }
						: { tone: "bg-coral/15 text-coral-dark", icon: <IconWarning className="text-[0.85rem]" /> }
	return (
		<span
			aria-hidden="true"
			className={cx("relative z-10 grid size-8 place-items-center rounded-full ring-4 ring-paper", look.tone)}
		>
			{look.icon}
		</span>
	)
}

function When({ at }: { at: number }) {
	return <span className="hand ml-auto shrink-0 text-[0.84rem] text-navy-soft tabular-nums">{fmtDate(at)}</span>
}

const PHASE = { DESIGN: "design", BUILD: "build" } as const

function Body({ item, allowReport }: { item: TimelineItem; allowReport: boolean }) {
	if (item.kind === "session") {
		return (
			<article>
				<header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
					<h3 className="text-[0.95rem] font-extrabold text-navy">Journal entry</h3>
					<span className="hand text-[0.84rem] text-teal-ink tabular-nums">
						{fmtHours(item.hours)} logged
						{item.approvedHours !== null && (
							<span className="text-navy-soft"> · {fmtHours(item.approvedHours)} approved</span>
						)}
					</span>
					{allowReport && (
						<ReportButton
							target={{ type: "DEVLOG", id: item.id }}
							title="Report this journal entry"
							context={item.body.slice(0, 280)}
							className="text-[0.76rem]"
						/>
					)}
					<When at={item.at} />
				</header>
				<EntryBody source={item.body} />
				{item.lapses.length > 0 && <Lapses lapses={item.lapses} />}
			</article>
		)
	}

	if (item.kind === "reel") {
		return (
			<article>
				<header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
					<h3 className="text-[0.95rem] font-extrabold text-navy">Posted a reel</h3>
					{item.status === "PROCESSING" && <Chip tone="gold">Processing</Chip>}
					{item.status === "HIDDEN" && <Chip tone="coral">Hidden from the feed</Chip>}
					{allowReport && (
						<ReportButton
							target={{ type: "REEL", id: item.id }}
							title="Report this reel"
							context={item.caption || undefined}
							className="text-[0.76rem]"
						/>
					)}
					<When at={item.at} />
				</header>
				{item.caption && (
					<p className="mt-1.5 max-w-[68ch] text-[0.9rem] leading-relaxed [overflow-wrap:anywhere] text-navy">
						{item.caption}
					</p>
				)}
				{item.videoUrl && (
					// Nothing autoplays and nothing preloads past the poster: a timeline of reels loading at once is a page that eats a phone's data.
					// biome-ignore lint/a11y/useMediaCaption: a participant upload, and there is no caption file to point a track at. An empty track is announced as an empty caption, which is worse than none.
					<video
						src={item.thumbnailUrl ? item.videoUrl : `${item.videoUrl}#t=0.1`}
						poster={item.thumbnailUrl ?? undefined}
						preload={item.thumbnailUrl ? "none" : "metadata"}
						controls
						playsInline
						aria-label={item.caption ? `Reel: ${item.caption}` : "Project reel"}
						className="mt-3 aspect-[9/16] w-full max-w-[180px] rounded-2xl bg-navy object-cover"
					/>
				)}
			</article>
		)
	}

	if (item.kind === "submitted") {
		return (
			<p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
				<span className="text-[0.95rem] font-extrabold text-navy">
					Submitted the {PHASE[item.phase]} week for review
				</span>
				<When at={item.at} />
			</p>
		)
	}

	const verdict = {
		APPROVED: { text: "approved", tone: "text-teal-ink" },
		RETURNED: { text: "sent back for changes", tone: "text-coral-deep" },
		REJECTED: { text: "rejected", tone: "text-coral-deep" },
	}[item.result]
	return (
		<div>
			<p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
				<span className={cx("text-[0.95rem] font-extrabold", verdict.tone)}>
					The {PHASE[item.phase]} week was {verdict.text}
				</span>
				<When at={item.at} />
			</p>
			{item.comments && (
				<blockquote className="mt-2 max-w-[68ch] rounded-xl bg-black/[.04] px-4 py-3 text-[0.88rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] text-navy">
					{item.comments}
				</blockquote>
			)}
		</div>
	)
}

/**
 * A journal entry, folded when it runs long. The timeline is for reading the story of a project, and one entry pasted in at a thousand lines should not push every other moment off the page – so past about a dozen lines it fades out behind a toggle, and the whole of it is one click away.
 */
function EntryBody({ source }: { source: string }) {
	const box = useRef<HTMLDivElement>(null)
	const content = useRef<HTMLDivElement>(null)
	const [long, setLong] = useState(false)
	const [open, setOpen] = useState(false)

	// Measured, because a character count cannot know how tall a picture turns out to be – and an entry is mostly pictures. They carry `loading="lazy"` and no intrinsic size, so one that has not arrived yet is not the height it will be: measured once at mount, every image-heavy entry read as short, the box clipped to a fixed height regardless, and the rest of it sat behind `overflow:hidden` with neither the fade nor the toggle to reach it. The measurement is therefore taken twice over – the entry inside the box against the box's own clipped height – and repeated whenever the entry changes size.
	//
	// The box is the wrong thing to measure on its own: while it is clipped it can only ever report its own clipped size.
	useLayoutEffect(() => {
		const el = content.current
		const clipped = box.current
		if (!el || !clipped) return
		const measure = () => {
			// Unfolded there is no clip to compare against, and asking again would take "fold it back up" away the moment it was pressed.
			if (open) return setLong(true)
			setLong(el.offsetHeight > clipped.clientHeight + 4)
		}
		measure()
		const ro = new ResizeObserver(measure)
		ro.observe(el)
		return () => ro.disconnect()
	}, [source, open])

	return (
		<>
			<div
				ref={box}
				className={cx(
					"relative mt-2 max-w-[68ch]",
					!open && "max-h-[18rem] overflow-hidden",
					!open && long && "[mask-image:linear-gradient(to_bottom,#000_70%,transparent)]",
				)}
			>
				<div ref={content}>
					<Markdown source={source} className="grid gap-2.5 text-[0.9rem] leading-relaxed text-navy" />
				</div>
			</div>
			{long && (
				<button
					type="button"
					onClick={() => setOpen(v => !v)}
					aria-expanded={open}
					className="hand mt-1.5 text-[0.84rem] text-violet-deep underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
				>
					{open ? "fold it back up" : "show the whole entry"}
				</button>
			)}
		</>
	)
}

function footage(seconds: number | null) {
	if (!seconds) return null
	const m = Math.round(seconds / 60)
	return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

/**
 * The timelapses behind an entry. They open on Lapse, where they play, rather than inline: Lapse's page is the canonical one and knows how to stream them.
 */
function Lapses({ lapses }: { lapses: TimelineLapse[] }) {
	return (
		<ul className="mt-3 flex flex-wrap gap-2.5" aria-label="Timelapses">
			{lapses.map((l, i) => {
				const inner = (
					<>
						<span className="relative block aspect-video w-40 overflow-hidden rounded-xl bg-navy/90">
							{l.thumbnailUrl ? (
								// eslint-disable-next-line @next/next/no-img-element -- Lapse's own CDN, not ours to optimise
								<img src={l.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
							) : null}
							<span className="absolute inset-0 grid place-items-center">
								<span className="grid size-8 place-items-center rounded-full bg-white/90 text-navy shadow-[0_2px_8px_rgb(0_0_0/0.25)]">
									<IconPlay className="text-[0.8rem]" />
								</span>
							</span>
						</span>
						<span className="hand mt-1 block text-[0.84rem] text-navy-soft tabular-nums">
							Timelapse {lapses.length > 1 ? i + 1 : ""}
							{footage(l.coveredSeconds) && ` · ${footage(l.coveredSeconds)} of work`}
						</span>
					</>
				)
				return (
					<li key={l.id}>
						{l.href ? (
							<a
								href={l.href}
								target="_blank"
								rel="noopener noreferrer"
								className="block rounded-xl transition-transform hover:-translate-y-0.5"
							>
								{inner}
							</a>
						) : (
							inner
						)}
					</li>
				)
			})}
		</ul>
	)
}
