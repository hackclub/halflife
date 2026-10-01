"use client"

import { useEffect, useState } from "react"
import { COUNTDOWN_UNITS, countdownParts, pad2 } from "@/lib/site/countdown"

/**
 * The wait for week 1, as a large countdown across the top of the landing page.
 *
 * The target is `weekOpensAt(settings, 1)` — the same instant the trail's first
 * week unlocks — read on the server and passed in as an ISO string. It is a
 * fixed moment, not a live number, so this needs no endpoint and no polling the
 * way the sign-up counter does; the only thing that changes is the clock.
 *
 * Two things it has to get right, and both are about the server/client seam:
 *
 * - **No hydration mismatch.** The server renders at time T and the browser
 *   hydrates at T + (however long the document took). Rendering a live figure
 *   on the server would make the two disagree and React would rewrite the
 *   markup on every load. So the server (and the client's first paint) render a
 *   stable placeholder — the unit labels at rest — and the ticking figure
 *   appears only once mounted, in an effect. Before that the band keeps its
 *   height, so nothing under it moves when the number lands.
 * - **Ends cleanly.** At zero it stops ticking and says the programme is open
 *   rather than counting into the negative. A stale tab left open across the
 *   deadline should read "open", not "-3 days".
 *
 * The count is split into days/hours/minutes/seconds rather than one string, so
 * each unit is its own large figure with a small label beneath — the same
 * figure-leads, words-follow relationship the sign-up counter uses, taken to the
 * four columns a countdown wants.
 *
 * It is a solid cyan plate with ink text, the page's CTA material: the sign-up
 * button is `bg-hl-cyan text-hl-ink`, and a countdown to opening day is the
 * same kind of object — an offer the page is making — rather than the muted
 * dateline it replaced. `rounded-lg` plus the global `* { corner-shape: bevel }`
 * (globals.css) makes the corners the page's own 45° mitre, and the short
 * shadow in the section's deep teal lifts it off the painting.
 */

export default function WeekCountdown({ opensAt }: { opensAt: string }) {
	const target = new Date(opensAt).getTime()
	// null until mounted: the placeholder state, so the server and the first
	// client paint agree.
	const [remaining, setRemaining] = useState<number | null>(null)

	useEffect(() => {
		const tick = () => setRemaining(target - Date.now())
		tick()
		const timer = setInterval(tick, 1000)
		return () => clearInterval(timer)
	}, [target])

	// A past or unparseable target is over, not a countdown to a negative span.
	const over = remaining !== null && remaining <= 0
	const parts = remaining === null ? null : countdownParts(remaining)

	// The plate, cut from the page's cyan the way the sign-up CTA is: a solid
	// ground with ink text, `rounded-lg` and the global `corner-shape: bevel`
	// turning that radius into a 45° mitre. It sits as high as it can without
	// meeting the flag and log-in marks at the corners — `top-12` clears both —
	// and the gap under it is what keeps it off the wordmark in the plate below.
	return (
		<div className="pointer-events-none absolute top-10 left-1/2 z-20 -translate-x-1/2 min-[830px]:top-12">
			<div
				className="inline-block max-w-[92vw] rounded-lg bg-hl-cyan px-4 py-1.5 text-center text-hl-ink shadow-[0_2px_0_var(--color-hl-teal-deep)]"
				aria-live="polite"
			>
				<p className="font-display text-[0.66rem] font-bold uppercase tracking-[0.18em]">
					{over ? "week 1 is open" : "week 1 starts in"}
				</p>
				{over ? null : (
					<div
						className="mt-0.5 flex items-baseline justify-center gap-[0.4em] font-display font-bold tabular-nums"
						style={{ fontSize: "clamp(1.5rem, 6vw, 2.25rem)", lineHeight: 1 }}
					>
						{COUNTDOWN_UNITS.map((unit) => (
							<span key={unit.key} className="inline-flex flex-col items-center" style={{ lineHeight: 1 }}>
								<span style={{ fontSize: "1em" }}>
									{parts === null ? "--" : unit.key === "days" ? parts.days : pad2(parts[unit.key])}
								</span>
								<span
									className="font-display font-bold uppercase"
									style={{ fontSize: "0.24em", letterSpacing: "0.14em", lineHeight: 1 }}
								>
									{unit.label}
								</span>
							</span>
						))}
					</div>
				)}
			</div>
		</div>
	)
}
