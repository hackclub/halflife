"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { IconArrowRight } from "@/components/platform/icons"
import { Button, cx } from "@/components/platform/ui"

export interface Rect {
	top: number
	left: number
	width: number
	height: number
}

function firstVisible(selector: string): HTMLElement | null {
	if (!selector) return null
	const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector))
	return nodes.find((n) => n.getBoundingClientRect().width > 0) ?? null
}

const same = (a: Rect | null, b: Rect | null) =>
	a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

/**
 * The line drawn between a step's two targets, from the near edge of one to the
 * near edge of the other. It leaves and arrives horizontally whichever way it
 * is going, so the curve reads as a route across the screen rather than a
 * diagonal someone forgot to straighten.
 */
function tether(a: Rect, b: Rect) {
	const rightward = b.left + b.width / 2 >= a.left + a.width / 2
	const from = { x: rightward ? a.left + a.width : a.left, y: a.top + a.height / 2 }
	const to = { x: rightward ? b.left : b.left + b.width, y: b.top + b.height / 2 }
	const bend = (to.x - from.x) * 0.5
	return {
		d: `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`,
		from,
		to,
	}
}

/**
 * Cuts holes in a dimmed overlay around live elements and parks a coach card
 * beside the first of them. The highlight never takes pointer events, so the
 * element underneath stays clickable when the step asks the user to act on it.
 *
 * `also` is what makes this more than one hole. A step that names a control and
 * the thing that control opens has to point at both at once, or the reader has
 * to take the relationship on trust – so the dim layer is an SVG mask rather
 * than the usual ring of box-shadow, which can only ever punch one hole.
 *
 * The second window does not simply appear. The card and the first window land,
 * a dashed line wipes across to the second, and only then does it open, so the
 * three parts read in the order the sentence does. `also` is optional at every
 * breakpoint: where the second target is not on screen, the step quietly
 * becomes an ordinary one-target step.
 */
