"use client"

import Image from "next/image"
import { type CSSProperties, useCallback, useEffect, useRef } from "react"
import ImageSlot from "@/components/site/image-slot"
import { BUILD_CARDS } from "@/lib/site/content"

/**
 * The belt carries one card past you every this many seconds – at every breakpoint. Speed is derived from the set's measured pitch rather than fixed in pixels, so the pace reads identically on a phone and on the comp stage. Averaged across the set, because a card is only as wide as its own credit.
 */
const SECONDS_PER_CARD = 8

/** A loaded belt has mass: it drops to a stop faster than it winds back up. */
const STOP_TAU = 0.11
const START_TAU = 0.34

/**
 * Enough repeats of the set that the wrap point is never in view.
 *
 * The belt wraps a set at a time, so at the moment it wraps there must be `COPIES - 1` sets standing to the right of the reader: the viewport has to fit inside them or the far end of the belt runs out of cards. While the blue block was capped at 1360 that could not be in question. Full-bleed it can be, so the sum has to be done: five cards on the closed-up 450 pitch is a 2250 set, and the three sets this leaves standing carry 6750 – past a 5K display's 5120, where three copies would carry 4500 and run out. The margin survived halving the gutter: at the comp's 514 it was 7710.
 */
const COPIES = 4

/** Comp pixels on the 1728 grid, as the `cqw` fraction of it. */
const CARD_W = "clamp(13rem, 22.338cqw, 386px)"
const CARD_RATIO = "386 / 368"
const CARD_BORDER = "clamp(0.55rem, 1.157cqw, 20px)"
const CARD_RADIUS = "clamp(0.9rem, 1.736cqw, 30px)"
/** The caption band is 105 of the card's 328 of content height. */
const BAND_H = "32.012%"
/**
 * The comp's 128 gutter, halved.
 *
 * 128 against a 386 card is a third of a card of air between every pair, which held the five of them apart as separate plates rather than reading as one belt passing through. At 64 the pitch goes 514 -> 450 and the run closes up without the cards touching.
 *
 * The floor does not halve with it. On a phone the cards stop shrinking at their own 13rem – 208px – so the gap has to hold against a card that is no longer getting smaller, and the halved slope would put 13.9px between two 208px cards and read as a seam. 1.5rem is 11.5% of that card, near the 12.4% the full-size pair keeps.
 */
const GAP_PX = 64
const GAP = `clamp(1.5rem, ${Number(((GAP_PX / 1728) * 100).toFixed(3))}cqw, ${GAP_PX}px)`
const INSET = "clamp(1rem, 4.514cqw, 78px)"
const LABEL = "clamp(0.95rem, 1.447cqw, 25px)"
const CREDIT = "clamp(0.7rem, 0.984cqw, 17px)"
/** Card content is the card less its two borders: 22.338 - 2 x 1.157. */
const PHOTO_SIZES = "(min-width: 1728px) 346px, 20vw"

/**
 * The belt, from the reworked "what can I build" frames.
 *
 * Every measurement below is a literal pixel off the comp's 1728 grid (275:8), expressed as the `cqw` fraction of it, so the section reproduces the frame and scales continuously: card 386 x 368 on a 514 pitch, so a 128 gap; the run starts 78 in; the heading is 60 and sits 44 under the band above it and 97 over the cards, which clear the band below by 156.
 *
 * The card itself is the `Plugin icon - 1` frame (301:56): a 30-radius block with a 20 border in pale yellow, yellow inside, and a pale-yellow caption band filling the bottom 105 of its 328 of content. The photograph sits on the yellow above it.
 */

interface Metrics {
	cycle: number
	speed: number
}

/**
 * Position within one set.
 *
 * A single `if (next >= cycle) next -= cycle` only ever unwinds one set, so it could not bring a position back that had landed further out than that -- and things do put it there: the browser scrolling a focused card into view, a reader flicking the belt along, scroll restoration on a reload. The next running frame then took one set off a position several sets out and the belt lurched backwards, which is what read as the carousel restarting itself.
 *
 * Wrapping by the true cycle is invisible whatever the distance, because the card set at `x` and at `x + cycle` is the same set -- so the belt can always be brought back into range, not merely nudged one set at a time.
 */
function norm(x: number, cycle: number) {
	if (!(cycle > 0)) return x
	const m = x % cycle
	return m < 0 ? m + cycle : m
}

