"use client"

import Link from "next/link"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Gato } from "@/components/platform/art"
import { IconFilm, IconPause, IconPlay, IconVolume, IconVolumeOff } from "@/components/platform/icons"
import { cx } from "@/lib/cx"
import type { FeedItem } from "@/lib/feed"
import { ago, clock } from "./format"
import { notePlaying, noteStopped, playExclusive, sendLike } from "./ReelCard"

function prefersStill() {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Two taps closer together than this, and near enough each other, are one like. */
const DOUBLE_TAP_MS = 280
const DOUBLE_TAP_PX = 44

/** A heart, drawn once as markup: it is stamped into the burst layer by hand. */
const HEART_SVG =
	'<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="M12 21s-8.6-5-8.6-10.6A4.8 4.8 0 0 1 12 7.8a4.8 4.8 0 0 1 8.6 2.6C20.6 16 12 21 12 21Z" fill="currentColor" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>'

export interface SlideHandle {
	toggle: () => void
}

/**
 * One reel on the Doomscroller, and everything that belongs to it rather than to the page: the video, who posted it and what they said, how far through it is, and the player underneath. All of it moves as one when the reader scrolls, while the actions beside the reel stay where the hand is.
 *
 * Dressed like the rail's own reel card – project on a tag in the corner, author and caption over the foot of the picture – so the two feeds read as one product at two sizes. The player below the card is platform furniture: drawn round buttons on the cream, the clock in the hand.
 *
 * Playback follows `active` and nothing else. The page decides which slide is current; the slide plays when it is, from the top, and stops when it is not.
 */
export function StageSlide({
	reel,
	active,
	muted,
	rate,
	autoScroll,
	onAutoMuted,
	onToggleMute,
	onCycleRate,
	onToggleAutoScroll,
	onEnded,
	onPatch,
	register,
}: {
	reel: FeedItem
	active: boolean
	muted: boolean
	rate: number
	autoScroll: boolean
	/** The browser refused sound; the slide went on muted. */
	onAutoMuted: () => void
	onToggleMute: () => void
	onCycleRate: () => void
	onToggleAutoScroll: () => void
	/** Reached the end with auto scroll on. */
	onEnded: () => void
	onPatch: (id: string, next: Partial<FeedItem>) => void
	/** Hands the page this slide's controls while it is the current one. */
	register: (handle: SlideHandle | null) => void
}) {
	const video = useRef<HTMLVideoElement>(null)
	const fill = useRef<HTMLDivElement>(null)
	const bursts = useRef<HTMLDivElement>(null)
	const caption = useRef<HTMLParagraphElement>(null)
	const [playing, setPlaying] = useState(false)
	const [time, setTime] = useState({ now: 0, total: reel.durationSeconds ?? 0 })
	const [expanded, setExpanded] = useState(false)
	const [clamped, setClamped] = useState(false)
	const counted = useRef(false)
	const tap = useRef<{ t: number; x: number; y: number } | null>(null)
	const pendingToggle = useRef(0)

	const announcement = reel.pinned || reel.kind === "ANNOUNCEMENT"
	// Portrait fills the card edge to edge; anything wider is letterboxed in it, so a landscape clip is shown whole rather than cropped to a strip.
	const portrait = !reel.width || !reel.height || reel.height >= reel.width

	// `muted` as a prop is not reflected after mount in React, so both are set on the element directly.
	useEffect(() => {
		const el = video.current
		if (!el) return
		el.muted = muted
		el.playbackRate = rate
	}, [muted, rate])

	useEffect(() => {
		const el = video.current
		if (!el) return
		if (!active) {
			el.pause()
			return
		}
		// Arriving is asking to watch – except for anyone who has asked for less motion, who gets the play button instead of a video that starts moving.
		if (prefersStill()) return
		el.currentTime = 0
		let cancelled = false
		playExclusive(el).then(async (ok) => {
			if (ok || cancelled || el.muted) return
			// Sound before the reader has touched the page is the browser's to refuse, and it does. Muted playback it always allows, so the reel plays silently and the page offers the sound back.
			el.muted = true
			onAutoMuted()
			await playExclusive(el)
		})
		return () => {
			cancelled = true
		}
	}, [active, onAutoMuted])

	// Smooth rather than stepped: `timeupdate` fires four times a second, which makes a thin bar visibly tick. Only the playing slide pays for a frame loop.
	useEffect(() => {
		if (!active || !playing) return
		let raf = 0
		const tick = () => {
			const el = video.current
			if (el && fill.current && el.duration) {
				fill.current.style.transform = `scaleX(${el.currentTime / el.duration})`
			}
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(raf)
	}, [active, playing])

	const toggle = useCallback(() => {
		const el = video.current
		if (!el || !reel.videoUrl) return
		if (el.paused) playExclusive(el)
		else el.pause()
	}, [reel.videoUrl])

	useEffect(() => {
		if (!active) return
		register({ toggle })
		return () => register(null)
	}, [active, register, toggle])

	// Whether the caption runs past its lines, so "more" only appears when there is more. Measured, because a character count cannot know the font.
	useLayoutEffect(() => {
		const el = caption.current
		if (!el || expanded) return
		const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
		measure()
		const ro = new ResizeObserver(measure)
		ro.observe(el)
		return () => ro.disconnect()
	}, [reel.caption, expanded])

	// The clock, the bar while it is not being driven by the frame loop, and the view. A view is a second of actual playback, not an arrival that a quick flick scrolled straight past – once per slide; the server counts once per person.
	function onTime() {
		const el = video.current
		if (!el) return
		setTime({ now: el.currentTime, total: el.duration || reel.durationSeconds || 0 })
		if (!playing && fill.current && el.duration) {
			fill.current.style.transform = `scaleX(${el.currentTime / el.duration})`
		}
		if (counted.current) return
		let watched = 0
		for (let i = 0; i < el.played.length; i++) watched += el.played.end(i) - el.played.start(i)
		if (watched < 1) return
		counted.current = true
		fetch(`/api/posts/${reel.id}/view`, { method: "POST" })
	}

	/** The heart that says a double tap landed, where it landed. */
	function burst(clientX: number, clientY: number) {
		const host = bursts.current
		if (!host || prefersStill()) return
		const box = host.getBoundingClientRect()
		const heart = document.createElement("span")
		const tilt = Math.round(Math.random() * 30 - 15)
		heart.innerHTML = HEART_SVG
		heart.className = "absolute size-24 text-coral drop-shadow-[0_6px_12px_rgb(28_26_89/0.35)]"
		heart.style.left = `${clientX - box.left}px`
		heart.style.top = `${clientY - box.top}px`
		host.appendChild(heart)
		const at = (lift: number, scale: number) =>
			`translate(-50%, calc(-50% - ${lift}px)) rotate(${tilt}deg) scale(${scale})`
		heart
			.animate(
				[
					{ opacity: 0, transform: at(0, 0.3) },
					{ opacity: 1, transform: at(0, 1.18), offset: 0.16 },
					{ opacity: 1, transform: at(0, 0.94), offset: 0.3 },
					{ opacity: 1, transform: at(0, 1), offset: 0.55 },
					{ opacity: 0, transform: at(80, 1.3) },
				],
				{ duration: 900, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
			)
			.finished.catch(() => undefined)
			.finally(() => heart.remove())
	}

	// One tap pauses, two like – the same surface does both. The single tap waits out the double-tap window before acting, or every like would also pause the reel. Keyboard presses (detail 0) are never a double tap, so they toggle at once.
	function onSurfaceClick(e: React.MouseEvent<HTMLButtonElement>) {
		if (e.detail === 0) {
			toggle()
			return
		}
		const now = performance.now()
		const prev = tap.current
		if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
			window.clearTimeout(pendingToggle.current)
			tap.current = null
			burst(e.clientX, e.clientY)
			sendLike(reel, true, onPatch)
			return
		}
		tap.current = { t: now, x: e.clientX, y: e.clientY }
		window.clearTimeout(pendingToggle.current)
		pendingToggle.current = window.setTimeout(() => {
			tap.current = null
			toggle()
		}, DOUBLE_TAP_MS)
	}

	useEffect(() => () => window.clearTimeout(pendingToggle.current), [])

	function seekTo(clientX: number, track: HTMLElement) {
		const el = video.current
		if (!el?.duration) return
		const box = track.getBoundingClientRect()
		const f = Math.min(1, Math.max(0, (clientX - box.left) / box.width))
		el.currentTime = f * el.duration
		if (fill.current) fill.current.style.transform = `scaleX(${f})`
		setTime({ now: el.currentTime, total: el.duration })
	}

	const who = reel.author.name ?? "A maker"

	return (
		<div className="flex h-full flex-col py-3">
			{/* ---------- the reel ---------- */}
			<article className="lift-shadow relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-navy">
				{reel.videoUrl ? (
					// biome-ignore lint/a11y/useMediaCaption: a participant upload, and there is no caption file to point a track at. An empty track is announced as an empty caption, which is worse than none.
					<video
						ref={video}
						src={reel.thumbnailUrl ? reel.videoUrl : `${reel.videoUrl}#t=0.1`}
						poster={reel.thumbnailUrl ?? undefined}
						playsInline
						loop={!autoScroll}
						// The reel on screen is worth buffering ahead; its mounted neighbours fetch just enough to show a first frame, which is what makes a swipe land on a picture rather than a blank card.
						preload={active ? "auto" : "metadata"}
						onPlay={(e) => {
							notePlaying(e.currentTarget)
							setPlaying(true)
						}}
						onPause={(e) => {
							noteStopped(e.currentTarget)
							setPlaying(false)
						}}
						onEnded={() => {
							if (autoScroll && active) onEnded()
						}}
						onLoadedMetadata={(e) => setTime({ now: e.currentTarget.currentTime, total: e.currentTarget.duration })}
						onTimeUpdate={onTime}
						className={cx("absolute inset-0 size-full", portrait ? "object-cover" : "object-contain")}
					/>
				) : (
					// No URL is a deployment without a public bucket URL, not a reel without a video. Saying so beats standing a picture in for it.
					<div className="absolute inset-0 grid place-items-center px-8 text-center">
						<p className="flex flex-col items-center gap-2 text-[0.84rem] leading-snug text-white/80">
							<IconFilm className="text-2xl text-white" />
							This video is not available right now.
						</p>
					</div>
				)}

				<button
					type="button"
					onClick={onSurfaceClick}
					disabled={!reel.videoUrl}
					aria-label={`${playing ? "Pause" : "Play"} reel by ${who}. Double-tap to like.`}
					className="absolute inset-0 z-[1] touch-manipulation focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky focus-visible:ring-inset"
				/>

				<div
					aria-hidden="true"
					className={cx(
						"pointer-events-none absolute inset-0 z-[2] grid place-items-center transition-[opacity,transform] duration-200 ease-[cubic-bezier(.16,1,.3,1)]",
						playing || !reel.videoUrl ? "scale-125 opacity-0" : "scale-100 opacity-100",
					)}
				>
					<span className="grid size-16 place-items-center rounded-full bg-black/35 text-white/90 backdrop-blur-sm">
						<IconPlay className="ml-1 text-[1.9rem]" />
					</span>
				</div>

				<div ref={bursts} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[3] overflow-hidden" />

				{/* The project on a tag in the corner, as on the rail's card. */}
				{announcement ? (
					<span className="label absolute top-3 left-3 z-[4] flex items-center gap-1.5 rounded-2xl bg-coral px-2.5 py-1 text-white">
						<Gato sizes="28px" className="h-auto w-4" />
						From HQ
					</span>
				) : reel.project ? (
					<Link
						href={`/projects/${reel.project.id}`}
						className="label absolute top-3 left-3 z-[4] max-w-[calc(100%-4.5rem)] truncate rounded-2xl bg-black/45 px-2.5 py-1 leading-[1.2] text-white backdrop-blur-sm transition-[background-color,transform] duration-150 hover:bg-black/60 active:translate-y-px md:max-w-[calc(100%-1.5rem)]"
					>
						{reel.project.title || reel.project.theme}
					</Link>
				) : null}

				{/* On a phone there is no player strip, so the sound lives up here. */}
				<button
					type="button"
					onClick={onToggleMute}
					aria-label={muted ? "Turn sound on" : "Mute"}
					aria-pressed={muted}
					className="absolute top-2.5 right-2.5 z-[4] grid size-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 md:hidden"
				>
					{muted ? <IconVolumeOff className="text-[1.15rem]" /> : <IconVolume className="text-[1.15rem]" />}
				</button>

				{/* ---------- who, and what they said ---------- */}
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-[4] bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3.5 pt-12 pb-4 pr-[4.25rem] md:pr-3.5">
					<p className="flex min-w-0 items-baseline gap-1.5 leading-tight text-white">
						{/* The name is the way to the poster's profile, so it takes clicks
                back from the surface that pauses and likes; the timestamp and the
                caption stay inert over the picture. */}
						<Link
							href={`/u/${reel.author.id}`}
							className="pointer-events-auto min-w-0 truncate text-[0.9rem] font-extrabold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.6)] hover:underline hover:decoration-dashed hover:underline-offset-4"
						>
							{who}
						</Link>
						{reel.publishedAt && (
							<span className="hand shrink-0 text-[0.76rem] text-white/80">· {ago(reel.publishedAt)}</span>
						)}
					</p>
					{reel.caption && (
						<div className={cx("mt-1 flex items-end gap-2.5", expanded && "pointer-events-auto")}>
							<p
								ref={caption}
								// Opened, the caption can outgrow its space and scrolls itself; the page's wheel handler leaves anything marked so alone.
								data-own-scroll={expanded || undefined}
								className={cx(
									"min-w-0 flex-1 text-[0.8rem] leading-snug whitespace-pre-line [overflow-wrap:anywhere] text-white/90",
									expanded ? "thin-scroll max-h-[34vh] overflow-y-auto" : "line-clamp-2",
								)}
							>
								{reel.caption}
							</p>
							{(clamped || expanded) && (
								<button
									type="button"
									onClick={() => setExpanded((v) => !v)}
									className="hand pointer-events-auto shrink-0 text-[0.78rem] text-white underline decoration-dashed underline-offset-4 transition-colors hover:decoration-solid"
								>
									{expanded ? "less" : "more"}
								</button>
							)}
						</div>
					)}
				</div>

				{/* ---------- how far through ---------- */}
				<div
					role="slider"
					tabIndex={reel.videoUrl ? 0 : -1}
					aria-label="Seek"
					aria-valuemin={0}
					aria-valuemax={Math.round(time.total)}
					aria-valuenow={Math.round(time.now)}
					aria-valuetext={`${clock(time.now)} of ${clock(time.total)}`}
					onPointerDown={(e) => {
						e.currentTarget.setPointerCapture(e.pointerId)
						seekTo(e.clientX, e.currentTarget)
					}}
					onPointerMove={(e) => {
						if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e.clientX, e.currentTarget)
					}}
					onKeyDown={(e) => {
						const el = video.current
						if (!el || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return
						// Claimed here so the page's own arrow-key navigation leaves it be.
						e.preventDefault()
						el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + (e.key === "ArrowRight" ? 5 : -5)))
					}}
					className="group/seek absolute inset-x-0 bottom-0 z-[5] flex h-3.5 cursor-pointer touch-none items-end focus-visible:outline-none"
				>
					<div className="relative h-[3px] w-full bg-white/25 transition-[height] duration-150 group-hover/seek:h-[5px] group-focus-visible/seek:h-[5px]">
						<div ref={fill} className="absolute inset-0 origin-left scale-x-0 bg-teal-mid" />
					</div>
				</div>
			</article>

			{/* ---------- the player ---------- */}
			{/* Sized by the reel column, not the window: as the column narrows,
          auto-scroll goes first and speed second; play, the clock and the
          sound always stay. */}
			<div className="@container mt-2.5 hidden h-10 shrink-0 items-center gap-2.5 text-navy md:flex">
				<RoundControl label={playing ? "Pause" : "Play"} onClick={toggle} disabled={!reel.videoUrl}>
					{playing ? <IconPause className="text-[1rem]" /> : <IconPlay className="ml-0.5 text-[1.05rem]" />}
				</RoundControl>
				<p className="hand text-[0.8rem] text-navy-soft tabular-nums">
					{clock(time.now)} / {clock(time.total)}
				</p>

				<div className="ml-auto flex items-center gap-2">
					<button
						type="button"
						role="switch"
						aria-checked={autoScroll}
						onClick={onToggleAutoScroll}
						title="Move on to the next reel when this one ends"
						className="hidden items-center gap-2 rounded-full py-1 pr-1 pl-1.5 transition-colors hover:bg-black/5 @xs:flex"
					>
						<span className="label text-navy-soft">Auto</span>
						<span
							aria-hidden="true"
							className={cx(
								"relative h-5 w-9 rounded-full border-2 transition-colors duration-200",
								autoScroll ? "border-teal-deep bg-teal" : "border-line-strong bg-paper",
							)}
						>
							<span
								className={cx(
									"absolute top-px left-px size-3.5 rounded-full transition-[transform,background-color] duration-200 ease-[cubic-bezier(.16,1,.3,1)]",
									autoScroll ? "translate-x-4 bg-white" : "bg-line-strong",
								)}
							/>
						</span>
					</button>
					<button
						type="button"
						onClick={onCycleRate}
						aria-label={`Playback speed ${rate} times. Change speed.`}
						className="label hidden min-w-[3rem] rounded-full bg-black/5 px-2.5 py-1.5 text-navy-soft tabular-nums transition-colors hover:bg-sky-pale hover:text-sky-ink @2xs:inline-block"
					>
						{rate.toFixed(1)}x
					</button>
					<RoundControl label={muted ? "Turn sound on" : "Mute"} onClick={onToggleMute} pressed={muted}>
						{muted ? <IconVolumeOff className="text-[1.1rem]" /> : <IconVolume className="text-[1.1rem]" />}
					</RoundControl>
				</div>
			</div>
		</div>
	)
}

/** A small drawn round button, the player strip's one control shape. */
function RoundControl({
	label,
	onClick,
	disabled,
	pressed,
	children,
}: {
	label: string
	onClick: () => void
	disabled?: boolean
	pressed?: boolean
	children: React.ReactNode
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			aria-pressed={pressed}
			className="sketch grid size-9 place-items-center rounded-full bg-paper text-navy transition-colors hover:bg-mint hover:text-teal-ink disabled:cursor-not-allowed disabled:text-navy-faint"
			style={{ "--sk-color": "var(--color-line-strong)", "--sk-radius": "999px" } as React.CSSProperties}
		>
			{children}
		</button>
	)
}