export function Spotlight({
	selector,
	also,
	title,
	body,
	cta,
	onNext,
	onSkip,
	step,
	total,
	clickAnywhere = false,
	pad = 10,
	radius = 20,
}: {
	selector: string
	also?: string
	title: string
	body: string
	cta?: string
	onNext: () => void
	onSkip?: () => void
	step?: number
	total?: number
	clickAnywhere?: boolean
	pad?: number
	radius?: number
}) {
	const [rect, setRect] = useState<Rect | null>(null)
	const [alsoRect, setAlsoRect] = useState<Rect | null>(null)
	const [travelling, setTravelling] = useState(false)
	const [revealed, setRevealed] = useState(false)
	const raf = useRef(0)
	const until = useRef(0)
	const placed = useRef(false)
	const uid = useId().replace(/:/g, "")

	const measure = useCallback(() => {
		const el = firstVisible(selector)
		// Hold the last known position rather than blanking: a step whose target is
		// missing at this breakpoint should not make the highlight disappear and
		// re-enter, it should just stay put.
		if (el) {
			const r = el.getBoundingClientRect()
			const next = {
				top: Math.round(r.top - pad),
				left: Math.round(r.left - pad),
				width: Math.round(r.width + pad * 2),
				height: Math.round(r.height + pad * 2),
			}
			setRect((prev) => (same(prev, next) ? prev : next))
		}

		// The second target is cleared when it goes, unlike the first. It is a
		// panel that can be closed and a rail that disappears with the viewport,
		// so a stale hole would sit over live page rather than over the thing it
		// was cut for.
		const other = also ? firstVisible(also) : null
		if (!other) {
			setAlsoRect((prev) => (prev === null ? prev : null))
			return
		}
		const r = other.getBoundingClientRect()
		const next = {
			top: Math.round(r.top - pad),
			left: Math.round(r.left - pad),
			width: Math.round(r.width + pad * 2),
			height: Math.round(r.height + pad * 2),
		}
		setAlsoRect((prev) => (same(prev, next) ? prev : next))
	}, [selector, also, pad])

	/**
	 * Follow the target for a bounded window rather than forever. A permanent
	 * measure loop re-triggers the CSS transition on every frame, which pins it
	 * at time zero and leaves the highlight stranded between two steps.
	 */
	const follow = useCallback(() => {
		until.current = performance.now() + 900
		if (raf.current) return
		const loop = (now: number) => {
			measure()
			raf.current = now < until.current ? window.requestAnimationFrame(loop) : 0
		}
		raf.current = window.requestAnimationFrame(loop)
	}, [measure])

	useEffect(() => {
		firstVisible(selector)?.scrollIntoView({ block: "center", behavior: "smooth" })
		follow()
		const onMove = () => follow()
		window.addEventListener("scroll", onMove, true)
		window.addEventListener("resize", onMove)
		return () => {
			window.removeEventListener("scroll", onMove, true)
			window.removeEventListener("resize", onMove)
			window.cancelAnimationFrame(raf.current)
			raf.current = 0
		}
	}, [selector, follow])

	// The first position is placed without a transition; every step after that
	// travels from wherever the highlight already is, so the eye can follow it.
	useEffect(() => {
		if (!rect || placed.current) return
		placed.current = true
		const id = window.requestAnimationFrame(() => setTravelling(true))
		return () => window.cancelAnimationFrame(id)
	}, [rect])

	// The second window is closed for one frame after its target is found, so
	// the line has something to draw towards and the opening has somewhere to
	// open from. It closes again the moment the target goes.
	// Presence, not position. The measured rect is a new object on every frame
	// the target moves, and an effect keyed on it would cancel its own pending
	// frame for as long as the page was still settling – which is exactly the
	// window the reveal is supposed to run in, so it could be starved outright.
	const hasAlso = alsoRect !== null

	useEffect(() => {
		// A frame late on purpose, both ways: the closed geometry has to be
		// committed before the open geometry can transition away from it.
		const id = window.requestAnimationFrame(() => setRevealed(hasAlso))
		return () => window.cancelAnimationFrame(id)
	}, [hasAlso])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && onSkip) onSkip()

			// The tour's click-anywhere shortcut is a background affordance. It must
			// not steal Enter from a textarea (it should insert a newline) or from a
			// button (the browser should activate that button normally).
			const target = e.target
			if (
				target instanceof HTMLElement &&
				target.closest("a, button, input, textarea, select, [contenteditable='true']")
			) {
				return
			}

			if ((e.key === "Enter" || e.key === " ") && clickAnywhere) {
				e.preventDefault()
				onNext()
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [onNext, onSkip, clickAnywhere])

	const vw = typeof window === "undefined" ? 1200 : window.innerWidth
	const vh = typeof window === "undefined" ? 800 : window.innerHeight

	// Park the card on whichever side actually has room. A tall target (the feed
	// rail) gets the card beside it; a wide one gets it above or below. It reads
	// only the first target: on a two-target step the card belongs with the
	// control being named, at the near end of the line rather than straddling it.
	const cardW = Math.min(340, vw - 32)
	const cardH = 190
	const gap = 14
	const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

	let cardTop: number
	let cardLeft: number

	if (!rect) {
		// Target not on screen at this breakpoint – still show the card so the
		// tour can be finished rather than trapping the user behind a dim layer.
		cardLeft = clamp(vw / 2 - cardW / 2, 16, vw - cardW - 16)
		cardTop = vh - cardH - 32
	} else if (rect.top + rect.height + gap + cardH < vh) {
		cardTop = rect.top + rect.height + gap
		cardLeft = clamp(rect.left + rect.width / 2 - cardW / 2, 16, vw - cardW - 16)
	} else if (rect.top - gap - cardH > 0) {
		cardTop = rect.top - gap - cardH
		cardLeft = clamp(rect.left + rect.width / 2 - cardW / 2, 16, vw - cardW - 16)
	} else if (rect.left - gap - cardW > 0) {
		cardLeft = rect.left - gap - cardW
		cardTop = clamp(rect.top + rect.height / 2 - cardH / 2, 16, vh - cardH - 16)
	} else if (rect.left + rect.width + gap + cardW < vw) {
		cardLeft = rect.left + rect.width + gap
		cardTop = clamp(rect.top + rect.height / 2 - cardH / 2, 16, vh - cardH - 16)
	} else {
		cardLeft = clamp(rect.left + rect.width / 2 - cardW / 2, 16, vw - cardW - 16)
		cardTop = vh - cardH - 24
	}

	const EASE = "cubic-bezier(.16,1,.3,1)"
	const line = rect && alsoRect ? tether(rect, alsoRect) : null

	// Position moves on transform, which every engine animates on SVG; only the
	// size rides the geometry properties. Where those are not animated the window
	// still glides to its target and only snaps its dimensions.
	const travel = travelling ? `transform 520ms ${EASE}, width 520ms ${EASE}, height 520ms ${EASE}` : undefined

	// Closed, the second window is a point at the middle of where it will be, so
	// it opens outward from its own centre instead of unrolling from a corner.
	const opening = (r: Rect) =>
		revealed
			? { transform: `translate(${r.left}px, ${r.top}px)`, width: r.width, height: r.height }
			: {
					transform: `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px)`,
					width: 0,
					height: 0,
				}

	const open = `transform 420ms 760ms ${EASE}, width 420ms 760ms ${EASE}, height 420ms 760ms ${EASE}`

	// The line is a dashed marker stroke revealed by a wipe rather than by a
	// marching dash pattern, so it reads as being drawn rather than as traffic.
	const wipe = line
		? {
				x: Math.min(line.from.x, line.to.x) - 6,
				y: Math.min(line.from.y, line.to.y) - 8,
				w: Math.abs(line.to.x - line.from.x) + 12,
				h: Math.abs(line.to.y - line.from.y) + 16,
				// The left edge the wipe starts from, kept on the object so the
				// render does not have to reach back through a nullable `line`.
				startX: line.from.x - 6,
			}
		: null

	return (
		<div className="pointer-events-none fixed inset-0 z-[80]">
			{clickAnywhere && (
				<button
					type="button"
					aria-label="Next"
					onClick={onNext}
					className="pointer-events-auto absolute inset-0 cursor-pointer"
				/>
			)}

			<svg
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 h-full w-full"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<mask id={`${uid}-holes`}>
						<rect x={0} y={0} width="100%" height="100%" fill="white" />
						{rect && (
							<rect
								x={0}
								y={0}
								rx={radius}
								width={rect.width}
								height={rect.height}
								fill="black"
								style={{ transform: `translate(${rect.left}px, ${rect.top}px)`, transition: travel }}
							/>
						)}
						{alsoRect && (
							<rect x={0} y={0} rx={radius} fill="black" style={{ ...opening(alsoRect), transition: open }} />
						)}
					</mask>

					{wipe && (
						<mask id={`${uid}-wipe`}>
							<rect
								x={0}
								y={wipe.y}
								height={wipe.h}
								width={revealed ? wipe.w : 0}
								fill="white"
								style={{
									transform: `translate(${revealed ? wipe.x : wipe.startX}px, 0)`,
									transition: `transform 620ms 220ms ${EASE}, width 620ms 220ms ${EASE}`,
								}}
							/>
						</mask>
					)}
				</defs>

				<rect
					x={0}
					y={0}
					width="100%"
					height="100%"
					fill="rgba(19,17,62,.62)"
					mask={rect ? `url(#${uid}-holes)` : undefined}
				/>

				{line && (
					<path
						d={line.d}
						fill="none"
						stroke="rgba(255,255,255,.78)"
						strokeWidth={2.5}
						strokeLinecap="round"
						strokeDasharray="7 6"
						mask={`url(#${uid}-wipe)`}
					/>
				)}

				{rect && (
					<rect
						x={0}
						y={0}
						rx={radius}
						width={rect.width}
						height={rect.height}
						fill="none"
						stroke="rgba(255,255,255,.9)"
						strokeWidth={3}
						strokeDasharray="9 7"
						style={{ transform: `translate(${rect.left}px, ${rect.top}px)`, transition: travel }}
					/>
				)}

				{alsoRect && (
					<rect
						x={0}
						y={0}
						rx={radius}
						fill="none"
						stroke="rgba(255,255,255,.9)"
						strokeWidth={3}
						strokeDasharray="9 7"
						style={{ ...opening(alsoRect), transition: open }}
					/>
				)}
			</svg>

			<div
				role="dialog"
				aria-label={title}
				className={cx(
					"sketch sketch-2 pointer-events-auto absolute rounded-2xl bg-cream p-4 lift-shadow",
					travelling
						? "transition-[top,left,width] duration-[520ms] ease-[cubic-bezier(.16,1,.3,1)]"
						: "motion-safe:animate-[hl-pop_.36s_cubic-bezier(.16,1,.3,1)]",
				)}
				style={
					{
						top: cardTop,
						left: cardLeft,
						width: cardW,
						"--sk-color": "var(--color-gold-deep)",
						"--sk-radius": "18px",
					} as React.CSSProperties
				}
			>
				<div key={title} className="motion-safe:animate-[hl-rise_.4s_.12s_cubic-bezier(.16,1,.3,1)_both]">
					{typeof step === "number" && typeof total === "number" && (
						<p className="label mb-1.5 text-gold-ink">
							Tour {step}/{total}
						</p>
					)}
					<p className="text-[1.05rem] leading-tight font-extrabold text-navy">{title}</p>
					<p className="mt-1.5 text-[0.86rem] leading-snug text-navy-soft">{body}</p>
				</div>
				<div className="mt-3.5 flex items-center gap-2">
					<Button size="sm" variant="gold" onClick={onNext}>
						{cta ?? "Got it"} <IconArrowRight className="text-sm" />
					</Button>
					{onSkip && (
						<button
							type="button"
							onClick={onSkip}
							className="hand text-[0.78rem] text-navy-soft underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
						>
							Skip tour
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
