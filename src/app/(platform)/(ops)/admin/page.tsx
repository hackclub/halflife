import Link from "next/link"
import { Fragment, type CSSProperties } from "react"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import {
	type DayActivity,
	type FlowStep,
	getAdminCounters,
	getAreaStats,
	getCountryStats,
	getDailyActivity,
	getUserFlowFunnel,
} from "@/lib/queries/admin"
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

	const [counters, syncs, flow, areas, countries, activity] = await Promise.all([
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
		getAreaStats(),
		getCountryStats(),
		getDailyActivity(),
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

			<Panel title="Users & hours by continent">
				<BreakdownBars rows={areas} />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Continents group each account&apos;s timezone; Unknown has none on file. Hours count
					journal devlogs (reviewer-adjusted where set) plus linked Hackatime time, attributed to
					the author&apos;s region.
				</p>
			</Panel>

			<Panel title="Users & hours by country">
				<BreakdownBars rows={countries.map((c) => ({ label: c.country, users: c.users, hours: c.hours }))} />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Countries map each account&apos;s timezone; zones with nothing to place read as Unknown.
				</p>
			</Panel>

			<Panel title="Activity over time">
				<ActivityStrip days={activity} />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Days are program-timezone effective dates — the day the work counted for. Hours count
					journal devlogs only.
				</p>
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

/**
 * Users and hours as horizontal bars, one row per bucket. Shared by the
 * continent and country panels — both hand it rows shaped the same way.
 */
function BreakdownBars({ rows }: { rows: { label: string; users: number; hours: number }[] }) {
	const totalUsers = rows.reduce((n, r) => n + r.users, 0)
	if (totalUsers === 0) return <EmptyState>No users yet.</EmptyState>
	const maxUsers = Math.max(...rows.map((r) => r.users))
	const fmtInt = (n: number) => n.toLocaleString("en-US")
	const fmtHours = (h: number) => `${h.toLocaleString("en-US", { maximumFractionDigits: 1 })}h`
	return (
		<div style={{ display: "grid", gap: "0.55rem" }}>
			{rows.map((r) => (
				<div
					key={r.label}
					style={{
						display: "grid",
						gridTemplateColumns: "10rem minmax(0,1fr) auto",
						gap: "0.75rem",
						alignItems: "center",
					}}
				>
					<div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
						{r.label}
					</div>
					<div
						aria-hidden="true"
						style={{
							height: "0.65rem",
							borderRadius: "999px",
							background: "color-mix(in srgb, var(--color-accent) 18%, transparent)",
						}}
					>
						<div
							style={{
								width: `${maxUsers > 0 ? (r.users / maxUsers) * 100 : 0}%`,
								height: "100%",
								borderRadius: "999px",
								background: "var(--color-accent)",
							}}
						/>
					</div>
					<div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
						{fmtInt(r.users)} · {fmtHours(r.hours)}
					</div>
				</div>
			))}
		</div>
	)
}

/**
 * Hours logged and devlogs written per day, as two strips sharing one day
 * axis. Days are program-timezone effective dates, gap-filled first to last
 * so the axis reads continuously; the strip scrolls sideways once the season
 * outgrows the panel.
 */
function ActivityStrip({ days }: { days: DayActivity[] }) {
	if (days.length === 0) return <EmptyState>No devlogs yet.</EmptyState>
	const maxHours = Math.max(1, ...days.map((d) => d.hours))
	const maxDevlogs = Math.max(1, ...days.map((d) => d.devlogs))
	const totalHours = days.reduce((n, d) => n + d.hours, 0)
	const totalDevlogs = days.reduce((n, d) => n + d.devlogs, 0)
	const labelEvery = Math.max(1, Math.ceil(days.length / 14))
	const columns = `repeat(${days.length}, minmax(5px, 1fr))`
	const fmtInt = (n: number) => n.toLocaleString("en-US")
	const fmtHours = (h: number) => `${h.toLocaleString("en-US", { maximumFractionDigits: 1 })}h`
	return (
		<div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
				<span
					aria-hidden="true"
					style={{
						display: "inline-block",
						width: "0.7rem",
						height: "0.7rem",
						borderRadius: "2px",
						background: "var(--color-accent)",
						marginRight: "0.35rem",
						verticalAlign: "baseline",
					}}
				/>
				hours ({fmtHours(totalHours)} total)
				<span
					aria-hidden="true"
					style={{
						display: "inline-block",
						width: "0.7rem",
						height: "0.7rem",
						borderRadius: "2px",
						background: "var(--color-ink-muted)",
						marginRight: "0.35rem",
						marginLeft: "1rem",
						verticalAlign: "baseline",
					}}
				/>
				devlogs ({fmtInt(totalDevlogs)} total)
			</p>
			<div style={{ overflowX: "auto" }}>
				<div style={{ minWidth: `${days.length * 9}px` }}>
					<div
						role="img"
						aria-label={`Hours logged per day from ${days[0]?.day} to ${days[days.length - 1]?.day}`}
						style={{
							display: "grid",
							gridTemplateColumns: columns,
							gap: "2px",
							alignItems: "end",
							height: "7rem",
						}}
					>
						{days.map((d) => (
							<div
								key={d.day}
								aria-hidden="true"
								title={`${d.day}: ${fmtHours(d.hours)} logged`}
								style={{
									height: `${(d.hours / maxHours) * 100}%`,
									minHeight: d.hours > 0 ? "2px" : 0,
									background: "var(--color-accent)",
									borderRadius: "2px",
								}}
							/>
						))}
					</div>
					<div
						role="img"
						aria-label={`Devlogs written per day from ${days[0]?.day} to ${days[days.length - 1]?.day}`}
						style={{
							display: "grid",
							gridTemplateColumns: columns,
							gap: "2px",
							alignItems: "end",
							height: "2.5rem",
							marginTop: "4px",
						}}
					>
						{days.map((d) => (
							<div
								key={d.day}
								aria-hidden="true"
								title={`${d.day}: ${fmtInt(d.devlogs)} devlogs`}
								style={{
									height: `${(d.devlogs / maxDevlogs) * 100}%`,
									minHeight: d.devlogs > 0 ? "2px" : 0,
									background: "var(--color-ink-muted)",
									borderRadius: "2px",
								}}
							/>
						))}
					</div>
					<div
						aria-hidden="true"
						style={{
							display: "grid",
							gridTemplateColumns: columns,
							gap: "2px",
							marginTop: "4px",
							fontSize: "0.65rem",
							color: "var(--color-ink-muted)",
						}}
					>
						{days.map((d, i) => (
							<div key={d.day} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
								{i % labelEvery === 0 ? d.day.slice(5) : ""}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}
