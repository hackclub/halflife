"use client"

import { useEffect, useMemo, useState } from "react"
import { IconChevronLeft, IconChevronRight } from "@/components/platform/icons"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { cx } from "@/lib/cx"
import type { CalendarEvent } from "@/lib/events"
import {
	calendarDay,
	dayLabel,
	daySegment,
	dayShort,
	eventColour,
	eventIsLive,
	eventIsUpcoming,
	eventRangeLabel,
	eventsOnDay,
	HUDDLE_URL,
	minutesInDay,
	shiftWeek,
	weekDays,
	weekLabel,
} from "@/lib/events"

/** Monday-first, because the programme's week closes on a Sunday. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

/** Pixels per hour of grid height. Blocks scale with it, so height stays proportional to runtime. */
const HOUR_PX = 32

/** An event's clipped slice of one day, with its overlap lane for side-by-side blocks. */
type PlacedSegment = {
	event: CalendarEvent
	startMin: number
	endMin: number
	lane: number
	lanes: number
}

/** "7 PM" – the gutter's hour marks. */
function hourLabel(hour: number): string {
	const h = ((hour % 24) + 24) % 24
	const suffix = h < 12 ? "AM" : "PM"
	const twelve = h % 12 === 0 ? 12 : h % 12
	return `${twelve} ${suffix}`
}