function BuildCarousel() {
	const sectionRef = useRef<HTMLElement>(null)
	const railRef = useRef<HTMLUListElement>(null)

	const metricsRef = useRef<Metrics>({ cycle: 0, speed: 0 })
	const posRef = useRef(0)
	const velocityRef = useRef(0)

	const hoverRef = useRef(false)
	const focusRef = useRef(false)
	const onscreenRef = useRef(false)
	const reducedRef = useRef(false)
	const wakeRef = useRef<() => void>(undefined)

	const stop = useCallback((which: "hover" | "focus") => {
		if (which === "hover") hoverRef.current = true
		else focusRef.current = true
	}, [])

	const start = useCallback((which: "hover" | "focus") => {
		if (which === "hover") hoverRef.current = false
		else focusRef.current = false
		wakeRef.current?.()
	}, [])

	useEffect(() => {
		const section = sectionRef.current
		const rail = railRef.current
		if (!section || !rail) return

		const measure = () => {
			const items = rail.children
			const head = items[0] as HTMLElement | undefined
			const wrap = items[BUILD_CARDS.length] as HTMLElement | undefined
			if (!head || !wrap) return

			// Measured off rects, not `offsetLeft`. `offsetLeft` is rounded to whole pixels, and one set here is 1490.67 wide: wrapping by 1491 drops a third of a pixel every time round, which on a belt this slow is a visible tick roughly twice a minute.
			const cycle = wrap.getBoundingClientRect().left - head.getBoundingClientRect().left

			metricsRef.current = {
				cycle,
				// Averaged across the set rather than taken from the first pair of cards. A card is as wide as its credit, so the first pitch is not the typical one -- with these four it is 364.47 against an average of 372.67, which ran the belt 2% slow and made "a card every eight seconds" mean nothing in particular.
				speed: cycle / (SECONDS_PER_CARD * BUILD_CARDS.length),
			}
			posRef.current = norm(rail.scrollLeft, cycle)
		}

		let frame = 0
		let last = 0

		const running = () => onscreenRef.current && !reducedRef.current && !hoverRef.current && !focusRef.current

		const tick = (now: number) => {
			frame = 0
			// Clamp dt so a backgrounded tab does not resume with a lurch.
			const dt = Math.min(0.05, (now - last) / 1000)
			last = now

			const { cycle, speed } = metricsRef.current
			const target = running() ? speed : 0
			const tau = target > 0 ? START_TAU : STOP_TAU

			let v = velocityRef.current + (target - velocityRef.current) * (1 - Math.exp(-dt / tau))
			if (target === 0 && v < 0.5) v = 0
			velocityRef.current = v

			if (v > 0 && cycle > 0) {
				// Our own fractional position is authoritative; resync only when the reader has taken the belt somewhere themselves.
				if (Math.abs(rail.scrollLeft - posRef.current) > 1.5) posRef.current = norm(rail.scrollLeft, cycle)
				posRef.current = norm(posRef.current + v * dt, cycle)
				rail.scrollLeft = posRef.current
			}

			if (v > 0 || target > 0) frame = requestAnimationFrame(tick)
		}

		const wake = () => {
			if (frame || !running()) return
			last = performance.now()
			frame = requestAnimationFrame(tick)
		}
		wakeRef.current = wake

		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
		const onReduce = () => {
			reducedRef.current = reduce.matches
			wake()
		}
		onReduce()

		// A decorative loop has no business running off-screen.
		const observer = new IntersectionObserver(
			entries => {
				const entry = entries.at(-1)
				if (!entry) return
				onscreenRef.current = entry.isIntersecting
				wake()
			},
			{ threshold: 0 },
		)
		observer.observe(section)

		const resize = new ResizeObserver(measure)
		resize.observe(rail)
		measure()

		reduce.addEventListener("change", onReduce)

		return () => {
			cancelAnimationFrame(frame)
			observer.disconnect()
			resize.disconnect()
			reduce.removeEventListener("change", onReduce)
			wakeRef.current = undefined
		}
	}, [])

	return (
		<section
			aria-labelledby="build-heading"
			// The comp gives this section no ground of its own: it runs between the process band above and the FAQ band below on the page's own ink, and the belt carries no colour either. The cards are the whole event.
			className="hl-ground-hex relative bg-hl-paper text-hl-blue"
			id="what-can-i-build"
			ref={sectionRef}
			style={{
				containerType: "inline-size",
				paddingBottom: "clamp(3rem, 9.028cqw, 156px)",
			}}
		>
			<div
				className="px-4 sm:px-8"
				style={{
					paddingBottom: "clamp(2rem, 5.613cqw, 97px)",
					paddingTop: "clamp(2rem, 2.546cqw, 44px)",
				}}
			>
				<h2
					className="text-center font-display font-bold tracking-[-0.02em] text-hl-blue-deep"
					id="build-heading"
					style={{ fontSize: "clamp(2rem, 3.472cqw, 3.75rem)" }}
				>
					What have others built?
				</h2>
			</div>

			<div
				onBlurCapture={() => start("focus")}
				onFocusCapture={() => stop("focus")}
				onPointerCancel={() => start("hover")}
				onPointerEnter={() => stop("hover")}
				onPointerLeave={() => start("hover")}
			>
				<ul
					aria-label="Projects Half Life teenagers have built"
					aria-roledescription="carousel"
					className="rail flex overflow-x-auto"
					ref={railRef}
					style={{ gap: GAP, paddingInline: INSET }}
					// With no buttons, the scroller itself is the control: tabbable everywhere rather than only in browsers that focus overflow containers on their own, and the belt halts as focus lands.
					// biome-ignore lint/a11y/noNoninteractiveTabindex: the scroller is the only control this rail has; focus is what lets a keyboard scroll it.
					tabIndex={0}
				>
					{Array.from({ length: COPIES }).flatMap((_, copy) =>
						BUILD_CARDS.map((card, index) => (
							<li
								aria-hidden={copy === 0 ? undefined : true}
								aria-label={copy === 0 ? `${index + 1} of ${BUILD_CARDS.length}` : undefined}
								aria-roledescription={copy === 0 ? "slide" : undefined}
								// `group relative` is what lets the repo link stretch to the whole card: `relative` gives the overlay its containing block, `group` lets the mark answer a hover anywhere on it.
								className="group relative shrink-0 overflow-hidden bg-hl-blue"
								key={`${copy}-${card.id}`}
								role={copy === 0 ? "group" : undefined}
								style={
									{
										// An absolutely positioned child is laid out against the padding box, so the overlay needs the frame's own width to reach back over it. It is a clamp, so it travels as a custom property rather than being written out twice.
										"--hl-card-frame": CARD_BORDER,
										aspectRatio: CARD_RATIO,
										border: `${CARD_BORDER} solid var(--color-hl-yellow-pale)`,
										borderRadius: CARD_RADIUS,
										width: CARD_W,
									} as CSSProperties
								}
							>
								<div className="flex h-full w-full flex-col">
									{/* Contained, never cropped: a build is the thing on show,
                      and the field left around it is the card's own ground
                      rather than a gap – which is how the comp mounts these,
                      each photograph a different size on the same field.

                      The lattice is on this box and not the card, so it is
                      only ever the ground behind a photograph: the caption
                      band below is opaque and would have covered the lower
                      third of it anyway. */}
									<div className="hl-ground-mesh relative min-h-0 flex-1">
										{card.photo ? (
											<Image
												// The label under the picture names the project, so a description here would only be read out twice.
												alt=""
												className="object-contain p-2"
												fill
												quality={90}
												sizes={PHOTO_SIZES}
												src={card.photo}
											/>
										) : (
											<ImageSlot
												className="h-full w-full"
												label={card.slot.label}
												ratio={card.slot.ratio}
												scale={1.1}
											/>
										)}
									</div>

									<div
										className="flex flex-col items-center justify-center bg-hl-yellow-pale text-center"
										style={{ flex: `0 0 ${BAND_H}` }}
									>
										<p className="font-body whitespace-nowrap text-hl-ink" style={{ fontSize: LABEL, lineHeight: 1.1 }}>
											{card.label}
										</p>

										<div className="flex items-center gap-[0.7em]" style={{ fontSize: CREDIT, marginTop: "0.55em" }}>
											<p className="font-body whitespace-nowrap text-hl-ink/80">{card.credit}</p>

											{card.repo ? (
												<a
													// The mark is 1.7em of a 0.7-1.06rem credit line, so its own box is a 19-29px target -- under the 24px floor at most sizes and nowhere near 44. Rather than grow the mark until it outweighs the credit beside it, `::after` stretches the link over the whole card and the frame around it, which is both a 208-386px target and the "click the card" the mark was always standing for.
													//
													// Inverts to ink on hover and focus, and now on a hover anywhere on the card, so the card says what it does before it is clicked. The focus ring stays on the mark rather than the overlay: it goes ink too, the page's cyan being 1.4:1 on this pale yellow, where it would read as a disabled control.
													className="grid h-[1.7em] w-[1.7em] shrink-0 place-items-center rounded-full text-hl-ink transition-colors after:absolute after:[inset:calc(-1*var(--hl-card-frame))] group-hover:bg-hl-ink group-hover:text-hl-yellow-pale focus-visible:bg-hl-ink focus-visible:text-hl-yellow-pale focus-visible:outline-hl-ink"
													href={card.repo}
													rel="noopener noreferrer"
													// Only the live set is on the tab path. The three copies behind it stay `aria-hidden`, and a link that is not tabbable is allowed inside that; what they no longer are is unclickable.
													tabIndex={copy === 0 ? undefined : -1}
													target="_blank"
												>
													<span className="sr-only">{`${card.label} on GitHub (opens in a new tab)`}</span>
													<GithubMark className="h-[1.15em] w-[1.15em]" />
												</a>
											) : null}
										</div>
									</div>
								</div>
							</li>
						)),
					)}
				</ul>
			</div>
		</section>
	)
}

/**
 * The GitHub mark.
 *
 * A brand mark, so it is filled rather than drawn at the page's 2.75 stroke like every other icon here -- GitHub's shape is not ours to restyle.
 *
 * Icon from Material Design Icons by Pictogrammers, Apache-2.0: https://github.com/Templarian/MaterialDesign/blob/master/LICENSE
 */
function GithubMark({ className }: { className?: string }) {
	return (
		<svg aria-hidden className={className} viewBox="0 0 24 24">
			<path
				d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2"
				fill="currentColor"
			/>
		</svg>
	)
}

export { BuildCarousel as default }
