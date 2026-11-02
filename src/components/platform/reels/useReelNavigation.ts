"use client"

import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useRef, useState } from "react"
import { prefersStill } from "@/lib/reduced-motion"

/**
 * The glide between reels: quick off the mark and settling into place, so the next reel arrives rather than appears. Long enough to read as one card handing over to the next, short enough that flicking through a dozen never feels like waiting on the page.
 */
const GLIDE_MS = 360
const glideEase = (t: number) => 1 - (1 - t) ** 4

/** How far a wheel has to travel, in pixels, before it counts as a flick. */
const WHEEL_FLICK = 24
/**
 * A trackpad keeps sending wheel events for a second or so after the fingers lift. One gesture is everything up to a gap this long, and it moves one reel however much momentum it carries – the way a swipe on a phone does.
 */
const WHEEL_GESTURE_GAP_MS = 180

/**
 * Whether `from` sits in something that scrolls vertically on its own, which a wheel over it should move rather than the reel. Whether or not it has hit its end: a list that suddenly changes the reel when you reach its bottom is a surprise, not a convenience.
 */
function scrollsItself(from: Element): boolean {
	for (let el: Element | null = from; el && el !== document.body; el = el.parentElement) {
		const { overflowY } = getComputedStyle(el)
		if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return true
	}
	return false
}

export interface ReelNavigation {
	index: number
	/** Scroll straight to a slide without gliding, for a resume landing. */
	landOnSlide(index: number): void
	/** Hand a slide element back for scroll focusing and landing. */
	registerSlide(index: number, element: HTMLElement | null): void
	scroller: RefObject<HTMLDivElement | null>
	/** Move the navigation cursor without gliding, for a resume landing. */
	setCursor(index: number): void
	setIndex: Dispatch<SetStateAction<number>>
	stage: RefObject<HTMLElement | null>
	step(dir: 1 | -1): void
}

/**
 * Moving one slide at a time: the scroll container, the hand-drawn glide, the wheel gesture and touch hand-off.
 *
 * Touch keeps the browser's own swipe: mandatory snap with `scroll-snap-stop` already moves one reel per flick with the platform's momentum, and nothing scripted feels as right under a thumb. Everything without a thumb – wheel, trackpad, arrow keys, the arrows on screen – goes through `step`, which glides exactly one reel and cannot be made to skip.
 */
