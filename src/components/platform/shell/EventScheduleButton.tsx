"use client"

import { useEffect, useMemo, useState } from "react"
import { IconClock } from "@/components/platform/icons"
import { EventCalendar } from "@/components/platform/shell/EventCalendar"
import { cx } from "@/lib/cx"
import { type CalendarEvent, eventIsUpcoming, eventRangeLabel, msUntilStart, nextEvent } from "@/lib/events"
import { countdownParts, pad2 } from "@/lib/site/countdown"

/**
 * The header's countdown to the next thing on the calendar, and the calendar it opens.
 *
 * Three things it has to get right:
 *
 * - **No hydration mismatch.** The server's clock is not the browser's, so the figures are placeholders until an effect has run. `--:--:--` holds the width a real figure takes, so nothing in the header shifts when the count lands. This is the same seam `WeekCountdown` sits on, and the same reason.
 * - **"Next" means the next thing happening.** An event that started an hour ago and runs for another two is the one a participant is meant to be at, so a live event counts as next – otherwise the header would tick down to the call *after* the one they are sitting in.
 * - **Its own clock.** The store's `now` only moves at week boundaries, which is the right cadence for a week and far too coarse for seconds. A separate one-second interval, matching `WeekCountdown`.
 *
 * When nothing is scheduled the button reads "No events" and opens the same calendar on its empty state. Hiding it would leave a participant who had been told about a call with no sign of it, and no way to tell "no call this week" from "the feature is broken".
 */
export function EventScheduleButton({
	events,
	timeZone,
}: {
	/** Published events from now on, soonest first, as the layout read them. */
	events: CalendarEvent[]
	timeZone: string
}) {
	const [open, setOpen] = useState(false)
	// Null until mounted, then the clock. Seeding it with Date.now() during render
	// is the mismatch this whole dance exists to avoid.
	const [now, setNow] = useState<Date | null>(null)

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's clock; the server's is a different instant
		setNow(new Date())
		const timer = setInterval(() => setNow(new Date()), 1000)
		return () => clearInterval(timer)
	}, [])

	const next = useMemo(() => nextEvent(events, now ?? new Date(0)), [events, now])
	const parts = countdownParts(next && now ? msUntilStart(next, now) : 0)
	const live = next !== null && now !== null && !eventIsUpcoming(next, now)
	// A weekly call is days away, so the days lead and the clock follows: `3d
	// 04:12`, never `76:12`, which reads as a number nobody counts to. The seconds
	// are rendered as their own node so a phone can drop them: three characters of
	// a header row that is counted out to the pixel, and a minute still ticks.
	const clock =
		parts.days > 0
			? `${parts.days}d ${pad2(parts.hours)}:${pad2(parts.minutes)}`
			: `${pad2(parts.hours)}:${pad2(parts.minutes)}`

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-haspopup="dialog"
				aria-expanded={open}
				title={
					next ? `${next.title} · ${eventRangeLabel(next.startsAt, next.endsAt, timeZone)}` : "Open the event calendar"
				}
				className={cx(
					"label inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 bg-paper px-2 py-1.5 transition-colors sm:gap-2 sm:px-3",
					next === null
						? "border-line text-navy-faint"
						: "border-line text-navy-soft hover:border-violet hover:text-navy",
				)}
			>
				<IconClock className={cx("text-base", live && "text-coral")} />
				{/* Visually hidden on a phone, where the row has no room for it, but
            never `display: none`: the countdown is the button's only label there,
            so it stays in the accessibility tree. */}
				<span className="sr-only sm:not-sr-only">
					{next === null ? "No events" : live ? "Happening now" : "Next event in"}
				</span>
				{/* One fixed-width slot, so the pill does not change width between the
            placeholder and the count – or as the digits roll over. Narrower on a
            phone, where the row is counted out to the pixel. */}
				<span className="min-w-[5ch] text-right text-[0.72rem] font-extrabold tabular-nums text-navy sm:min-w-[9ch] sm:text-[0.78rem]">
					{next === null ? (
						"—"
					) : now === null ? (
						<>
							{"--:--"}
							<span className="hidden sm:inline">:--</span>
						</>
					) : live ? (
						"live"
					) : (
						<>
							{clock}
							<span className="hidden sm:inline">:{pad2(parts.seconds)}</span>
						</>
					)}
				</span>
			</button>

			<EventCalendar open={open} onClose={() => setOpen(false)} events={events} timeZone={timeZone} />
		</>
	)
}
