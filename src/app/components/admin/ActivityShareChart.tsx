import { EmptyState } from "@/app/components/ui"
import type { ActivityShare } from "@/lib/queries/admin"

/**
 * What share of the makers who finished onboarding did each tracked activity: one column per kind, all read off the same 0–100% scale, so the heights compare directly.
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

	const summary = share.activities.map((a) => `${a.base} ${(a.share * 100).toFixed(1)}%`).join(", ")

	return (
		<div>
			<div style={{ overflowX: "auto" }}>
				<svg
					viewBox={`0 0 ${W} ${H}`}
					role="img"
					aria-label={`Share of the ${share.total.toLocaleString("en-US")} makers who finished onboarding who did each activity: ${summary}`}
					style={{ display: "block", width: "100%", minWidth: "380px", height: "auto" }}
				>
					{[0, 0.25, 0.5, 0.75, 1].map((t) => (
						<g key={t}>
							<line
								x1={PAD_L}
								x2={W - PAD_R}
								y1={yOf(t)}
								y2={yOf(t)}
								stroke="var(--color-line-soft)"
								strokeWidth="1"
								{...(t === 0 ? {} : { strokeDasharray: "2 3" })}
							/>
							<text
								x={PAD_L - 6}
								y={yOf(t)}
								textAnchor="end"
								dominantBaseline="middle"
								style={{ fontSize: "10px", fill: "var(--color-ink-muted)", fontVariantNumeric: "tabular-nums" }}
							>
								{`${t * 100}%`}
							</text>
						</g>
					))}
					{share.activities.map((a, i) => {
						const h = a.share * plotH
						return (
							<g key={a.key}>
								<rect x={xOf(i)} y={yOf(a.share)} width={colW} height={h} rx={3} style={{ fill: "var(--color-accent)" }}>
									<title>{`${a.label}: ${a.users.toLocaleString("en-US")} of ${share.total.toLocaleString("en-US")} finishers (${(a.share * 100).toFixed(1)}%)`}</title>
								</rect>
								<text
									x={xOf(i) + colW / 2}
									y={yOf(a.share) - 7}
									textAnchor="middle"
									style={{
										fontSize: "11px",
										fontWeight: 700,
										fill: "var(--color-ink-strong)",
										fontVariantNumeric: "tabular-nums",
									}}
								>
									{(a.share * 100).toFixed(1)}%
								</text>
								<text
									x={xOf(i) + colW / 2}
									y={H - PAD_B + 18}
									textAnchor="middle"
									style={{ fontSize: "11px", fill: "var(--color-ink-muted)" }}
								>
									{a.base}
								</text>
							</g>
						)
					})}
				</svg>
			</div>

			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
				Share of the {share.total.toLocaleString("en-US")} makers who finished onboarding who did each thing – one
				maker counts in every column they reached.
			</p>
		</div>
	)
}
