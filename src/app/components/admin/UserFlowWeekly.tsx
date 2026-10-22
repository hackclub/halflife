"use client"
import { Fragment } from "react"
import { flowHeat, flowHeatInk, flowHeatWeight } from "@/app/components/admin/flow-heat"
import { EmptyState } from "@/app/components/ui"
import { fmtInt, pctOf } from "@/lib/numbers"
import type { WeekFlowStep } from "@/lib/queries/admin"

/**
 * The season as a funnel, one stage per week that has opened: each band is the people who handed in that week's project.
 *
 * It is a funnel in shape – bands stacked, each one's top edge meeting the one above – but not in the cumulative sense the sign-up funnel is. Week 2's project is not a rung only people who did week 1 can reach, so a band is not a share of the one above it and a later week can be wider than an earlier one. Bands are scaled against the busiest week in view rather than against signups, so the small week-to-week movements stay readable; the pill prints the real headcount and its share of signups, and nothing is read off a width that a percentage should have said.
 *
 * Bands are heat-coloured like the sign-up funnel, but by a week-over-week shortfall rather than a cumulative drop-out: a week with fewer hand-ins than the one before warms towards red in proportion, and a week that holds level or grows stays accent. The heat is a comparison between two weeks' turnout, not a cohort walking out – the projects are different ones.
 *
 * Only weeks that have opened are drawn. A future week has nobody in it because nobody could hand anything in yet, which is not the same finding as an open week nobody handed in for – the first is absence of data, the second is the data.
 */
export function UserFlowWeekly({ steps }: { steps: WeekFlowStep[] }) {
	if (steps.length === 0) return <EmptyState>No program week has opened yet.</EmptyState>

	const peak = Math.max(0, ...steps.map(step => step.count))
	// A floor so the quietest week still reads as a band rather than vanishing; a week with nobody is drawn separately.
	const MIN_W = 2
	const widthOf = (n: number) => (n === 0 ? 0 : Math.max((n / Math.max(1, peak)) * 100, MIN_W))
	const widths = steps.map(step => widthOf(step.count))

	/**
	 * The share of the week before that this week is short by. A week that matched or beat the one above lost nothing, so the heat floors at accent rather than treating growth as a negative loss.
	 */
	const dropOf = (step: WeekFlowStep, prev: WeekFlowStep | undefined) =>
		prev ? pctOf(Math.max(0, prev.count - step.count), prev.count) : 0

	/**
	 * The week-over-week change, phrased as a comparison rather than as a funnel's through/stopped share. Two weeks hold different projects, so a smaller week is fewer people handing that week in, not a cohort that dropped out of the previous one.
	 */
	const comparison = (step: WeekFlowStep, prev: WeekFlowStep) => {
		const diff = step.count - prev.count
		if (prev.count === 0)
			return step.count === 0 ? "no submitters in either week" : `↑ ${fmtInt(step.count)} from a week with none`
		if (diff === 0) return `same as ${prev.label}`
		const share = pctOf(Math.abs(diff), prev.count)
		return diff > 0
			? `↑ ${fmtInt(diff)} more than ${prev.label} · ${share}% up`
			: `↓ ${fmtInt(-diff)} fewer than ${prev.label} · ${share}% down`
	}

	const row = (step: WeekFlowStep, prev: WeekFlowStep | undefined, topWidth: number, bottomWidth: number) => {
		const drop = dropOf(step, prev)
		return (
			<Fragment key={step.week}>
				{prev ? (
					<>
						<div />
						<div
							aria-label={`${step.label}: ${fmtInt(step.count)} people handed in · ${comparison(step, prev)}`}
							role="note"
							style={{
								fontSize: "0.78rem",
								fontVariantNumeric: "tabular-nums",
								fontWeight: flowHeatWeight(drop),
								textAlign: "center",
								...flowHeatInk(drop),
							}}
						>
							{comparison(step, prev)}
						</div>
					</>
				) : null}

				<div style={{ minHeight: "3.8rem", minWidth: 0 }}>
					<div style={{ fontWeight: 700 }}>{step.label}</div>
					<div className="hl-hint" style={{ fontSize: "0.72rem" }}>
						{step.hint}
					</div>
				</div>

				<div
					aria-hidden="true"
					style={{ height: "2.75rem", position: "relative" }}
					title={`${step.label}: ${fmtInt(step.count)} people · ${step.ofSignupsPct}% of signups`}
				>
					{step.count > 0 ? (
						<div
							style={{
								...flowHeat(drop),
								clipPath: `polygon(${(100 - topWidth) / 2}% 0, ${
									(100 + topWidth) / 2
								}% 0, ${(100 + bottomWidth) / 2}% 100%, ${(100 - bottomWidth) / 2}% 100%)`,
								inset: 0,
								position: "absolute",
							}}
						/>
					) : (
						// Nobody in an open week is a finding, so the stage stays on the page as a hairline and a zero rather than disappearing.
						<div
							style={{
								borderTop: "1px dashed var(--color-line-soft)",
								left: `${(100 - topWidth) / 2}%`,
								position: "absolute",
								top: "50%",
								width: `${topWidth}%`,
							}}
						/>
					)}
					<span style={{ display: "grid", inset: 0, placeItems: "center", position: "absolute" }}>
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
							{fmtInt(step.count)} {step.count === 1 ? "user" : "users"}{" "}
							<span style={{ fontSize: "0.74rem", fontWeight: 400 }}>· {step.ofSignupsPct}% of signups</span>
						</span>
					</span>
				</div>
			</Fragment>
		)
	}

	return (
		// width:100% – the panel is a flex column, where auto margins alone shrink-wrap this to its content instead of filling the panel.
		<div style={{ margin: "0 auto", maxWidth: "56rem", width: "100%" }}>
			<div
				className="hl-hint"
				style={{
					display: "flex",
					gap: "0.5rem",
					justifyContent: "center",
					marginBottom: "0.25rem",
					marginTop: "1rem",
				}}
			>
				{peak > 0
					? `bands scale to the busiest week in view · ${fmtInt(peak)} people`
					: "no project has been handed in for an open week yet"}
			</div>

			<div
				className="hl-hint"
				style={{
					alignItems: "center",
					display: "flex",
					gap: "0.5rem",
					justifyContent: "center",
					marginBottom: "0.6rem",
				}}
			>
				<span>no drop</span>
				<span
					aria-hidden="true"
					style={{
						background: "linear-gradient(90deg in oklch, var(--color-accent), var(--color-danger))",
						borderRadius: "999px",
						height: "0.65rem",
						width: "9rem",
					}}
				/>
				<span>total drop</span>
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
				{steps.map((step, i) =>
					row(step, steps[i - 1], i === 0 ? (widths[0] ?? 0) : (widths[i - 1] ?? 0), widths[i] ?? 0),
				)}
			</div>
		</div>
	)
}