/**
 * The week view of the programme calendar, and the day selected in it.
 *
 * Seven columns, one per day, on a shared time axis: a block's position is its
 * start and its height its runtime, so a two-hour call takes twice the space
 * of a one-hour one. The axis fits the week's own events – padded by an hour
 * either side – rather than the whole day, so an evening of calls is not a
 * thin stripe at the bottom of an empty grid.
 *
 * Selecting a day lists only that day. The list underneath is otherwise the
 * next handful of events, so the calendar is useful without a click – which is
 * what someone opening it from the header countdown actually wants, since they
 * are usually looking for what is on *tonight*.
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
	// Any day in the viewed week; the grid always shows its Monday-to-Sunday.
	const [anchor, setAnchor] = useState(today)
	const [selected, setSelected] = useState<string | null>(null)

	const days = useMemo(() => weekDays(anchor), [anchor])

	// Reopening starts on the current week with nothing selected. Adjusting during
	// render rather than in an effect: an effect would paint a frame of the old
	// week after the dialog opened.
	const [seen, setSeen] = useState({ open, today })
	if (seen.open !== open || seen.today !== today) {
		setSeen({ open, today })
		setAnchor(today)
		setSelected(null)
	}

	// Midnight can roll over while the dialog is open, and the grid would otherwise
	// be highlighting yesterday until it was closed and reopened.
	useEffect(() => {
		if (!open) return
		const timer = setInterval(() => {
			const current = calendarDay(new Date(), timeZone)
			setSeen(prev => (prev.today === current ? prev : { open: true, today: current }))
		}, 60_000)
		return () => clearInterval(timer)
	}, [open, timeZone])

	// Each day's clipped segments with greedy overlap lanes, plus the week's
	// shared hour range. Lanes are counted per overlap crowd, not per day: two
	// calls sharing an hour split their column, but a lone event keeps the full
	// width even on a day that is busy elsewhere.
	const { segments, startHour, endHour } = useMemo(() => {
		const placed = new Map<string, PlacedSegment[]>()
		let earliest = Number.POSITIVE_INFINITY
		let latest = Number.NEGATIVE_INFINITY
		for (const day of days) {
			const slices = events
				.map(event => ({ event, seg: daySegment(event, day, timeZone) }))
				.filter(
					(slice): slice is { event: CalendarEvent; seg: { startMin: number; endMin: number } } => slice.seg !== null,
				)
				.sort((a, b) => a.seg.startMin - b.seg.startMin || a.seg.endMin - b.seg.endMin)
			// Crowds overlap transitively, so the running maximum end is the test: sorted by start, anything starting before it belongs to the crowd. Back-to-back events touch but never overlap, so each keeps the full width.
			const crowds: { slices: typeof slices; end: number }[] = []
			for (const slice of slices) {
				const open = crowds[crowds.length - 1]
				if (open && slice.seg.startMin < open.end) {
					open.slices.push(slice)
					open.end = Math.max(open.end, slice.seg.endMin)
				} else {
					crowds.push({ slices: [slice], end: slice.seg.endMin })
				}
			}
			const dayPlaced: PlacedSegment[] = []
			for (const crowd of crowds) {
				const laneEnds: number[] = []
				for (const { event, seg } of crowd.slices) {
					let lane = laneEnds.findIndex(end => end <= seg.startMin)
					if (lane === -1) {
						lane = laneEnds.length
						laneEnds.push(seg.endMin)
					} else {
						laneEnds[lane] = seg.endMin
					}
					earliest = Math.min(earliest, seg.startMin)
					latest = Math.max(latest, seg.endMin)
					dayPlaced.push({ event, ...seg, lane, lanes: Math.max(1, laneEnds.length) })
				}
				// The crowd's maximum, shared by all of it, so blocks that only brush the crowd still line up.
				const lanes = Math.max(1, laneEnds.length)
				for (const segment of dayPlaced.slice(-crowd.slices.length)) segment.lanes = lanes
			}
			placed.set(day, dayPlaced)
		}
		if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return { segments: placed, startHour: 9, endHour: 17 }
		return {
			segments: placed,
			startHour: Math.max(0, Math.floor(earliest / 60) - 1),
			endHour: Math.min(24, Math.ceil(latest / 60) + 1),
		}
	}, [days, events, timeZone])

	const spanHours = endHour - startHour
	const gridHeight = spanHours * HOUR_PX
	const hours = useMemo(() => Array.from({ length: spanHours + 1 }, (_, i) => startHour + i), [startHour, spanHours])

	const upcoming = useMemo(() => events.filter(event => eventIsUpcoming(event, new Date())).slice(0, 6), [events])
	const onDay = useMemo(() => (selected ? eventsOnDay(events, selected, timeZone) : []), [events, selected, timeZone])

	function shift(delta: number) {
		setAnchor(shiftWeek(anchor, delta))
		// A day does not carry across a week boundary, so the selection drops
		// rather than pointing at a day that is no longer drawn.
		setSelected(null)
	}

	const listed = selected ? onDay : upcoming

	return (
		<Modal
			open={open}
			onClose={onClose}
			accent="var(--color-violet)"
			size="xl"
			eyebrow="Programme calendar"
			scrollKey={`${anchor}-${selected ?? ""}`}
		>
			<ModalTitle sub="Everything scheduled for the programme, shown in your timezone.">{weekLabel(days)}</ModalTitle>

			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-1.5">
					<GridButton label="Previous week" onClick={() => shift(-1)}>
						<IconChevronLeft className="text-base" />
					</GridButton>
					<GridButton label="Next week" onClick={() => shift(1)}>
						<IconChevronRight className="text-base" />
					</GridButton>
					<button
						type="button"
						onClick={() => {
							setAnchor(today)
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

			{/* The week grid, scrolling sideways on a phone where seven columns
			cannot fit. A block's height is its runtime on the shared axis, so
			durations compare across days as well as within one. */}
			<div className="mt-4 overflow-x-auto">
				{/* The bottom hour label centers on the last gridline, so its lower half hangs below the grid: without this padding the wrapper grows a few-pixel vertical scrollbar that clips it. */}
				<div className="min-w-[620px] pb-4">
					<div className="grid" style={{ gridTemplateColumns: "2.75rem repeat(7, minmax(0, 1fr))" }}>
						<span aria-hidden="true" />
						{days.map((day, i) => {
							const isToday = day === today
							const isSelected = day === selected
							return (
								<button
									key={day}
									type="button"
									onClick={() => setSelected(isSelected ? null : day)}
									aria-pressed={isSelected}
									aria-label={`${dayShort(day)}${(segments.get(day) ?? []).length === 0 ? ", nothing scheduled" : ""}`}
									className={cx(
										"flex flex-col items-center gap-0.5 rounded-t-lg px-1 pt-1.5 pb-2 transition-colors",
										isSelected ? "bg-violet-pale/60" : "hover:bg-cream",
									)}
								>
									<span
										className={cx(
											"label text-[0.6rem]",
											isToday ? "text-violet-ink font-extrabold" : "text-navy-faint",
										)}
									>
										{WEEKDAYS[i]}
									</span>
									<span
										className={cx(
											"grid size-7 place-items-center rounded-full text-[0.9rem] tabular-nums",
											isToday
												? "bg-violet font-extrabold text-white"
												: isSelected
													? "font-extrabold text-navy"
													: "text-navy-soft",
										)}
									>
										{Number(day.split("-")[2] ?? 0)}
									</span>
								</button>
							)
						})}
					</div>

					<div className="grid" style={{ gridTemplateColumns: "2.75rem repeat(7, minmax(0, 1fr))" }}>
						<div className="relative mt-3" style={{ height: gridHeight }} aria-hidden="true">
							{hours.map(hour => (
								<span
									key={hour}
									className="label absolute right-1 text-[0.6rem] text-navy-faint"
									style={{ top: (hour - startHour) * HOUR_PX, transform: "translateY(-50%)" }}
								>
									{hourLabel(hour)}
								</span>
							))}
						</div>
						{days.map(day => {
							const isToday = day === today
							const isSelected = day === selected
							return (
								<div
									key={day}
									className={cx("relative mt-3 rounded-b-lg", isSelected && "bg-violet-pale/60")}
									style={{ height: gridHeight }}
								>
									{hours.map(hour => (
										<span
											key={hour}
											aria-hidden="true"
											className={cx(
												"absolute inset-x-0 border-t",
												hour === startHour ? "border-line" : "border-dashed border-line/70",
											)}
											style={{ top: (hour - startHour) * HOUR_PX }}
										/>
									))}
									{(segments.get(day) ?? []).map(segment => (
										<EventBlock
											key={segment.event.id}
											segment={segment}
											day={day}
											startHour={startHour}
											gridHeight={gridHeight}
											timeZone={timeZone}
											isLive={eventIsLive(segment.event, new Date())}
											onSelect={() => setSelected(day)}
										/>
									))}
									{isToday && <TodayLine startHour={startHour} gridHeight={gridHeight} timeZone={timeZone} />}
								</div>
							)
						})}
					</div>
				</div>
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
						{listed.map(event => (
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

/** One block on the grid: its top is its start, its height its runtime. */
function EventBlock({
	segment,
	day,
	startHour,
	gridHeight,
	timeZone,
	isLive,
	onSelect,
}: {
	segment: PlacedSegment
	day: string
	startHour: number
	gridHeight: number
	timeZone: string
	isLive: boolean
	onSelect: () => void
}) {
	const { event, startMin, endMin, lane, lanes } = segment
	const colour = eventColour(event.colour)
	const range = eventRangeLabel(event.startsAt, event.endsAt, timeZone)
	const top = ((startMin - startHour * 60) / 60) * HOUR_PX
	// Short calls still need a tappable block, but nothing may poke past the grid's bottom edge into the list below.
	const height = Math.min(Math.max(((endMin - startMin) / 60) * HOUR_PX, 20), gridHeight - top)
	const tallEnough = height >= 44
	return (
		<button
			type="button"
			onClick={onSelect}
			aria-label={`${event.title}, ${range}, ${dayShort(day)}`}
			title={`${event.title} · ${range}`}
			className="absolute"
			style={{
				top,
				height,
				left: `${(lane / lanes) * 100}%`,
				width: `${100 / lanes}%`,
			}}
		>
			<span
				className={cx(
					"flex h-full min-w-0 flex-col justify-start gap-px overflow-hidden rounded-md border-l-4 bg-paper px-1.5 py-1 text-left",
					isLive && "ring-2 ring-coral",
				)}
				style={{ borderColor: colour.accent }}
			>
				<span className="line-clamp-2 text-[0.7rem] leading-tight font-extrabold break-words text-navy">
					{event.title}
				</span>
				{tallEnough && <span className="truncate text-[0.62rem] leading-tight text-navy-soft">{range}</span>}
			</span>
		</button>
	)
}

/** The "now" line across today's column, so a live call reads as live on the grid too. Hidden when now is off the grid. */
function TodayLine({ startHour, gridHeight, timeZone }: { startHour: number; gridHeight: number; timeZone: string }) {
	const [now, setNow] = useState(() => new Date())
	useEffect(() => {
		const timer = setInterval(() => setNow(new Date()), 60_000)
		return () => clearInterval(timer)
	}, [])
	const top = ((minutesInDay(now, timeZone) - startHour * 60) / 60) * HOUR_PX
	if (top < 0 || top > gridHeight) return null
	return (
		<span aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10" style={{ top }}>
			<span className="block border-t-2 border-coral" />
		</span>
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
