"use client"

import { useEffect, useMemo, useState } from "react"
import { IconChevronLeft, IconChevronRight } from "@/components/platform/icons"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { cx } from "@/lib/cx"
import type { CalendarEvent } from "@/lib/events"
import {
	calendarDay,
	dayLabel,
	dayShort,
	eventColour,
	eventCountsByDay,
	eventIsLive,
	eventIsUpcoming,
	eventRangeLabel,
	eventsOnDay,
	HUDDLE_URL,
	monthDays,
	monthLabel,
	monthOf,
	shiftMonth,
} from "@/lib/events"

/** Monday-first, because the programme's week closes on a Sunday. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

/**
 * The month view of the programme calendar, and the day it opens on.
 *
 * Built from `YYYY-MM-DD` strings rather than from `Date` arithmetic on instants,
 * for the same reason the week maths in `lib/program.ts` counts calendar days: a
 * cell is a *day on a wall*, and an instant does not name one until you say which
 * zone. Doing it in the viewer's zone keeps an evening call on the evening of
 * that viewer's day rather than sliding it onto the next one.
 *
 * Selecting a day lists only that day. The list underneath is otherwise the next
 * handful of events, so the calendar is useful without a click – which is what
 * someone opening it from the header countdown actually wants, since they are
 * usually looking for what is on *tonight*.
 */
export function EventCalendar({
	open,
	onClose,
	events,
	timeZone,
}: {
	open: boolean
	onClose: () => void
	events: CalendarEvent[]
	timeZone: string
}) {
	const today = useMemo(() => calendarDay(new Date(), timeZone), [timeZone])
	const [month, setMonth] = useState(() => monthOf(today))
	const [selected, setSelected] = useState<string | null>(null)

	// Reopening starts on the current month with nothing selected. Adjusting during
	// render rather than in an effect: an effect would paint a frame of the old
	// month after the dialog opened.
	const [seen, setSeen] = useState({ open, today })
	if (seen.open !== open || seen.today !== today) {
		setSeen({ open, today })
		setMonth(monthOf(today))
		setSelected(null)
	}

	// Midnight can roll over while the dialog is open, and the grid would otherwise
	// be highlighting yesterday until it was closed and reopened.
	useEffect(() => {
		if (!open) return
		const timer = setInterval(() => {
			const current = calendarDay(new Date(), timeZone)
			setSeen((prev) => (prev.today === current ? prev : { open: true, today: current }))
		}, 60_000)
		return () => clearInterval(timer)
	}, [open, timeZone])

	const counts = useMemo(() => eventCountsByDay(events, timeZone), [events, timeZone])
	const days = useMemo(() => monthDays(month.year, month.month), [month])
	const upcoming = useMemo(() => events.filter((event) => eventIsUpcoming(event, new Date())).slice(0, 6), [events])
	const onDay = useMemo(() => (selected ? eventsOnDay(events, selected, timeZone) : []), [events, selected, timeZone])

	function shift(delta: number) {
		setMonth(shiftMonth(month, delta))
		// A day number does not carry across a month boundary, so the selection
		// drops rather than pointing at a day that is no longer drawn.
		setSelected(null)
	}

	const listed = selected ? onDay : upcoming

	return (
		<Modal
			open={open}
			onClose={onClose}
			accent="var(--color-violet)"
			size="lg"
			eyebrow="Programme calendar"
			scrollKey={`${month.year}-${month.month}-${selected ?? ""}`}
		>
			<ModalTitle sub="Everything scheduled for the programme, shown in your timezone.">
				{monthLabel(month.year, month.month)}
			</ModalTitle>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-1.5">
					<GridButton label="Previous month" onClick={() => shift(-1)}>
						<IconChevronLeft className="text-base" />
					</GridButton>
					<GridButton label="Next month" onClick={() => shift(1)}>
						<IconChevronRight className="text-base" />
					</GridButton>
					<button
						type="button"
						onClick={() => {
							setMonth(monthOf(today))
							setSelected(null)
						}}
						className="label ml-1 rounded-full border-2 border-line px-3 py-1 text-navy-soft transition-colors hover:border-sky hover:text-navy"
					>
						Today
					</button>
				</div>
				{selected ? (
					<button
						type="button"
						onClick={() => setSelected(null)}
						className="label rounded-full border-2 border-line px-3 py-1 text-navy-soft transition-colors hover:border-sky hover:text-navy"
					>
						Show what&apos;s next
					</button>
				) : null}
			</div>

			{/* A grid, so a reader can see the shape of the month – which days are
          busy, and whether the huddles are weekly – before reading any of it.
          Buttons rather than a table because each cell is its own control. */}
			<div className="mt-4 grid grid-cols-7 gap-1">
				{WEEKDAYS.map((weekday) => (
					<div key={weekday} className="label pb-1 text-center text-[0.6rem] text-navy-faint">
						{weekday}
					</div>
				))}
				{days.map((day, index) => {
					// The pad cells are the days of the neighbouring months the grid
					// has to borrow to fill its first and last rows. Rendered, not
					// focusable: there is nothing to select on them.
					if (!day) return <span key={`pad-${index}`} aria-hidden="true" />
					const count = counts.get(day) ?? 0
					const isToday = day === today
					const isSelected = day === selected
					return (
						<button
							key={day}
							type="button"
							onClick={() => setSelected(isSelected ? null : day)}
							aria-pressed={isSelected}
							aria-label={
								count === 0
									? `${dayShort(day)}, nothing scheduled`
									: `${dayShort(day)}, ${count} event${count === 1 ? "" : "s"}`
							}
							className={cx(
								"relative flex aspect-square flex-col items-center justify-center rounded-lg text-[0.9rem] transition-colors",
								isSelected
									? "font-extrabold text-white"
									: count > 0
										? "font-bold text-navy hover:bg-violet-pale"
										: "text-navy-faint hover:bg-cream",
								isToday && !isSelected && "ring-2 ring-navy",
							)}
							style={isSelected ? { background: "var(--color-violet)" } : undefined}
						>
							{Number(day.split("-")[2] ?? 0)}
							{/* A dot rather than a count: a cell has room for one mark, and
                  a "3" would imply it matters which three. */}
							{count > 0 && (
								<span
									aria-hidden="true"
									className={cx("absolute bottom-1 size-1.5 rounded-full", isSelected ? "bg-white" : "bg-violet")}
								/>
							)}
						</button>
					)
				})}
			</div>

			<div className="mt-6">
				<h3 className="label text-navy-faint">{selected ? dayLabel(selected) : "Coming up"}</h3>
				{listed.length === 0 ? (
					<p className="mt-2 text-[0.92rem] text-navy-soft">
						{events.length === 0
							? "Nothing is scheduled yet."
							: selected
								? "Nothing on this day."
								: "Every published event has finished. Check back, or ask in the Slack channel."}
					</p>
				) : (
					<ul className="mt-3 grid gap-3">
						{listed.map((event) => (
							<li key={event.id}>
								<EventRow event={event} timeZone={timeZone} />
							</li>
						))}
					</ul>
				)}
			</div>
		</Modal>
	)
}

