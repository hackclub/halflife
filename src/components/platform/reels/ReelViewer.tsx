"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { IconVolumeOff } from "@/components/platform/icons"
import type { FeedItem } from "@/lib/feed"
import { useStore } from "@/lib/store"
import { type FeedPosition, readPosition, savePosition } from "./feedPosition"
import { ReelActions } from "./ReelActions"
import { ReelCommentsPanel } from "./ReelCommentsPanel"
import { type SlideHandle, StageSlide } from "./StageSlide"
import { useFeed } from "./useFeed"
import { RATES, usePlayerPrefs } from "./usePlayerPrefs"
import { useReelNavigation } from "./useReelNavigation"

/** How close to the end of what is loaded the next page is asked for. */
const PREFETCH_AHEAD = 3

/**
 * How many pages deep to look for where the viewer left off today before giving up and starting at the top – about a hundred reels, which is more than a day of the program posts.
 */
const RESUME_MAX_PAGES = 8

/**
 * Slides this far either side of the current one are real players; the rest are empty frames of the same height. A feed that has paged in sixty reels then holds five video elements, not sixty.
 */
const MOUNTED_EITHER_SIDE = 2

/** Where the comments stop being a column beside the reel and become a sheet over it. */
const COMMENTS_BESIDE = "(min-width: 80rem)"

/**
 * The Doomscroller: one reel at a time, as a page of the platform.
 *
 * Laid out after the reel player people already know – the reel in a tall column with its player underneath, the arrows and the actions beside it, and the conversation in a panel alongside – but drawn in the field notebook's hand: cream ground, drawn round buttons, paper panels. What is on a slide moves with the slide when you scroll; the actions stay where your hand is and change to the reel in front of you.
 *
 * Touch keeps the browser's own swipe: mandatory snap with `scroll-snap-stop` already moves one reel per flick with the platform's momentum, and nothing scripted feels as right under a thumb. Everything without a thumb – wheel, trackpad, arrow keys, the arrows on screen – goes through `step`, which glides exactly one reel and cannot be made to skip.
 */
