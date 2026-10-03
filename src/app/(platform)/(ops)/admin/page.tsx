import Link from "next/link"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getAdminCounters, getUserFlowFunnel, type FlowStep } from "@/lib/queries/admin"
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
 * The funnel as horizontal bars: each row's bar is its count share of the top
 * step, and the trailing number reads how many people made it that far — the
 * gap between rows is the drop-off.
 */
function FlowFunnel({ steps }: { steps: FlowStep[] }) {
	const top = steps[0]?.count ?? 1
	return (
		<div className="hl-stack">
			{steps.map((s) => (
				<div
					key={s.id}
					style={{
						display: "grid",
						// Fixed side columns: the middle (bar) gets the same width in
						// every row regardless of how the caption text wraps.
						gridTemplateColumns: "12rem minmax(0,1fr) 6rem",
						alignItems: "center",
						gap: "0.75rem",
					}}
				>
					<div style={{ minWidth: 0 }}>
						<div style={{ fontWeight: 700 }}>{s.label}</div>
						<div className="hl-hint" style={{ fontSize: "0.72rem" }}>
							{s.hint}
						</div>
					</div>

					<div
						aria-hidden="true"
						style={{
							position: "relative",
							height: "14px",
							background: "var(--color-border)",
							borderRadius: "999px",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								width: `${(s.count / top) * 100}%`,
								height: "100%",
								background: "var(--color-accent)",
								borderRadius: "999px",
							}}
						/>
					</div>

					<div style={{ textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>
						<div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{s.count}</div>
						<div className="hl-hint" style={{ fontSize: "0.72rem" }}>
							{s.id === "signedUp"
								? "baseline"
								: `${s.retainPct}% of previous${s.dropOffPct > 0 ? ` · ${s.dropOffPct}% stopped` : ""}`}
						</div>
					</div>
				</div>
			))}
		</div>
	)
}