/** One event: when, and where to turn up. */
function EventRow({ event, timeZone }: { event: CalendarEvent; timeZone: string }) {
	const colour = eventColour(event.colour)
	const live = eventIsLive(event, new Date())
	return (
		<div
			className="sketch flex gap-3.5 bg-paper px-4 py-3.5"
			style={{ "--sk-color": colour.accent, "--sk-radius": "14px" } as React.CSSProperties}
		>
			<div className="w-[5.5rem] shrink-0">
				<p className="text-[1.02rem] leading-tight font-extrabold text-navy">
					{eventRangeLabel(event.startsAt, event.endsAt, timeZone)}
				</p>
				<p className="label mt-0.5 text-[0.62rem] text-navy-faint">{dayShort(calendarDay(event.startsAt, timeZone))}</p>
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<h4 className="text-[1.02rem] leading-tight font-extrabold text-navy">{event.title}</h4>
					{live && (
						<span className="label rounded-full bg-coral/15 px-2 py-0.5 text-[0.58rem] text-coral-dark">on now</span>
					)}
				</div>
				{event.description ? (
					<p className="mt-1 text-[0.87rem] leading-snug text-navy-soft">{event.description}</p>
				) : null}
				<p className="mt-1.5 text-[0.83rem] text-navy-soft">
					Every call happens in the{" "}
					<a
						href={HUDDLE_URL}
						target="_blank"
						rel="noreferrer"
						className="font-semibold text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
					>
						Half Life huddle
					</a>
				</p>
			</div>
		</div>
	)
}

function GridButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={label}
			title={label}
			className="grid size-8 place-items-center rounded-full border-2 border-line bg-paper text-navy-soft transition-colors hover:border-violet hover:text-navy"
		>
			{children}
		</button>
	)
}