export function ReelViewer() {
	const { viewer } = useStore()

	const [prefs, setPrefs] = usePlayerPrefs()
	// Muted because the browser refused sound, as opposed to by choice. Kept apart so a refusal on one visit is not remembered as a preference.
	const [autoMuted, setAutoMuted] = useState(false)
	const muted = prefs.muted || autoMuted
	const [sheetOpen, setSheetOpen] = useState(false)
	// Kept mounted through the slide down, so it does not empty as it goes.
	const [sheetShown, setSheetShown] = useState(false)
	// A card's comments link asks for the conversation once its reel has landed.
	const [pendingComments, setPendingComments] = useState(false)
	// The reel a card's link asked for, and whether that link wanted the comments. Read from the URL once, after mount, so the walk below knows to go to it rather than to wherever the viewer left off.
	const deepLink = useRef<{ id: string; comments: boolean } | null>(null)
	// Whether the comments have room to stand beside the reel. Only one of the two homes for them is ever mounted, so only one ever fetches.
	const [wide, setWide] = useState(false)
	useEffect(() => {
		const mq = window.matchMedia(COMMENTS_BESIDE)
		const sync = () => setWide(mq.matches)
		sync()
		mq.addEventListener("change", sync)
		return () => mq.removeEventListener("change", sync)
	}, [])
	// The current slide's own controls, for the keyboard.
	const active = useRef<SlideHandle | null>(null)
	const register = useCallback((handle: SlideHandle | null) => {
		active.current = handle
	}, [])
	const onAutoMuted = useCallback(() => setAutoMuted(true), [])

	const feed = useFeed()
	// Where this viewer left off today: undefined until storage has been read, then the reel being walked to, then null once they are on it (or it could not be found). Until then the frame shows the loading shape, so the top reel does not start playing on the way down to theirs.
	const [resume, setResume] = useState<FeedPosition | null | undefined>(undefined)
	const restoring = resume !== null
	const resumePages = useRef(0)
	// The slide to land on once the walk ends and the slides are back.
	const landOn = useRef<number | null>(null)
	// The reels plus the slide at the end: the sign-off, or "loading more".
	const last = feed.items.length
	const { index, landOnSlide, registerSlide, scroller, setCursor, setIndex, stage, step } = useReelNavigation(last)
	const current: FeedItem | undefined = restoring ? undefined : feed.items[index]

	// Where to land after mount. A reel card's link carries a reel id, which wins over the saved position; otherwise it is wherever they left off. Storage after mount, because the server has none and rendered without it.
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		const id = params.get("reel")
		if (id) {
			deepLink.current = { comments: params.get("comments") === "1", id }
			// reading the URL after mount
			setResume({ id, leadIds: [] })
			return
		}
		setResume(readPosition())
	}, [])

	// Walk the feed down to the saved reel, a page at a time.
	const { done, error, handleMore, items, leading, loading } = feed
	useEffect(() => {
		if (!resume || loading) return
		// A link goes straight to its reel; the unseen-admin-reel rule below is for picking up where someone left off, not for following a card.
		const isDeep = deepLink.current !== null
		// An admin reel they have not been shown yet goes first, exactly as it would on a fresh visit; picking up where they left off can wait.
		const unseenLead = isDeep ? false : leading.some(r => !resume.leadIds.includes(r.id))
		const at = unseenLead ? -1 : items.findIndex(r => r.id === resume.id)
		if (at >= 0) {
			landOn.current = at
			setCursor(at)
			setIndex(at)
			if (isDeep && deepLink.current?.comments) setPendingComments(true)
			setResume(null)
		} else if (!unseenLead && !done && !error && resumePages.current < RESUME_MAX_PAGES) {
			resumePages.current += 1
			handleMore()
		}
		// Deleted, hidden, or further back than it is worth walking: the top.
		else setResume(null)
	}, [resume, loading, items, leading, done, error, handleMore])

	// A card's comments link opens the conversation once its reel has landed. Wide, that is the panel beside the reel; below it, the sheet over it.
	useEffect(() => {
		if (!pendingComments || restoring) return
		if (wide) setPrefs({ comments: true })
		else {
			// a deep link asks for the comments once
			setSheetShown(true)
			setSheetOpen(true)
		}
		setPendingComments(false)
	}, [pendingComments, restoring, wide, setPrefs])

	// Before paint, so the first frame with slides in it is already theirs.
	useLayoutEffect(() => {
		if (restoring || landOn.current === null) return
		const at = landOn.current
		landOn.current = null
		landOnSlide(at)
	}, [restoring, landOnSlide])

	// Remembered as they go, not on leaving: a closed tab gets no last word.
	const currentId = current?.id
	useEffect(() => {
		if (currentId) savePosition({ id: currentId, leadIds: leading.map(r => r.id) })
	}, [currentId, leading])

	// Endless, the way a reel feed is: the next page is asked for a few reels before the end, so the reader scrolls into it rather than up to a wall.
	useEffect(() => {
		if (!done && !loading && !error && last > 0 && index >= last - PREFETCH_AHEAD) handleMore()
	}, [index, last, done, loading, error, handleMore])

	const toggleMute = useCallback(() => {
		if (muted) {
			setAutoMuted(false)
			setPrefs({ muted: false })
		} else setPrefs({ muted: true })
	}, [muted, setPrefs])

	const openComments = useCallback(() => {
		if (wide) {
			setPrefs({ comments: !prefs.comments })
			return
		}
		setSheetShown(true)
		setSheetOpen(true)
	}, [wide, prefs.comments, setPrefs])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
			if (e.key === "Escape" && sheetOpen) {
				setSheetOpen(false)
				return
			}
			// A checkpoint modal can open over any route, and typing is typing.
			if (document.querySelector("[role='dialog']")) return
			const el = e.target
			if (el instanceof Element && el.closest("input, textarea, select, [contenteditable='true']")) return

			// Space is a button's own key when one has focus; anywhere else it is the player's.
			if (e.key === " " && !(el instanceof Element && el.closest("button, a, [role='slider']"))) {
				e.preventDefault()
				active.current?.toggle()
				return
			}
			if (e.key === "m" || e.key === "M") {
				toggleMute()
				return
			}

			const back = e.key === "ArrowUp" || e.key === "ArrowLeft"
			const fwd = e.key === "ArrowDown" || e.key === "ArrowRight"
			if (!back && !fwd) return
			e.preventDefault()
			step(fwd ? 1 : -1)
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [step, toggleMute, sheetOpen])

	const cycleRate = useCallback(() => {
		const at = RATES.indexOf(prefs.rate)
		setPrefs({ rate: RATES[(at + 1) % RATES.length] ?? 1 })
	}, [prefs.rate, setPrefs])
	const toggleAutoScroll = useCallback(() => setPrefs({ autoScroll: !prefs.autoScroll }), [prefs.autoScroll, setPrefs])
	const advance = useCallback(() => step(1), [step])

	const commentsBeside = wide && prefs.comments && current !== undefined

	return (
		// The frame is the viewport minus the app header and the bottom padding main already reserves for the phone tab bar – the Doomscroller is a page of the platform, and the rest of the platform stays around it.
		<div className="flex h-[var(--frame)] justify-center gap-6 px-4 [--frame:calc(100dvh-4rem-7rem)] sm:px-6 lg:[--frame:calc(100dvh-4rem-2.5rem)]">
			<section
				aria-label="Reels"
				// A reel is portrait, so the column is only ever as wide as a 9:16 card fits in the frame, less the player strip under it. From md the actions hang off its right side, so that much room is kept for them.
				className="doom-stage relative h-full w-[min(100%,26rem,calc((var(--frame)-4.25rem)*9/16))] shrink-0 md:mr-19 md:w-[min(26rem,calc((var(--frame)-4.25rem)*9/16))]"
				ref={stage}
			>
				<div
					className="snap-y-feed no-scrollbar h-full overflow-y-auto overscroll-contain"
					ref={scroller}
					// `overflow-anchor: none` because the end slide renders before the next page arrives, and the reels are then inserted ABOVE it. Scroll anchoring reads that as content growing over the reader and holds their position – which meant landing on "that is everything" instead of the newest reel, with the feed sitting unseen above it.
					style={{ overflowAnchor: "none" }}
				>
					{(restoring ? [] : feed.items).map((reel, i) => (
						<div
							aria-hidden={i !== index || undefined}
							className="snap-item h-full"
							data-slide={i}
							inert={i !== index}
							key={reel.id}
							ref={el => {
								registerSlide(i, el)
							}}
						>
							{Math.abs(i - index) <= MOUNTED_EITHER_SIDE ? (
								<StageSlide
									active={i === index}
									autoScroll={prefs.autoScroll}
									muted={muted}
									onAutoMuted={onAutoMuted}
									onCycleRate={cycleRate}
									onEnded={advance}
									onPatch={feed.handlePatch}
									onToggleAutoScroll={toggleAutoScroll}
									onToggleMute={toggleMute}
									rate={prefs.rate}
									reel={reel}
									register={register}
								/>
							) : null}
						</div>
					))}

					{/* Only once there is something to be at the end OF. Rendering it while the first page is still in the air is what let the reels arrive above the reader. After that it is always there: the sign-off once the feed has run out, and until then the slot the next page arrives into – anyone who outruns the prefetch lands here, and the next reel slides in where they already are. */}
					{!restoring && (feed.items.length > 0 || !feed.loading) && (
						<div
							className="snap-item flex h-full flex-col items-center justify-center gap-2 py-3 text-center"
							data-slide={last}
							ref={el => {
								registerSlide(last, el)
							}}
						>
							{feed.error ? (
								<>
									<p className="hand text-[1.05rem] text-coral-deep">{feed.error}</p>
									<button
										className="label mt-1 rounded-full border-2 border-line px-4 py-2 text-navy-soft transition-colors hover:border-navy hover:text-navy"
										onClick={feed.handleMore}
										type="button"
									>
										Try again
									</button>
								</>
							) : !feed.done ? (
								<p className="hand text-[0.95rem] text-navy-soft motion-safe:animate-pulse">loading more reels…</p>
							) : (
								<>
									<p className="hand text-[1.05rem] text-navy">
										{feed.items.length === 0 ? "nothing here yet." : "that's everything!"}
									</p>
									<p className="hand text-[0.9rem] text-navy-soft">
										{feed.items.length === 0 ? "post the first reel." : "now it's your turn go build something"}
									</p>
								</>
							)}
						</div>
					)}

					{/* The first page in the air: the shape of a reel, not an end slide. */}
					{(restoring || (feed.items.length === 0 && feed.loading)) && (
						<div className="flex h-full flex-col py-3">
							<span className="min-h-0 flex-1 rounded-2xl bg-black/[.06] motion-safe:animate-pulse" />
							<span className="mt-2.5 hidden h-10 md:block" />
						</div>
					)}
				</div>

				{/* The browser refused sound on arrival. One tap is the permission it wanted, so the offer is the whole fix. It speaks the way the trail's "Start here" callout does. */}
				{autoMuted && !prefs.muted && current && (
					<button
						className="sketch label absolute top-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-navy px-3.5 py-2 whitespace-nowrap text-white transition-transform hover:scale-[1.03] motion-safe:animate-[hl-pop_320ms_cubic-bezier(.16,1,.3,1)]"
						onClick={toggleMute}
						style={{ "--sk-color": "var(--color-navy)", "--sk-radius": "14px" }}
						type="button"
					>
						<IconVolumeOff className="text-[1rem]" /> Tap for sound
					</button>
				)}

				{/* ---------- what stays put ---------- */}
				{/* Hugging the reel rather than the page edge, so the actions read as belonging to it. Over the picture on a phone, where there is no room beside it – white, as on the rail's card. */}
				{current && (
					<ReelActions
						commentsBeside={commentsBeside}
						current={current}
						index={index}
						last={last}
						onComments={openComments}
						onPatch={feed.handlePatch}
						onStep={step}
						sheetOpen={sheetOpen}
						viewerId={viewer.id}
					/>
				)}
			</section>

			<ReelCommentsPanel
				beside={commentsBeside}
				current={current}
				onBesideClose={() => setPrefs({ comments: false })}
				onPatch={feed.handlePatch}
				onSheetClose={() => setSheetOpen(false)}
				onSheetExited={() => setSheetShown(false)}
				sheetOpen={sheetOpen}
				sheetShown={sheetShown}
				viewer={viewer}
			/>
		</div>
	)
}
