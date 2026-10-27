"use client"
import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react"
import { weeklyAverages } from "@/app/components/admin/activity-weeks"
import { CHART_H, DayAxis, EDGE, niceTicks, PAD_B, PAD_T, pct } from "@/app/components/admin/chart-geometry"
import { EmptyState } from "@/app/components/ui"
import { fmtInt } from "@/lib/numbers"
import type { ActiveDay, DayActivity } from "@/lib/queries/admin"

/** Hours to the one decimal the strip chart's axis and legend are read at. */
const fmtHours = (h: number) => `${h.toLocaleString("en-US", { maximumFractionDigits: 1 })}h`

interface ProgrammeFilter {
	/** Whether the charts leave out every day before the programme's first one. */
	programmeOnly: boolean
	/** YYYY-MM-DD, the programme-timezone day week 1 opens on. */
	programmeStart: string
	setProgrammeOnly(on: boolean): void
}

const ProgrammeFilterContext = createContext<ProgrammeFilter | null>(null)

/**
 * One pre-season switch for the whole daily-activity section.
 *
 * The three charts below it read the same days, and two of them say so in their own copy: the per-user line is meant to be read beside the totals, so filtering one and not the other would compare a season against a season plus its warm-up. The state therefore lives above the panels rather than in each chart, and whichever chart's checkbox is clicked moves all of them together.
 */
export function ProgrammeFilterProvider({
	children,
	programmeStart,
}: Readonly<{ children: ReactNode; programmeStart: string }>) {
	const [programmeOnly, setProgrammeOnly] = useState(false)
	const value = useMemo(() => ({ programmeOnly, programmeStart, setProgrammeOnly }), [programmeOnly, programmeStart])
	return <ProgrammeFilterContext.Provider value={value}>{children}</ProgrammeFilterContext.Provider>
}

function useProgrammeFilter(): ProgrammeFilter {
	const filter = useContext(ProgrammeFilterContext)
	if (!filter) throw new Error("The activity charts have to be inside a ProgrammeFilterProvider")
	return filter
}

/**
 * The switch itself, offered by each chart so it is to hand wherever the pre-season is being read, and only where there is a pre-season to leave out.
 *
 * "Weeks" because that is the unit the programme is scheduled in, but the cut is on the day: week 1 opens on the programme's start date, so every day before that date is a week before week 1.
 */
function ProgrammeToggle() {
	const { programmeOnly, setProgrammeOnly } = useProgrammeFilter()
	return (
		<label
			className="hl-row"
			style={{ cursor: "pointer", fontSize: "0.78rem", gap: "0.4rem", marginBottom: "0.75rem" }}
		>
			<input
				aria-label="Exclude weeks before the programme began"
				checked={programmeOnly}
				onChange={event => setProgrammeOnly(event.target.checked)}
				type="checkbox"
			/>
			<span style={{ color: "var(--color-ink-muted)" }}>Exclude weeks before the programme began</span>
		</label>
	)
}

/**
 * Hours and devlogs per day, as two lines over one shared day axis and two scales.
 *
 * One chart rather than two stacked ones because the two move together, and that is the thing worth seeing: a day where the hours line jumps and the devlogs line does not is a long sitting, and a day where both jump is a busy one. Stacked, that comparison needed the eye to travel between panels and hold one scale in mind.
 *
 * Two axes because the magnitudes are unrelated and either could outgrow the other as the season runs. Sharing one scale would pin the smaller series to the baseline and read as a flat line, which is worse than no line at all. Each line is therefore drawn against its own maximum, and each axis is labelled with its series, so neither is read off the other's numbers.
 *
 * `perUser` divides each day by the people who logged something that day rather than plotting the totals. It is the same chart otherwise, deliberately: the shapes are meant to be laid side by side, and a second component that drew a slightly different grid would defeat that. It answers a different question – not how much the programme did, but how much one person's working day held – so the two are read together, the totals for volume and these for whether that volume is spread thin. A day with a single contributor reads tall here, because that is what an average over one person is, and nothing in the data can say otherwise.
 */
