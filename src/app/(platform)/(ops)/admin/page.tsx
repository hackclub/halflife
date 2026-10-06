import Link from "next/link"
import type { CSSProperties } from "react"
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
 * drop-off. A stage that loses more than half of the previous stage renders
 * in red, with the loss named in the connector above it.
 */
function FlowFunnel({ steps }: { steps: FlowStep[] }) {
	if (steps.length === 0) return <EmptyState>No signups yet.</EmptyState>
	const top = steps[0]?.count ?? 0
	// A stage narrower than this still renders, so a near-total drop-off reads
	// as a sliver rather than vanishing; captions always print the true share.
	const MIN_W = 12
	const share = (n: number) => (top > 0 ? (n / top) * 100 : 0)
	const shown = steps.map((s) => (s.count === 0 ? 0 : Math.max(share(s.count), MIN_W)))

	const dot = (color: string): CSSProperties => ({
		display: "inline-block",
		width: "0.7em",
		height: "0.7em",
		borderRadius: "2px",
		background: color,
		marginRight: "0.35rem",
		verticalAlign: "baseline",
	})

	return (
		<div style={{ maxWidth: "36rem", margin: "0 auto" }}>
			<div
				className="hl-hint"
				style={{ display: "flex", gap: "1.25rem", justifyContent: "center", marginBottom: "1rem" }}
			>
				<span>
					<span style={dot("var(--color-accent)")} aria-hidden="true" />
					flow-through
				</span>
				<span>
					<span style={dot("var(--color-danger)")} aria-hidden="true" />
					lost over half at this step
				</span>
			</div>

			{steps.map((s, i) => {
				const prev = i === 0 ? 100 : (shown[i - 1] ?? 100)
				const bottom = shown[i] ?? 0
				const bigDrop = s.dropOffPct > 50
				// Narrow slivers sit mostly on the panel background, so their
				// caption stays dark; wide stages carry light text on colour.
				const narrow = (shown[i] ?? 0) < 40
				return (
					<div key={s.id}>
						{i > 0 && (
							<div
								role="note"
								aria-label={
									bigDrop
										? `${s.dropOffPct}% stopped between ${steps[i - 1]?.label} and ${s.label}`
										: `${s.retainPct}% continued to ${s.label}`
								}
								style={{
									textAlign: "center",
									fontSize: "0.78rem",
									fontWeight: bigDrop ? 800 : 400,
									color: bigDrop ? "var(--color-danger-ink)" : "var(--color-ink-muted)",
									padding: "0.3rem 0",
									fontVariantNumeric: "tabular-nums",
								}}
							>
								↓ {bigDrop ? `${s.dropOffPct}% stopped` : `${s.retainPct}% through`}
							</div>
						)}

						<div
							title={`${s.label}: ${s.count} people · ${s.hint}`}
							style={{ position: "relative", height: "3.75rem" }}
						>
							<div
								aria-hidden="true"
								style={{
									position: "absolute",
									inset: 0,
									background: bigDrop ? "var(--color-danger)" : "var(--color-accent)",
									clipPath: `polygon(${(100 - prev) / 2}% 0, ${(100 + prev) / 2}% 0, ${(100 + bottom) / 2}% 100%, ${(100 - bottom) / 2}% 100%)`,
								}}
							/>
							<div
								style={{
									position: "relative",
									height: "100%",
									display: "flex",
									flexDirection: "column",
									alignItems: "center",
									justifyContent: "center",
									gap: "0.1rem",
									padding: "0 0.5rem",
									textAlign: "center",
									color: narrow ? "var(--color-ink-strong)" : "#fff",
								}}
							>
								<div style={{ fontWeight: 800, lineHeight: 1.15, overflowWrap: "anywhere" }}>
									{s.label} · <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.count}</span>
								</div>
								<div style={{ fontSize: "0.72rem", opacity: narrow ? 0.75 : 0.9 }}>
									{i === 0 ? "baseline" : `${s.ofSignupsPct}% of signups`}
								</div>
							</div>
						</div>
					</div>
				)
			})}
		</div>
	)
}
