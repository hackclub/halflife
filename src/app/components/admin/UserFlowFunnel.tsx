"use client"
import { type CSSProperties, Fragment, useState } from "react"
import { EmptyState } from "@/app/components/ui"
import type { FlowStep } from "@/lib/queries/admin"

// The reel steps a program with its reels turned off wants out of the way. The funnel still fetches them (the data is cheap and shared), and the toggle just filters them here, so flipping it is instant and never round-trips.
const REEL_STEP_IDS = new Set(["startedUpload", "uploadedReel", "postedReel"])

/**
 * The funnel as an actual funnel running down the page: each stage is a trapezoid whose top edge meets the stage above it and whose bottom edge is its own share of signups, so the slope between two stages *is* the drop-off. Captions sit in a column to the left of the funnel, where text never fights the colour for contrast, and the through/stopped share for each joint is named in the connector between its two stages. Each stage is heat-coloured by the share of the previous stage it lost, from blue (no loss) to red (all lost).
 *
 * Hiding the reel steps is a client-side view option, not a stored setting: the shares below a hidden stage are recomputed against the stage that is now above it, so the drop-off across a hidden row reads as one joint rather than vanishing with it.
 */
export function UserFlowFunnel({ steps }: { steps: FlowStep[] }) {
	const [hideReel, setHideReel] = useState(false)

	if (steps.length === 0) return <EmptyState>No signups yet.</EmptyState>

	const total = steps[0]?.count ?? 0
	const visible = hideReel ? steps.filter((s) => !REEL_STEP_IDS.has(s.id)) : steps
	const shownSteps = visible.map((s, i) => {
		const prev = i === 0 ? total : (visible[i - 1]?.count ?? total)
		return {
			...s,
			retainPct: prev === 0 ? 0 : Math.round((s.count / prev) * 1000) / 10,
			dropOffPct: i === 0 || prev === 0 ? 0 : Math.round(((prev - s.count) / prev) * 1000) / 10,
			ofSignupsPct: total === 0 ? 0 : Math.round((s.count / total) * 1000) / 10,
		}
	})

	const top = total
	// A floor so a near-total drop-off still renders as a thread rather than vanishing entirely; captions always print the true share.
	const MIN_W = 2
	const share = (n: number) => (top > 0 ? (n / top) * 100 : 0)
	const shown = shownSteps.map((s) => (s.count === 0 ? 0 : Math.max(share(s.count), MIN_W)))

	// Clamp a drop-off share to a 0-100 blend weight.
	const weightOf = (dropOffPct: number) => Math.min(100, Math.max(0, dropOffPct))

	// Heat of a stage, as a background from flow-through blue to total-loss red. Mixed in oklch so the middle stays vivid rather than washing out through grey the way an srgb blend does. `backgroundColor` first so browsers without color-mix still get the cold end rather than nothing.
	const heat = (dropOffPct: number): CSSProperties => ({
		backgroundColor: "var(--color-accent)",
		background: `color-mix(in oklch, var(--color-danger) ${weightOf(dropOffPct)}%, var(--color-accent))`,
	})

	// The same heat for text: muted where nothing was lost, danger-ink where everything was. An unsupported color-mix just inherits body text, which still reads.
	const heatInk = (dropOffPct: number): CSSProperties => ({
		color: `color-mix(in oklch, var(--color-danger-ink) ${weightOf(dropOffPct)}%, var(--color-ink-muted))`,
	})

	// 400 where nothing was lost, 800 where everything was.
	const heatWeight = (dropOffPct: number) => 400 + Math.round(weightOf(dropOffPct) / 25) * 100

	return (
		// width:100% – the panel is a flex column, where auto margins alone shrink-wrap this to its content instead of filling the panel.
		<div style={{ width: "100%", maxWidth: "56rem", margin: "0 auto" }}>
			<label
				className="hl-row"
				style={{
					gap: "0.5rem",
					justifyContent: "center",
					marginBottom: "0.6rem",
					cursor: "pointer",
				}}
			>
				<input type="checkbox" checked={hideReel} onChange={(e) => setHideReel(e.target.checked)} />
				<span className="hl-hint">Hide reel steps</span>
			</label>

			<div
				className="hl-hint"
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: "0.5rem",
					marginBottom: "0.6rem",
				}}
			>
				<span>no loss</span>
				<span
					aria-hidden="true"
					style={{
						width: "9rem",
						height: "0.65rem",
						borderRadius: "999px",
						background: "linear-gradient(90deg in oklch, var(--color-accent), var(--color-danger))",
					}}
				/>
				<span>all lost</span>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "15rem minmax(0,1fr)",
					columnGap: "1rem",
					rowGap: "0.1rem",
					alignItems: "center",
				}}
			>
				{shownSteps.map((s, i) => {
					const prev = i === 0 ? 100 : (shown[i - 1] ?? 100)
					const bottom = shown[i] ?? 0
					return (
						<Fragment key={s.id}>
							{i > 0 && s.dropOffPct > 0 && (
								<>
									<div />
									<div
										role="note"
										aria-label={`${s.retainPct}% continued and ${s.dropOffPct}% stopped between ${shownSteps[i - 1]?.label} and ${s.label}`}
										style={{
											textAlign: "center",
											fontSize: "0.78rem",
											fontWeight: heatWeight(s.dropOffPct),
											fontVariantNumeric: "tabular-nums",
											...heatInk(s.dropOffPct),
										}}
									>
										↓ {s.retainPct}% through · {s.dropOffPct}% stopped
									</div>
								</>
							)}

							<div style={{ minWidth: 0, minHeight: "3.8rem" }}>
								<div style={{ fontWeight: 700 }}>
									{s.label}
									{i === 0 && (
										<span className="hl-hint" style={{ fontWeight: 400, fontSize: "0.72rem" }}>
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
								title={`${s.label}: ${s.count} people · ${s.hint}`}
								style={{ position: "relative", height: "2.75rem" }}
							>
								<div
									style={{
										position: "absolute",
										inset: 0,
										...heat(s.dropOffPct),
										clipPath: `polygon(${(100 - prev) / 2}% 0, ${(100 + prev) / 2}% 0, ${(100 + bottom) / 2}% 100%, ${(100 - bottom) / 2}% 100%)`,
									}}
								/>
								{/* The headcount rides inside the band, white on a dark pill so a
                    thin tail's number stays legible even where it overflows
                    the band onto the panel. */}
								<span
									style={{
										position: "absolute",
										inset: 0,
										display: "grid",
										placeItems: "center",
									}}
								>
									<span
										style={{
											fontWeight: 800,
											fontVariantNumeric: "tabular-nums",
											fontSize: "0.88rem",
											lineHeight: 1.35,
											color: "#fff",
											padding: "0 0.4rem",
											borderRadius: "999px",
											background: "rgba(0,0,0,.4)",
											whiteSpace: "nowrap",
										}}
									>
										{s.count}
										{i === 0 ? " users " : " "}
										<span style={{ fontWeight: 400, fontSize: "0.74rem" }}>
											· {s.ofSignupsPct}%{i === 0 ? " of signups" : ""}
										</span>
									</span>
								</span>
							</div>
						</Fragment>
					)
				})}
			</div>
		</div>
	)
}
