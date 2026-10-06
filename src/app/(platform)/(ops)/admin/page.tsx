import Link from "next/link"
import { Fragment, type CSSProperties } from "react"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { type FlowStep, getAdminCounters, getUserFlowFunnel } from "@/lib/queries/admin"
import { getLatestSyncRuns } from "@/lib/sync-run-log"

export const dynamic = "force-dynamic"

export default async function AdminOverviewPage() {
	await requireAnyPermissionPage(
		Permission.VIEW_USERS,
		Permission.MANAGE_SHOP,
		Permission.FULFILL_ORDERS,
		Permission.VIEW_AUDIT_LOG,
		Permission.MANAGE_PROGRAM,
	)

	const [counters, syncs, flow] = await Promise.all([
		getAdminCounters(),
		getLatestSyncRuns([
			"hackatime",
			"airtable_ysws",
			"airtable_rsvp",
			"airtable_loops",
			"ari_ship",
			"claim_sweep",
			"printer_reconcile",
			"help_ticket_summary",
		]),
		getUserFlowFunnel(),
	])

	return (
		<div className="hl-stack">
			<PageHeader title="Overview" />

			<div className="hl-row">
				<Stat label="Awaiting review" value={counters.pendingReviews} />
				<Stat label="Orders to fulfil" value={counters.pendingOrders} />
				<Stat label="Participants" value={counters.participants} />
				<Stat label="Printers earned" value={counters.shipped} />
			</div>

			<Panel
				title="User flow"
				actions={
					<span className="hl-hint" style={{ fontSize: "0.78rem" }}>
						each step includes everyone who completed every step above it
					</span>
				}
			>
				<FlowFunnel steps={flow} />
			</Panel>

			<Panel
				title="Scheduled jobs"
				actions={<Link href="/admin/audit?action=AIRTABLE_SYNC_FAILURE">Sync failures</Link>}
			>
				{syncs.length === 0 ? (
					<EmptyState>No job has completed yet. Run them by hand from Orchard to check the wiring.</EmptyState>
				) : (
					<Table head={["Job", "Last success", "Result"]}>
						{syncs.map((run) => (
							<tr key={run.syncKey}>
								<td className="hl-mono">{run.syncKey}</td>
								<td className="hl-mono">{run.lastRunAt.toLocaleString()}</td>
								<td className="hl-hint">{JSON.stringify(run.result)}</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>
		</div>
	)
}

/**
 * The funnel as an actual funnel running down the page: each stage is a
 * trapezoid whose top edge meets the stage above it and whose bottom edge is
 * its own share of signups, so the slope between two stages *is* the
 * drop-off. Captions sit in a column to the left of the funnel, where text
 * never fights the colour for contrast, and the through/stopped share for
 * each joint is named in the connector between its two stages. Each stage is
 * heat-coloured by the share of the previous stage it lost, from blue (no
 * loss) to red (all lost).
 */
function FlowFunnel({ steps }: { steps: FlowStep[] }) {
	if (steps.length === 0) return <EmptyState>No signups yet.</EmptyState>
	const top = steps[0]?.count ?? 0
	// A floor so a near-total drop-off still renders as a thread rather than
	// vanishing entirely; captions always print the true share.
	const MIN_W = 2
	const share = (n: number) => (top > 0 ? (n / top) * 100 : 0)
	const shown = steps.map((s) => (s.count === 0 ? 0 : Math.max(share(s.count), MIN_W)))

	// Clamp a drop-off share to a 0–100 blend weight.
	const weightOf = (dropOffPct: number) => Math.min(100, Math.max(0, dropOffPct))

	// Heat of a stage, as a background from flow-through blue to total-loss
	// red. `backgroundColor` first so browsers without color-mix still get the
	// cold end rather than nothing.
	const heat = (dropOffPct: number): CSSProperties => ({
		backgroundColor: "var(--color-accent)",
		background: `color-mix(in srgb, var(--color-danger) ${weightOf(dropOffPct)}%, var(--color-accent))`,
	})

	// The same heat for text: muted where nothing was lost, danger-ink where
	// everything was. An unsupported color-mix just inherits body text, which
	// still reads.
	const heatInk = (dropOffPct: number): CSSProperties => ({
		color: `color-mix(in srgb, var(--color-danger-ink) ${weightOf(dropOffPct)}%, var(--color-ink-muted))`,
	})

	// 400 where nothing was lost, 800 where everything was.
	const heatWeight = (dropOffPct: number) => 400 + Math.round(weightOf(dropOffPct) / 25) * 100

	return (
		// width:100% — the panel is a flex column, where auto margins alone
		// shrink-wrap this to its content instead of filling the panel.
		<div style={{ width: "100%", maxWidth: "56rem", margin: "0 auto" }}>
			<div
				className="hl-hint"
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: "0.5rem",
					marginBottom: "1rem",
				}}
			>
				<span>no loss</span>
				<span
					aria-hidden="true"
					style={{
						width: "9rem",
						height: "0.65rem",
						borderRadius: "999px",
						background: "linear-gradient(90deg, var(--color-accent), var(--color-danger))",
					}}
				/>
				<span>all lost</span>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "15rem minmax(0,1fr)",
					columnGap: "1rem",
					rowGap: "0.3rem",
					alignItems: "center",
				}}
			>
				{steps.map((s, i) => {
					const prev = i === 0 ? 100 : (shown[i - 1] ?? 100)
					const bottom = shown[i] ?? 0
					return (
						<Fragment key={s.id}>
							{i > 0 && s.dropOffPct > 0 && (
								<>
									<div />
									<div
										role="note"
										aria-label={`${s.retainPct}% continued and ${s.dropOffPct}% stopped between ${steps[i - 1]?.label} and ${s.label}`}
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

							<div style={{ minWidth: 0 }}>
								<div style={{ fontWeight: 700 }}>{s.label}</div>
								<div className="hl-hint" style={{ fontSize: "0.72rem" }}>
									{s.hint}
								</div>
								<div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
									{s.count}{" "}
									<span className="hl-hint" style={{ fontWeight: 400, fontSize: "0.78rem" }}>
										· {s.ofSignupsPct}% of signups
									</span>
								</div>
								{i === 0 && (
									<div className="hl-hint" style={{ fontSize: "0.72rem" }}>
										baseline
									</div>
								)}
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
							</div>
						</Fragment>
					)
				})}
			</div>
		</div>
	)
}
