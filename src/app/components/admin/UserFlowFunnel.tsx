"use client"
import { type CSSProperties, Fragment } from "react"
import { EmptyState } from "@/app/components/ui"
import { pctOf } from "@/lib/numbers"
import type { FlowStep } from "@/lib/queries/admin"

/**
 * The funnel as an actual funnel running down the page: each stage is a trapezoid whose top edge meets the stage above it and whose bottom edge is its own share of signups, so the slope between two stages *is* the drop-off. Captions sit in a column to the left of the funnel, where text never fights the colour for contrast, and the through/stopped share for each joint is named in the connector between its two stages. Each stage is heat-coloured by the share of the previous stage it lost, from blue (no loss) to red (all lost).
 *
 * One spine, and nothing hung off the end of it. The tracked-time rows this used to draw below the last row are gone from the query with them: on a cumulative spine "of the people who got this far, how many linked Hackatime" reads a competent maker who journals and never links as a drop-off, when they dropped out of nothing. That is a branch, and the Sankey tab draws branches – devlogs, Hackatime, Lapse and reels in one activity stage, in any order, at their real widths.
 */
export function UserFlowFunnel({ steps }: { steps: FlowStep[] }) {
	if (steps.length === 0) return <EmptyState>No signups yet.</EmptyState>

	const total = steps[0]?.count ?? 0

	// Percentages against the headcount of the row above. The first row is the baseline and by definition loses nothing.
	const rows = steps.map((s, i) => {
		const prev = i === 0 ? total : (steps[i - 1]?.count ?? total)
		return {
			...s,
			dropOffPct: i > 0 ? pctOf(prev - s.count, prev) : 0,
			ofSignupsPct: pctOf(s.count, total),
			retainPct: pctOf(s.count, prev),
		}
	})

	const top = total
	// A floor so a near-total drop-off still renders as a thread rather than vanishing entirely; captions always print the true share.
	const MIN_W = 2
	const share = (n: number) => (top > 0 ? (n / top) * 100 : 0)
	const widthOf = (n: number) => (n === 0 ? 0 : Math.max(share(n), MIN_W))
	const widths = rows.map(s => widthOf(s.count))

	// Clamp a drop-off share to a 0-100 blend weight.
	const weightOf = (dropOffPct: number) => Math.min(100, Math.max(0, dropOffPct))

	// Heat of a stage, as a background from flow-through blue to total-loss red. Mixed in oklch so the middle stays vivid rather than washing out through grey the way an srgb blend does. One property, `backgroundColor`, so there is no fallback to be written in an order React could undo; a browser with no color-mix leaves the band unfilled, where the headcount pill and the captions still read the stage – the same stance `heatInk` takes with the connector text.
	const heat = (dropOffPct: number): CSSProperties => ({
		backgroundColor: `color-mix(in oklch, var(--color-danger) ${weightOf(dropOffPct)}%, var(--color-accent))`,
	})

	// The same heat for text: muted where nothing was lost, danger-ink where everything was. An unsupported color-mix just inherits body text, which still reads.
	const heatInk = (dropOffPct: number): CSSProperties => ({
		color: `color-mix(in oklch, var(--color-danger-ink) ${weightOf(dropOffPct)}%, var(--color-ink-muted))`,
	})

	// 400 where nothing was lost, 800 where everything was.
	const heatWeight = (dropOffPct: number) => 400 + Math.round(weightOf(dropOffPct) / 25) * 100

	const row = (
		s: FlowStep,
		prevWidth: number,
		bottomWidth: number,
		prevLabel: string | undefined,
		baseline: boolean,
	) => (
		<Fragment key={s.id}>
			{!baseline && s.dropOffPct > 0 && (
				<>
					<div />
					<div
						aria-label={`${s.retainPct}% continued and ${s.dropOffPct}% stopped between ${prevLabel} and ${s.label}`}
						role="note"
						style={{
							fontSize: "0.78rem",
							fontVariantNumeric: "tabular-nums",
							fontWeight: heatWeight(s.dropOffPct),
							textAlign: "center",
							...heatInk(s.dropOffPct),
						}}
					>
						↓ {s.retainPct}% through · {s.dropOffPct}% stopped
					</div>
				</>
			)}

			<div style={{ minHeight: "3.8rem", minWidth: 0 }}>
				<div style={{ fontWeight: 700 }}>
					{s.label}
					{baseline && (
						<span className="hl-hint" style={{ fontSize: "0.72rem", fontWeight: 400 }}>
							{" "}
							· baseline
						</span>
					)}
				</div>
				<div className="hl-hint" style={{ fontSize: "0.72rem" }}>
					{s.hint}
				</div>
			</div>

			<div
				aria-hidden="true"
				style={{ height: "2.75rem", position: "relative" }}
				title={`${s.label}: ${s.count} people · ${s.hint}`}
			>
				<div
					style={{
						inset: 0,
						position: "absolute",
						...heat(s.dropOffPct),
						clipPath: `polygon(${(100 - prevWidth) / 2}% 0, ${(100 + prevWidth) / 2}% 0, ${(100 + bottomWidth) / 2}% 100%, ${(100 - bottomWidth) / 2}% 100%)`,
					}}
				/>
				{/* The headcount rides inside the band, white on a dark pill so a
                        thin tail's number stays legible even where it overflows
                        the band onto the panel. */}
				<span
					style={{
						display: "grid",
						inset: 0,
						placeItems: "center",
						position: "absolute",
					}}
				>
					<span
						style={{
							background: "rgba(0,0,0,.4)",
							borderRadius: "999px",
							color: "#fff",
							fontSize: "0.88rem",
							fontVariantNumeric: "tabular-nums",
							fontWeight: 800,
							lineHeight: 1.35,
							padding: "0 0.4rem",
							whiteSpace: "nowrap",
						}}
					>
						{s.count}
						{baseline ? " users " : " "}
						<span style={{ fontSize: "0.74rem", fontWeight: 400 }}>
							· {s.ofSignupsPct}%{baseline ? " of signups" : ""}
						</span>
					</span>
				</span>
			</div>
		</Fragment>
	)

	return (
		// width:100% – the panel is a flex column, where auto margins alone shrink-wrap this to its content instead of filling the panel.
		<div style={{ margin: "0 auto", maxWidth: "56rem", width: "100%" }}>
			<div
				className="hl-hint"
				style={{
					alignItems: "center",
					display: "flex",
					gap: "0.5rem",
					justifyContent: "center",
					marginBottom: "0.6rem",
					marginTop: "1rem",
				}}
			>
				<span>no loss</span>
				<span
					aria-hidden="true"
					style={{
						background: "linear-gradient(90deg in oklch, var(--color-accent), var(--color-danger))",
						borderRadius: "999px",
						height: "0.65rem",
						width: "9rem",
					}}
				/>
				<span>all lost</span>
			</div>

			<div
				style={{
					alignItems: "center",
					columnGap: "1rem",
					display: "grid",
					gridTemplateColumns: "15rem minmax(0,1fr)",
					rowGap: "0.1rem",
				}}
			>
				{rows.map((s, i) =>
					row(s, i === 0 ? 100 : (widths[i - 1] ?? 100), widths[i] ?? 0, rows[i - 1]?.label, i === 0),
				)}
			</div>
		</div>
	)
}