export function useReelNavigation(last: number): ReelNavigation {
	const stage = useRef<HTMLElement>(null)
	const scroller = useRef<HTMLDivElement>(null)
	const slides = useRef<(HTMLElement | null)[]>([])
	const [index, setIndex] = useState(0)
	// The observer reports asynchronously, so two quick presses would both read the same stale index. Navigation moves this cursor immediately instead.
	const cursor = useRef(0)
	// The glide in progress, if any. While it runs the scroll position is ours, not the reader's, so the scroll handler leaves the cursor alone.
	const glide = useRef<number | null>(null)
	const registerSlide = useCallback((i: number, element: HTMLElement | null) => {
		slides.current[i] = element
	}, [])
	const landOnSlide = useCallback((i: number) => {
		const box = scroller.current
		const target = slides.current[i]
		if (box && target) box.scrollTop = target.offsetTop
	}, [])
	// A resume landing has already chosen its slide; it moves the cursor without gliding until the slides are back.
	const setCursor = useCallback((i: number) => {
		cursor.current = i
	}, [])

	// Animated by hand rather than with `behavior: "smooth"`: inside a mandatory-snap container the smooth form is dropped outright by some engines, which left the controls doing nothing at all. Snapping is lifted for the length of the glide – otherwise the container fights every frame back to the nearest slide – and restored once it lands on one.
	const glideTo = useCallback((to: number) => {
		const box = scroller.current
		if (!box) return
		if (glide.current !== null) cancelAnimationFrame(glide.current)
		const from = box.scrollTop
		if (prefersStill() || Math.abs(to - from) < 1) {
			glide.current = null
			box.style.scrollSnapType = ""
			box.scrollTop = to
			return
		}
		box.style.scrollSnapType = "none"
		const t0 = performance.now()
		const frame = (now: number) => {
			const t = Math.min(1, (now - t0) / GLIDE_MS)
			box.scrollTop = from + (to - from) * glideEase(t)
			if (t < 1) {
				glide.current = requestAnimationFrame(frame)
				return
			}
			glide.current = null
			box.style.scrollSnapType = ""
		}
		glide.current = requestAnimationFrame(frame)
	}, [])

	useEffect(
		() => () => {
			if (glide.current !== null) cancelAnimationFrame(glide.current)
		},
		[],
	)

	const goTo = useCallback(
		(i: number) => {
			const target = slides.current[i]
			if (!target) return
			cursor.current = i
			setIndex(i)
			glideTo(target.offsetTop)
		},
		[glideTo],
	)

	const step = useCallback(
		(dir: 1 | -1) => goTo(Math.max(0, Math.min(slides.current.length - 1, cursor.current + dir))),
		[goTo],
	)

	// Scrolling by hand is the other way the cursor moves. Every slide is exactly the height of the frame, so the scroll position is the index – no observer needed, and no threshold to get wrong.
	useEffect(() => {
		const box = scroller.current
		if (!box) return
		const onScroll = () => {
			if (glide.current !== null) return
			const n = Math.max(0, Math.min(last, Math.round(box.scrollTop / box.clientHeight)))
			if (n === cursor.current) return
			cursor.current = n
			setIndex(n)
		}
		// A thumb landing mid-glide takes over from it on the spot, rather than wrestling the animation for the next few frames.
		const onTouch = () => {
			if (glide.current === null) return
			cancelAnimationFrame(glide.current)
			glide.current = null
			box.style.scrollSnapType = ""
		}
		box.addEventListener("scroll", onScroll, { passive: true })
		box.addEventListener("touchstart", onTouch, { passive: true })
		return () => {
			box.removeEventListener("scroll", onScroll)
			box.removeEventListener("touchstart", onTouch)
		}
	}, [last])

	// One flick, one reel. Left to itself a mouse wheel lurches between snap points and a trackpad's momentum sails past three reels at once; taking the wheel over is what makes a desktop feel like a thumb on a phone. Heard on the whole window, not just the reel, so a flick anywhere on the page moves it – except over something that scrolls on its own.
	useEffect(() => {
		const box = stage.current
		if (!box) return
		let travelled = 0
		let spent = false
		let quiet = 0
		const onWheel = (e: WheelEvent) => {
			// Pinch-zoom arrives as a ctrl-wheel, and sideways is somebody else's.
			if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
			// The comments sheet or a checkpoint modal over the page has the wheel.
			if (document.querySelector("[role='dialog']")) return
			const target = e.target instanceof Element ? e.target : null
			// An opened caption scrolls itself.
			if (target?.closest("[data-own-scroll]")) return
			// Off the reel, anything with its own scroll keeps it: the comments beside the reel, a sidebar taller than the window.
			if (target && !box.contains(target) && scrollsItself(target)) return
			e.preventDefault()
			window.clearTimeout(quiet)
			quiet = window.setTimeout(() => {
				spent = false
				travelled = 0
			}, WHEEL_GESTURE_GAP_MS)
			if (spent) return
			// Line-mode wheels (Firefox on some mice) report lines, not pixels.
			travelled += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
			if (Math.abs(travelled) < WHEEL_FLICK) return
			spent = true
			step(travelled > 0 ? 1 : -1)
		}
		window.addEventListener("wheel", onWheel, { passive: false })
		return () => {
			window.removeEventListener("wheel", onWheel)
			window.clearTimeout(quiet)
		}
	}, [step])

	return { index, landOnSlide, registerSlide, scroller, setCursor, setIndex, stage, step }
}
