"use client"

import { useEffect, useState } from "react"
import { IconClock } from "@/components/platform/icons"
import { onAccent } from "@/components/platform/ui"
import { COUNTDOWN_UNITS, countdownParts, pad2 } from "@/lib/site/countdown"
import { useStore } from "@/lib/store"
import type { Week } from "@/lib/types"

/**
 * How long is left in the week being lived, as the biggest figure on the trail.
 *
 * It sits under that week's last node, where the eye already goes looking for
 * how the week ends, and it wears the week's own accent – the banner's ground a
 * few hundred pixels up – so it reads as part of the week rather than as a
 * widget dropped onto the page.
 *
 * Only the ongoing week draws it. A week that has not opened is greyed out and
 * a week past its Sunday is history, so an early or a late countdown is worse
 * than none: it would name a deadline that is not the one anybody is racing.
 *
 * Two things it has to get right, both about the seam the platform's client
 * components live on:
 *
 * - **No hydration mismatch.** The server render and the browser's first paint
 *   have to agree, and the server's clock is not the browser's, so the figures
 *   are placeholders until an effect has run. `--` holds the width a real
 *   figure takes, so nothing on the trail jumps when the count lands.
 * - **Ends cleanly.** At zero the store's own week timer flips `weekPassed`
 *   (store.tsx re-arms its clock for the next boundary), the gate above closes
 *   and the plate goes away – rather than counting up into negative days, which
 *   is what a tab left open overnight would otherwise show.
 *
 * The figures are split into units rather than printed as one string so each is
 * its own column with its label beneath, the figure-leads/words-follow shape
 * the site's countdown uses. They are hidden from a screen reader, which gets
 * the same count in words plus the deadline itself rather than four numbers
 * changing every second.
 */
export function WeekCountdown({ week }: { week: Week }) {
	const { weekStarted, weekPassed, weekClosesAtMs, weekDeadline } = useStore()
	const closesAt = weekClosesAtMs(week.id)
	const ongoing = weekStarted(week.id) && !weekPassed(week.id) && closesAt !== null

	// Null until mounted, then the ms to the close, refreshed on the tick.
	const [remaining, setRemaining] = useState<number | null>(null)
	useEffect(() => {
		if (!ongoing) return
		const closes = closesAt as number
		const tick = () => setRemaining(closes - Date.now())
		tick()
		const timer = setInterval(tick, 1000)
		return () => clearInterval(timer)
	}, [ongoing, closesAt])

	if (!ongoing) return null

	const parts = remaining === null ? null : countdownParts(remaining)
	const deadline = weekDeadline(week.id)
	const { text, pill } = onAccent(week.accent)

	return (
		<div className="mt-8 flex justify-center px-1">
			{/* `px-4` on the narrowest trail: the four unit columns and their gaps
            come to about 280px, which has to clear a 320px phone. */}
			<div className="relative px-4 py-4 text-center sm:px-8" style={{ color: text }}>
				{/* The tear belongs on the fill, not on the type: the same split the
            week banner uses, so the plate's edge is torn tape and the figures
            inside it stay crisp. */}
				<div
					aria-hidden="true"
					className="torn absolute inset-0 rounded"
					style={{
						background: week.accent,
						boxShadow: "0 3px 6px rgba(28,26,89,.12), 0 16px 34px -18px rgba(28,26,89,.5)",
					}}
				/>
				<div className="relative">
					<p className="label flex items-center justify-center gap-1.5">
						<IconClock className="text-[0.95rem]" aria-hidden="true" />
						Week {week.id} closes in
					</p>
					<div
						aria-hidden="true"
						className="mt-1.5 flex items-start justify-center gap-2 font-extrabold tabular-nums sm:gap-4"
					>
						{COUNTDOWN_UNITS.map((unit) => (
							<span key={unit.key} className="flex min-w-0 flex-col items-center">
								<span className="text-[1.9rem] leading-none tracking-[-0.03em] sm:text-[2.7rem]">
									{parts === null ? "--" : unit.key === "days" ? parts.days : pad2(parts[unit.key])}
								</span>
								{/* The labels, not the figures, are what the four columns cannot
                  go below – "MINUTES" is the widest word here – so they are the
                  ones that shrink on a phone. */}
								<span className="label mt-1.5 text-[0.62rem] sm:text-[0.78rem]" style={{ opacity: 0.7 }}>
									{unit.label}
								</span>
							</span>
						))}
					</div>
					{/* The count in words, and the moment it is counting to: a screen
              reader gets both, and neither is four changing figures. */}
					<p className="sr-only">
						{parts === null
							? `Week ${week.id} closes ${deadline ?? "this week"}.`
							: `${parts.days} days and ${parts.hours} hours left in week ${week.id}, which closes ${deadline ?? "this week"}.`}
					</p>
					{deadline && (
						<p className="label mt-2" style={{ background: pill, borderRadius: 999, padding: "0.3rem 0.9rem" }}>
							closes {deadline}
						</p>
					)}
				</div>
			</div>
		</div>
	)
}
