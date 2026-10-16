import { EmptyState } from "@/app/components/ui"
import { fmtInt } from "@/lib/numbers"
import type { ActivityShare } from "@/lib/queries/admin"

/**
 * One stable colour per activity, plus grey for the finishers who did none of them. The Sankey assigns its colours by box order, so these do not promise to match it – the axis names are this chart's legend.
 */
const COLUMN_COLORS: { [_: string]: string } = {
	devlog: "var(--color-accent)",
	hackatime: "var(--color-flame)",
	none: "var(--color-ink-muted)",
	reel: "var(--color-teal)",
	repo: "var(--color-coin)",
	timelapse: "var(--color-magenta)",
}

/**
 * What share of the makers who finished onboarding did each tracked activity: one column per kind, all read off the same 0-100% scale, so the heights compare directly.
 *
 * One maker counts in every column they reached – the columns add up to far more than the headcount, which is the point: onboarding finishers do several of these things, and this says which ones. The counts behind the shares ride along in each column's title and in the diagram's label, so the shape and the base are both on screen.
 */
export function ActivityShareChart({ share }: { share: ActivityShare }) {
	if (share.total === 0) return <EmptyState>Nobody has finished onboarding yet.</EmptyState>

	const W = 520
	const H = 210
	const PAD_L = 40
	const PAD_R = 8
	const PAD_T = 26
	const PAD_B = 40
	const plotW = W - PAD_L - PAD_R
	const plotH = H - PAD_T - PAD_B
	const n = share.activities.length
	const slot = plotW / Math.max(1, n)
	const colW = Math.min(64, slot * 0.52)
	const xOf = (i: number) => PAD_L + slot * i + (slot - colW) / 2
	const yOf = (share_: number) => PAD_T + plotH - share_ * plotH

	const summary = share.activities.map(a => `${a.base} ${(a.share * 100).toFixed(1)}%`).join(", ")

	return (
		<div>
			<div style={{ overflowX: "auto" }}>
				<svg
					aria-label={`Share of the ${fmtInt(share.total)} makers who finished onboarding who did each activity: ${summary}`}
					role="img"
					style={{ display: "block", height: "auto", minWidth: "380px", width: "100%" }}
					viewBox={`0 0 ${W} ${H}`}
				>
					{[0, 0.25, 0.5, 0.75, 1].map(t => (
						<g key={t}>
							<line
								stroke="var(--color-line-soft)"
								strokeWidth="1"
								x1={PAD_L}
								x2={W - PAD_R}
								y1={yOf(t)}
								y2={yOf(t)}
								{...(t === 0 ? {} : { strokeDasharray: "2 3" })}
							/>
							<text
								dominantBaseline="middle"
								style={{ fill: "var(--color-ink-muted)", fontSize: "10px", fontVariantNumeric: "tabular-nums" }}
								textAnchor="end"
								x={PAD_L - 6}
								y={yOf(t)}
							>
								{`${t * 100}%`}
							</text>
						</g>
					))}
					{share.activities.map((a, i) => {
						const h = a.share * plotH
						return (
							<g key={a.key}>
								<rect
									height={h}
									rx={3}
									style={{ fill: COLUMN_COLORS[a.key] ?? "var(--color-accent)" }}
									width={colW}
									x={xOf(i)}
									y={yOf(a.share)}
								>
									<title>{`${a.label}: ${fmtInt(a.users)} of ${fmtInt(share.total)} finishers (${(a.share * 100).toFixed(1)}%)`}</title>
								</rect>
								<text
									style={{
										fill: "var(--color-ink-strong)",
										fontSize: "11px",
										fontVariantNumeric: "tabular-nums",
										fontWeight: 700,
									}}
									textAnchor="middle"
									x={xOf(i) + colW / 2}
									y={yOf(a.share) - 7}
								>
									{(a.share * 100).toFixed(1)}%
								</text>
								<text
									style={{ fill: "var(--color-ink-muted)", fontSize: "11px" }}
									textAnchor="middle"
									x={xOf(i) + colW / 2}
									y={H - PAD_B + 18}
								>
									{a.base}
								</text>
							</g>
						)
					})}
				</svg>
			</div>

			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
				Share of the {fmtInt(share.total)} makers who finished onboarding who did each thing – one maker counts in every
				column they reached. None is the finishers who did none of them.
			</p>
		</div>
	)
}