export function ActivityStrip({ days: allDays, perUser = false }: { days: DayActivity[]; perUser?: boolean }) {
	const { programmeOnly, programmeStart } = useProgrammeFilter()
	const hasEarlier = allDays.some(d => d.day < programmeStart)
	const days = programmeOnly ? allDays.filter(d => d.day >= programmeStart) : allDays
	const toggle = hasEarlier ? <ProgrammeToggle /> : null

	if (allDays.length === 0) return <EmptyState>No devlogs yet.</EmptyState>
	if (days.length === 0)
		return (
			<div>
				{toggle}
				<EmptyState>No devlogs since the programme began.</EmptyState>
			</div>
		)

	// A gap-filled day with no contributors has no average to take and no activity to take it from, so it reads as zero. Left as `value / users` it would divide by zero into NaN and put a hole in the path.
	const perActiveUser = (value: number, users: number) => (users > 0 ? value / users : 0)
	const hoursOf = (d: DayActivity) => (perUser ? perActiveUser(d.hours, d.users) : d.hours)
	const devlogsOf = (d: DayActivity) => (perUser ? perActiveUser(d.devlogs, d.users) : d.devlogs)

	const plotH = CHART_H - PAD_T - PAD_B

	const maxHours = Math.max(1, ...days.map(hoursOf))
	const maxDevlogs = Math.max(1, ...days.map(devlogsOf))
	// Each axis grows to the next round tick above its tallest mark, so the gridlines land on multiples a person can read rather than on quarters of a spiky maximum.
	const hoursAxis = niceTicks(maxHours)
	const devlogsAxis = niceTicks(maxDevlogs, { integer: !perUser })
	// The span's own figure, for the legend. On the per-user chart this is the mean of what is drawn rather than a total, so it is divided by the days on the axis – including the quiet ones, since those are plotted too.
	const sumHours = days.reduce((n, d) => n + hoursOf(d), 0)
	const sumDevlogs = days.reduce((n, d) => n + devlogsOf(d), 0)
	const meanHours = sumHours / days.length
	const meanDevlogs = sumDevlogs / days.length

	// The count axis keeps a decimal per user, where a total would round a fraction of a devlog to nothing.
	const fmtCount = (v: number) => (perUser ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : fmtInt(v))
	const legendHours = perUser
		? `hours per user (averaging ${fmtHours(meanHours)})`
		: `hours (${fmtHours(sumHours)} total)`
	const legendDevlogs = perUser
		? `devlogs per user (averaging ${fmtCount(meanDevlogs)})`
		: `devlogs (${fmtInt(sumDevlogs)} total)`

	const xOf = (i: number) => (days.length === 1 ? 0.5 : EDGE + (i / (days.length - 1)) * (1 - 2 * EDGE))
	const yFor = (v: number, max: number) => PAD_T + plotH - (v / max) * plotH
	const points = (pick: (d: DayActivity) => number, max: number) =>
		days.map((d, i) => ({ x: xOf(i), y: yFor(pick(d), max) }))
	/** One segment per pair of points, because a `d` attribute cannot carry the percentage x. */
	const segments = (at: { x: number; y: number }[]) =>
		at.slice(1).map((point, i) => {
			const previous = at[i] ?? point
			return { x1: previous.x, x2: point.x, y1: previous.y, y2: point.y }
		})
	const hoursSegments = segments(points(hoursOf, hoursAxis.top))
	const devlogsSegments = segments(points(devlogsOf, devlogsAxis.top))
	/** The fill under the hours line, as a column per day rather than a closed path, for the same reason. */
	const areaBars = days.map((d, i) => ({
		width: (i === days.length - 1 ? 1 - EDGE : xOf(i + 1)) - xOf(i),
		x: xOf(i),
		y: yFor(hoursOf(d), hoursAxis.top),
	}))

	const hoursTicks = hoursAxis.ticks
	const devlogTicks = devlogsAxis.ticks

	const labelEvery = Math.max(1, Math.ceil(days.length / 14))
	const first = days[0]?.day
	const last = days.at(-1)?.day
	const what = perUser ? "per active user " : ""
	const note = perUser
		? " Each line is divided by the people who logged something that day, so a quiet day with one contributor reads tall."
		: ""

	return (
		<div>
			{toggle}
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
				<span
					aria-hidden="true"
					style={{
						background: "var(--color-accent)",
						display: "inline-block",
						height: "0.15rem",
						marginRight: "0.35rem",
						verticalAlign: "middle",
						width: "0.7rem",
					}}
				/>
				{legendHours}
				<span
					aria-hidden="true"
					style={{
						background: "var(--color-magenta)",
						display: "inline-block",
						height: "0.15rem",
						marginLeft: "1rem",
						marginRight: "0.35rem",
						verticalAlign: "middle",
						width: "0.7rem",
					}}
				/>
				{legendDevlogs}
			</p>
			{/* The two scale columns are grid siblings of the chart, so they share its row. Each label is placed at the exact pixel its gridline sits on, so the two scales read off one row rather than eyeballed. */}
			<div style={{ alignItems: "start", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto" }}>
				<div style={{ height: `${CHART_H}px`, position: "relative", width: "3.1rem" }}>
					{hoursTicks.map((t, i) => (
						<span
							aria-hidden="true"
							key={`hl${i}`}
							style={{
								color: "var(--color-accent-ink)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								position: "absolute",
								right: 6,
								top: yFor(t, hoursAxis.top),
								transform: "translateY(-50%)",
							}}
						>
							{fmtHours(t).replace("h", "")}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							fontSize: "0.6rem",
							// Pinned so the caption's box is its own height rather than an inherited line-height's: the band below it is what keeps it clear of the top tick label, and that budget has to be knowable.
							lineHeight: 1,
							position: "absolute",
							right: 6,
							top: -1,
						}}
					>
						h
					</span>
				</div>

				<div>
					<svg
						aria-label={`Hours logged ${what}per day from ${first} to ${last}, peaking at ${fmtHours(
							maxHours,
						)}, and devlogs written ${what}per day over the same period, peaking at ${fmtCount(maxDevlogs)}`}
						height={CHART_H}
						role="img"
						style={{ display: "block" }}
						width="100%"
					>
						{hoursTicks.map((t, i) => (
							<line
								key={`hg${i}`}
								stroke="var(--color-line-soft)"
								strokeWidth="1"
								x1={pct(EDGE)}
								x2={pct(1 - EDGE)}
								y1={yFor(t, hoursAxis.top)}
								y2={yFor(t, hoursAxis.top)}
							/>
						))}
						{devlogTicks.map((t, i) => (
							<line
								key={`dg${i}`}
								stroke="var(--color-line-soft)"
								strokeDasharray="2 3"
								strokeWidth="1"
								x1={pct(EDGE)}
								x2={pct(1 - EDGE)}
								y1={yFor(t, devlogsAxis.top)}
								y2={yFor(t, devlogsAxis.top)}
							/>
						))}
						{areaBars.map((bar, i) => (
							<rect
								fill="var(--color-accent)"
								height={PAD_T + plotH - bar.y}
								key={`a${i}`}
								opacity="0.1"
								width={pct(bar.width)}
								x={pct(bar.x)}
								y={bar.y}
							/>
						))}
						{hoursSegments.map((segment, i) => (
							<line
								key={`h${i}`}
								stroke="var(--color-accent)"
								strokeLinecap="round"
								strokeWidth="1.75"
								x1={pct(segment.x1)}
								x2={pct(segment.x2)}
								y1={segment.y1}
								y2={segment.y2}
							/>
						))}
						{devlogsSegments.map((segment, i) => (
							<line
								key={`d${i}`}
								stroke="var(--color-magenta)"
								strokeDasharray="4 2"
								strokeLinecap="round"
								strokeWidth="1.25"
								x1={pct(segment.x1)}
								x2={pct(segment.x2)}
								y1={segment.y1}
								y2={segment.y2}
							/>
						))}
						{days.map((d, i) => (
							<circle
								cx={pct(xOf(i))}
								cy={yFor(hoursOf(d), hoursAxis.top)}
								fill="var(--color-accent)"
								key={d.day}
								r="1.6"
							>
								<title>
									{perUser
										? `${d.day}: ${fmtHours(hoursOf(d))} and ${fmtCount(devlogsOf(d))} devlogs per user, across ${fmtInt(d.users)} ${d.users === 1 ? "person" : "people"}`
										: `${d.day}: ${fmtHours(d.hours)} logged, ${fmtInt(d.devlogs)} devlogs`}
								</title>
							</circle>
						))}
					</svg>
					<DayAxis days={days} labelEvery={labelEvery} />
				</div>

				<div style={{ height: `${CHART_H}px`, position: "relative", width: "3.4rem" }}>
					{devlogTicks.map((t, i) => (
						<span
							aria-hidden="true"
							key={`dl${i}`}
							style={{
								color: "var(--color-magenta)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								left: 6,
								position: "absolute",
								top: yFor(t, devlogsAxis.top),
								transform: "translateY(-50%)",
							}}
						>
							{fmtCount(t)}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							fontSize: "0.6rem",
							left: 6,
							// The same pinned box as the hours caption: one band, two captions, both meant to clear the tick.
							lineHeight: 1,
							position: "absolute",
							top: -1,
						}}
					>
						devlogs
					</span>
				</div>
			</div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
				Dashed is devlogs against the right axis, solid is hours against the left; each is scaled to its own maximum, so
				compare the shapes and not the heights. Days are program-timezone effective dates, the day the work counted for.
				Hours count journal devlogs only.{note}
			</p>
		</div>
	)
}

/** A bar's tooltip name: the programme's own week number, or the warm-up when it predates week 1. */
const weekName = (week: number, first: string, last: string) => {
	const range = `${first.slice(5)} to ${last.slice(5)}`
	return week < 0 ? `Before the programme (${range})` : `Week ${week + 1} (${range})`
}

/** A weekly mean to one decimal, so 18.4 is not flattened to 18. */
const fmtAverage = (mean: number) => mean.toLocaleString("en-US", { maximumFractionDigits: 1 })

/**
 * People active per day, as one line.
 *
 * Active is "tracked at least 15 minutes that day", the bar `UserDay` is built on (lib/analytics), so this draws the DAU the analytics export reports rather than counting it a second way. It is people, not entries: someone with three devlogs and someone with one count the same, which is why this line sits so much lower than the hours drawn below it.
 *
 * One line on one axis, so there is no second scale and no dashed series – the whole reading is where the line sits and how many are under it.
 *
 * Behind the line, one bar per programme week carries that week's average. The line is daily and spiky; the bars are the level the week was actually running at, which is the thing a single busy day hides. They share the line's scale rather than a second axis, so a bar's top compared with the line above it says whether a day beat its week.
 */
export function DauChart({ days: allDays }: { days: ActiveDay[] }) {
	const { programmeOnly, programmeStart } = useProgrammeFilter()
	const hasEarlier = allDays.some(d => d.day < programmeStart)
	const days = programmeOnly ? allDays.filter(d => d.day >= programmeStart) : allDays
	const toggle = hasEarlier ? <ProgrammeToggle /> : null

	// The weekly labels only go where the bar is wide enough to hold them, which depends on the chart's real width: the bars are laid out as percentages, so the rendered width is the one thing the SVG cannot know from its own markup. A ResizeObserver on the element keeps that measurement current as the panel is resized.
	const observer = useRef<ResizeObserver | null>(null)
	const [size, setSize] = useState({ fontPx: 10, width: 0 })
	const measure = useCallback((node: SVGSVGElement | null) => {
		observer.current?.disconnect()
		if (!node) return
		const update = () => {
			const rem = Number(getComputedStyle(document.documentElement).fontSize.replace("px", "")) || 16
			setSize({ fontPx: 0.65 * rem, width: node.getBoundingClientRect().width })
		}
		update()
		observer.current = new ResizeObserver(update)
		observer.current.observe(node)
	}, [])

	if (allDays.length === 0) return <EmptyState>Nobody has tracked 15 minutes in a day yet.</EmptyState>
	if (days.length === 0)
		return (
			<div>
				{toggle}
				<EmptyState>Nobody has tracked 15 minutes in a day since the programme began.</EmptyState>
			</div>
		)

	const plotH = CHART_H - PAD_T - PAD_B

	const values = days.map(d => d.users)
	const peak = Math.max(...values)
	// Whole people only: the step is 1, 2, 5 or 10, never a fraction of a person.
	const axis = niceTicks(peak, { integer: true })
	const mean = values.reduce((n, v) => n + v, 0) / days.length
	const weeks = weeklyAverages(days, programmeStart)

	const xOf = (i: number) => (days.length === 1 ? 0.5 : EDGE + (i / (days.length - 1)) * (1 - 2 * EDGE))
	const yFor = (v: number) => PAD_T + plotH - (v / axis.top) * plotH
	const at = days.map((d, i) => ({ x: xOf(i), y: yFor(d.users) }))
	/** One segment per pair of points, because a `d` attribute cannot carry the percentage x. */
	const segments = at.slice(1).map((point, i) => {
		const previous = at[i] ?? point
		return { x1: previous.x, x2: point.x, y1: previous.y, y2: point.y }
	})

	// A bar spans the days its week covers on the chart, not a fixed seventh of the width: the first and last weeks can be partial. The label is only kept when that pixel span can hold it plus a gutter, so a long season drops the text rather than printing one number over the next.
	const weekBars = weeks.map(week => {
		const left = days.length === 1 ? EDGE : xOf(week.start)
		const right = week.end === days.length - 1 ? 1 - EDGE : xOf(week.end + 1)
		const top = yFor(week.average)
		const label = fmtAverage(week.average)
		// 0.65em is a generous digit's width in the chart's sans face; the extra 8px is the gap to the neighbouring label.
		const fits = size.width > 0 && (right - left) * size.width >= label.length * size.fontPx * 0.65 + 8
		return {
			fits,
			from: days[week.start]?.day ?? "",
			label,
			left,
			right,
			to: days[week.end]?.day ?? "",
			top,
			week: week.week,
		}
	})

	// Evenly spaced whole people, from zero to the round top the axis chose.
	const { ticks } = axis
	const labelEvery = Math.max(1, Math.ceil(days.length / 14))
	const first = days[0]?.day
	const last = days.at(-1)?.day

	return (
		<div>
			{toggle}
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
				<span
					aria-hidden="true"
					style={{
						background: "var(--color-teal)",
						display: "inline-block",
						height: "0.15rem",
						marginRight: "0.35rem",
						verticalAlign: "middle",
						width: "0.7rem",
					}}
				/>
				active users (15+ minutes tracked), averaging {fmtInt(Math.round(mean))} a day, peaking at {fmtInt(peak)}
				<span
					aria-hidden="true"
					style={{
						background: "var(--color-teal-soft)",
						display: "inline-block",
						height: "0.55rem",
						marginLeft: "1rem",
						marginRight: "0.35rem",
						opacity: 0.45,
						verticalAlign: "middle",
						width: "0.55rem",
					}}
				/>
				weekly average
			</p>
			{/* One scale column, pinned to the chart's own row so each label sits on the gridline it names. */}
			<div style={{ alignItems: "start", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)" }}>
				<div style={{ height: `${CHART_H}px`, position: "relative", width: "2.6rem" }}>
					{ticks.map((t, i) => (
						<span
							aria-hidden="true"
							key={`t${i}`}
							style={{
								color: "var(--color-teal-ink)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								position: "absolute",
								right: 6,
								top: yFor(t),
								transform: "translateY(-50%)",
							}}
						>
							{fmtInt(t)}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							fontSize: "0.6rem",
							lineHeight: 1,
							position: "absolute",
							right: 6,
							top: -1,
						}}
					>
						users
					</span>
				</div>

				<div>
					<svg
						aria-label={`Daily active users from ${first} to ${last}: averaging ${fmtInt(Math.round(mean))} a day and peaking at ${fmtInt(peak)}, with a bar for each programme week's average`}
						height={CHART_H}
						ref={measure}
						role="img"
						style={{ display: "block" }}
						width="100%"
					>
						{weekBars.map(bar => (
							<rect
								fill="var(--color-teal-soft)"
								height={PAD_T + plotH - bar.top}
								key={bar.week}
								opacity="0.45"
								width={pct(bar.right - bar.left)}
								x={pct(bar.left)}
								y={bar.top}
							>
								<title>{`${weekName(bar.week, bar.from, bar.to)}: ${bar.label} active users a day on average`}</title>
							</rect>
						))}
						{ticks.map((t, i) => (
							<line
								key={`g${i}`}
								stroke="var(--color-line-soft)"
								strokeWidth="1"
								x1={pct(EDGE)}
								x2={pct(1 - EDGE)}
								y1={yFor(t)}
								y2={yFor(t)}
							/>
						))}
						{segments.map((segment, i) => (
							<line
								key={`l${i}`}
								stroke="var(--color-teal)"
								strokeLinecap="round"
								strokeWidth="1.75"
								x1={pct(segment.x1)}
								x2={pct(segment.x2)}
								y1={segment.y1}
								y2={segment.y2}
							/>
						))}
						{days.map((d, i) => (
							<circle cx={pct(xOf(i))} cy={yFor(d.users)} fill="var(--color-teal)" key={d.day} r="1.6">
								<title>{`${d.day}: ${fmtInt(d.users)} active ${d.users === 1 ? "person" : "people"}`}</title>
							</circle>
						))}
						{weekBars.map(bar =>
							bar.fits ? (
								<text
									fill="var(--color-teal-ink)"
									fontSize="0.65rem"
									fontWeight="600"
									key={`w${bar.week}`}
									paintOrder="stroke"
									stroke="var(--color-surface-raised)"
									strokeLinejoin="round"
									strokeWidth="2"
									style={{ fontVariantNumeric: "tabular-nums" }}
									textAnchor="middle"
									x={pct((bar.left + bar.right) / 2)}
									y={bar.top - 4}
								>
									{bar.label}
								</text>
							) : null,
						)}
					</svg>
					<DayAxis days={days} labelEvery={labelEvery} />
				</div>
			</div>
		</div>
	)
}
