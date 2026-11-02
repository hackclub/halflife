"use client"

import Link from "next/link"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Gato } from "@/components/platform/art"
import { IconFilm, IconPlay, IconVolume, IconVolumeOff } from "@/components/platform/icons"
import { cx } from "@/lib/cx"
import type { FeedItem } from "@/lib/feed"
import { prefersStill } from "@/lib/reduced-motion"
import { ago, clock } from "./format"
import { sendLike } from "./ReelCard"
import { StagePlayer } from "./StagePlayer"
import { useSlidePlayer } from "./useSlidePlayer"

/** Two taps closer together than this, and near enough each other, are one like. */
const DOUBLE_TAP_MS = 280
const DOUBLE_TAP_PX = 44

/** A heart, drawn once as markup: it is stamped into the burst layer by hand. */
const HEART_SVG =
	'<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="M12 21s-8.6-5-8.6-10.6A4.8 4.8 0 0 1 12 7.8a4.8 4.8 0 0 1 8.6 2.6C20.6 16 12 21 12 21Z" fill="currentColor" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>'

export interface SlideHandle {
	toggle(): void
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
	onAutoMuted(): void
	onToggleMute(): void
	onCycleRate(): void
	onToggleAutoScroll(): void
	/** Reached the end with auto scroll on. */
	onEnded(): void
	onPatch(id: string, next: Partial<FeedItem>): void
	/** Hands the page this slide's controls while it is the current one. */
	register(handle: SlideHandle | null): void
}) {
	const bursts = useRef<HTMLDivElement>(null)
	const caption = useRef<HTMLParagraphElement>(null)
	const [expanded, setExpanded] = useState(false)
	const [clamped, setClamped] = useState(false)
	const tap = useRef<{ t: number; x: number; y: number } | null>(null)
	const pendingToggle = useRef(0)
	const player = useSlidePlayer({ active, muted, onAutoMuted, rate, reel, register })
	const { fill, playing, time, toggle, video } = player

	const announcement = reel.pinned || reel.kind === "ANNOUNCEMENT"
	// Portrait fills the card edge to edge; anything wider is letterboxed in it, so a landscape clip is shown whole rather than cropped to a strip.
	const portrait = !reel.width || !reel.height || reel.height >= reel.width

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
		host.append(heart)
		const at = (lift: number, scale: number) =>
			`translate(-50%, calc(-50% - ${lift}px)) rotate(${tilt}deg) scale(${scale})`
		void (async () => {
			try {
				await heart
					.animate(
						[
							{ opacity: 0, transform: at(0, 0.3) },
							{ offset: 0.16, opacity: 1, transform: at(0, 1.18) },
							{ offset: 0.3, opacity: 1, transform: at(0, 0.94) },
							{ offset: 0.55, opacity: 1, transform: at(0, 1) },
							{ opacity: 0, transform: at(80, 1.3) },
						],
						{ duration: 900, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
					)
					.finished.catch(() => undefined)
			} finally {
				heart.remove()
			}
		})()
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

	const who = reel.author.name ?? "A maker"

	return (
		<div className="flex h-full flex-col py-3">
			{/* ---------- the reel ---------- */}
			<article className="lift-shadow relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-navy">
				{reel.videoUrl ? (
					// biome-ignore lint/a11y/useMediaCaption: a participant upload, and there is no caption file to point a track at. An empty track is announced as an empty caption, which is worse than none.
					<video
						className={cx("absolute inset-0 size-full", portrait ? "object-cover" : "object-contain")}
						loop={!autoScroll}
						onEnded={() => {
							if (autoScroll && active) onEnded()
						}}
						onLoadedMetadata={player.handleLoadedMetadata}
						onPause={player.handlePause}
						onPlay={player.handlePlay}
						onTimeUpdate={player.handleTime}
						playsInline
						poster={reel.thumbnailUrl ?? undefined}
						// The reel on screen is worth buffering ahead; its mounted neighbours fetch just enough to show a first frame, which is what makes a swipe land on a picture rather than a blank card.
						preload={active ? "auto" : "metadata"}
						ref={video}
						src={reel.thumbnailUrl ? reel.videoUrl : `${reel.videoUrl}#t=0.1`}
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
					aria-label={`${playing ? "Pause" : "Play"} reel by ${who}. Double-tap to like.`}
					className="absolute inset-0 z-[1] touch-manipulation focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sky focus-visible:ring-inset"
					disabled={!reel.videoUrl}
					onClick={onSurfaceClick}
					type="button"
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

				<div aria-hidden="true" className="pointer-events-none absolute inset-0 z-[3] overflow-hidden" ref={bursts} />

				{/* The project on a tag in the corner, as on the rail's card. */}
				{announcement ? (
					<span className="label absolute top-3 left-3 z-[4] flex items-center gap-1.5 rounded-2xl bg-coral px-2.5 py-1 text-white">
						<Gato className="h-auto w-4" sizes="28px" />
						From HQ
					</span>
				) : reel.project ? (
					<Link
						className="label absolute top-3 left-3 z-[4] max-w-[calc(100%-4.5rem)] truncate rounded-2xl bg-black/45 px-2.5 py-1 leading-[1.2] text-white backdrop-blur-sm transition-[background-color,transform] duration-150 hover:bg-black/60 active:translate-y-px md:max-w-[calc(100%-1.5rem)]"
						href={`/projects/${reel.project.id}`}
					>
						{reel.project.title || reel.project.theme}
					</Link>
				) : null}

				{/* On a phone there is no player strip, so the sound lives up here. */}
				<button
					aria-label={muted ? "Turn sound on" : "Mute"}
					aria-pressed={muted}
					className="absolute top-2.5 right-2.5 z-[4] grid size-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60 md:hidden"
					onClick={onToggleMute}
					type="button"
				>
					{muted ? <IconVolumeOff className="text-[1.15rem]" /> : <IconVolume className="text-[1.15rem]" />}
				</button>

				{/* ---------- who, and what they said ---------- */}
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-[4] bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3.5 pt-12 pb-4 pr-17 md:pr-3.5">
					<p className="flex min-w-0 items-baseline gap-1.5 leading-tight text-white">
						{/* The name is the way to the poster's profile, so it takes clicks back from the surface that pauses and likes; the timestamp and the caption stay inert over the picture. */}
						<Link
							className="pointer-events-auto min-w-0 truncate text-[0.9rem] font-extrabold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.6)] hover:underline hover:decoration-dashed hover:underline-offset-4"
							href={`/u/${reel.author.id}`}
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
								className={cx(
									"min-w-0 flex-1 text-[0.8rem] leading-snug whitespace-pre-line [overflow-wrap:anywhere] text-white/90",
									// Two lines, always: the clamp draws the ellipsis, and the height is a hard second line's worth so a browser that ignores `-webkit-line-clamp` still cuts the caption off rather than letting it run over the video.
									expanded ? "thin-scroll max-h-[34vh] overflow-y-auto" : "line-clamp-2 max-h-[2.75em] overflow-hidden",
								)}
								// Opened, the caption can outgrow its space and scrolls itself; the page's wheel handler leaves anything marked so alone.
								data-own-scroll={expanded || undefined}
								ref={caption}
							>
								{reel.caption}
							</p>
							{(clamped || expanded) && (
								<button
									className="hand pointer-events-auto shrink-0 text-[0.78rem] text-white underline decoration-dashed underline-offset-4 transition-colors hover:decoration-solid"
									onClick={() => setExpanded(v => !v)}
									type="button"
								>
									{expanded ? "less" : "more"}
								</button>
							)}
						</div>
					)}
				</div>

				{/* ---------- how far through ---------- */}
				<div
					aria-label="Seek"
					aria-valuemax={Math.round(time.total)}
					aria-valuemin={0}
					aria-valuenow={Math.round(time.now)}
					aria-valuetext={`${clock(time.now)} of ${clock(time.total)}`}
					className="group/seek absolute inset-x-0 bottom-0 z-[5] flex h-3.5 cursor-pointer touch-none items-end focus-visible:outline-none"
					onKeyDown={e => {
						const el = video.current
						if (!el || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return
						// Claimed here so the page's own arrow-key navigation leaves it be.
						e.preventDefault()
						el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + (e.key === "ArrowRight" ? 5 : -5)))
					}}
					onPointerDown={e => {
						e.currentTarget.setPointerCapture(e.pointerId)
						player.seekTo(e.clientX, e.currentTarget)
					}}
					onPointerMove={e => {
						if (e.currentTarget.hasPointerCapture(e.pointerId)) player.seekTo(e.clientX, e.currentTarget)
					}}
					role="slider"
					tabIndex={reel.videoUrl ? 0 : -1}
				>
					<div className="relative h-[3px] w-full bg-white/25 transition-[height] duration-150 group-hover/seek:h-[5px] group-focus-visible/seek:h-[5px]">
						<div className="absolute inset-0 origin-left scale-x-0 bg-teal-mid" ref={fill} />
					</div>
				</div>
			</article>

			{/* ---------- the player ---------- */}
			<StagePlayer
				autoScroll={autoScroll}
				hasVideo={Boolean(reel.videoUrl)}
				muted={muted}
				onCycleRate={onCycleRate}
				onToggleAutoScroll={onToggleAutoScroll}
				onToggleMute={onToggleMute}
				player={player}
				rate={rate}
			/>
		</div>
	)
}
