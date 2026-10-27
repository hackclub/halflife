/**
 * The grid every activity chart draws on, shared so a change to one is a change to all.
 *
 * The top inset is a caption band: a tick at the maximum lands exactly on the plot's top edge, and the axis caption sits above it, so without the band "38" prints over "h". The height carries that band rather than the plot losing it, so the data area and the gridline spacing are the size they were.
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
