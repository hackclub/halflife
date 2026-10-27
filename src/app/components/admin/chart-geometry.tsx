/**
 * The grid every activity chart draws on, shared so a change to one is a change to all.
 *
 * The top inset is a caption band: the axis's top tick lands exactly on the plot's top edge, and the axis caption sits above it, so without the band "38" prints over "h". The height carries that band rather than the plot losing it, so the data area and the gridline spacing are the size they were.
 */
export const CHART_H = 214
export const PAD_T = 24
export const PAD_B = 8

/**
 * The x axis is a share of the chart's own width and the y axis is in pixels, which is what lets a chart fill whatever panel it lands in without being measured. A percentage resolves against the SVG's viewport, so there is no viewBox and no scale factor for the HTML scale labels to fall out of step with, and the dots stay round because nothing is being stretched.
 *
 * The cost of that choice is that x can never ride in a `d` attribute – path data takes user units only – so the lines are drawn one segment per pair of points. It replaced a fixed pixel width per chart, which left most of a wide panel empty; `EDGE` is what keeps the first and last marks off the sides.
 */
export const EDGE = 0.012
export const pct = (fraction: number) => `${(fraction * 100).toFixed(3)}%`

export interface AxisTicks {
	/** The gap between two ticks. */
	step: number
	/** From zero to `top`, one per gridline. */
	ticks: number[]
	/** The axis top: the smallest round multiple of the step at or above the tallest mark. */
	top: number
}

/** Kill the float dust `0.1 * 3` leaves behind, so a label reads 0.3 rather than 0.30000000000000004. */
const tidy = (n: number) => Number(n.toPrecision(12))

/**
 * A y axis a person can read: ticks every 1, 2, 5 or 10 times a power of ten, evenly spaced, ending on a round top.
 *
 * Dividing the tallest mark into four was what made the old axes unreadable: 182 active users became gridlines at 46, 91, 137 and 182, which are neither round nor evenly spaced once rounded. Here the step is chosen from the number family first and the top grown to the next multiple of it, so every label is a multiple of the same round number and the gridlines sit an equal distance apart.
 *
 * Four intervals is the target, but the step that lands closest to it wins rather than the first one at least as tall as a quarter of the data: forcing a step up left 100 users as two intervals, which is too few to read a position off. Ties go to the smaller top, so an axis does not grow past the next tick just to keep a coarser step.
 *
 * `integer` keeps a count axis on whole units: a head count or a number of projects has no meaningful 0.5, so the step is rounded up to a whole number and the fractional candidates are dropped. Hours and per-user averages leave it off, since those legitimately divide into fractions.
 */
export function niceTicks(
	max: number,
	{ integer = false, intervals = 4 }: { integer?: boolean; intervals?: number } = {},
): AxisTicks {
	const value = Number.isFinite(max) ? Math.max(1, max) : 1
	const target = Math.max(2, intervals)
	// The step is around a target-th of the tallest mark, and every candidate is that order of magnitude times a multiple a person counts in.
	const magnitude = 10 ** Math.floor(Math.log10(value / target))
	const steps: number[] = []
	for (const multiple of [0.5, 1, 2, 5, 10, 20]) {
		const step = tidy(multiple * magnitude)
		if (integer) {
			if (step < 1) continue
			const whole = Math.round(step)
			if (!steps.includes(whole)) steps.push(whole)
		} else if (!steps.includes(step)) steps.push(step)
	}

	const candidates = steps.map(step => {
		const count = Math.max(1, Math.ceil(value / step - 1e-9))
		return { count, step, top: tidy(count * step) }
	})
	// Closest to the target interval count, then the least headroom, then the coarser step.
	const [best] = candidates.toSorted(
		(a, b) => Math.abs(a.count - target) - Math.abs(b.count - target) || a.top - b.top || b.step - a.step,
	)
	if (!best) return { step: 1, ticks: [0, 1], top: 1 }

	return {
		step: best.step,
		ticks: Array.from({ length: best.count + 1 }, (_, i) => tidy(i * best.step)),
		top: best.top,
	}
}

/**
 * The day labels under a time-series plot, one printed label per block so a long season does not squeeze "MM-DD" into a few pixels.
 */
export const DayAxis = ({ days, labelEvery }: { days: readonly { day: string }[]; labelEvery: number }) => (
	<div
		aria-hidden="true"
		style={{
			color: "var(--color-ink-muted)",
			display: "grid",
			fontSize: "0.65rem",
			gap: "1px",
			gridTemplateColumns: `repeat(${days.length}, 1fr)`,
			marginTop: "4px",
			// The plot leaves EDGE either side, so the labels take the same inset and sit under their ticks.
			paddingLeft: pct(EDGE),
			paddingRight: pct(EDGE),
		}}
	>
		{days.map((d, i) =>
			i % labelEvery === 0 ? (
				<div
					key={d.day}
					style={{
						gridColumn: `${i + 1} / span ${Math.min(labelEvery, days.length - i)}`,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{d.day.slice(5)}
				</div>
			) : null,
		)}
	</div>
)
