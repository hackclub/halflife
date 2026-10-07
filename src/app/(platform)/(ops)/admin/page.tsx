import Link from "next/link"
import { UserFlowFunnel } from "@/app/components/admin/UserFlowFunnel"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import {
	type DayActivity,
	type FirstProjectStat,
	getAdminCounters,
	getAreaStats,
	getCountryStats,
	getDailyActivity,
	getFirstProjectStats,
	getUserFlowFunnel,
} from "@/lib/queries/admin"
import { getLatestSyncRuns } from "@/lib/sync-run-log"

export const dynamic = "force-dynamic"

const fmtInt = (n: number) => n.toLocaleString("en-US")
const fmtHours = (h: number) => `${h.toLocaleString("en-US", { maximumFractionDigits: 1 })}h`

export default async function AdminOverviewPage() {
	await requireAnyPermissionPage(
		Permission.VIEW_USERS,
		Permission.MANAGE_SHOP,
		Permission.FULFILL_ORDERS,
		Permission.VIEW_AUDIT_LOG,
		Permission.MANAGE_PROGRAM,
	)

	const [counters, syncs, flow, areas, countries, activity, firstProjects] = await Promise.all([
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
		getFirstProjectStats(),
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
				<UserFlowFunnel steps={flow} />
			</Panel>

			<Panel title="Users & hours by continent">
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
						gap: "1.5rem",
						alignItems: "start",
					}}
				>
					<MetricPie title="Users" rows={areas} pick={(r) => r.users} format={fmtInt} />
					<MetricPie title="Hours" rows={areas} pick={(r) => r.hours} format={fmtHours} />
				</div>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Continents group each account&apos;s timezone; Unknown has none on file. Hours count journal devlogs
					(reviewer-adjusted where set) plus linked Hackatime time, attributed to the author&apos;s region.
				</p>
			</Panel>

			<Panel title="Users & hours by country">
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
						gap: "1.5rem",
						alignItems: "start",
					}}
				>
					<MetricPie
						title="Users"
						rows={countries.map((c) => ({ label: c.country, users: c.users, hours: c.hours }))}
						pick={(r) => r.users}
						format={fmtInt}
					/>
					<MetricPie
						title="Hours"
						rows={countries.map((c) => ({ label: c.country, users: c.users, hours: c.hours }))}
						pick={(r) => r.hours}
						format={fmtHours}
					/>
				</div>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Countries map each account&apos;s timezone; zones with nothing to place read as Unknown.
				</p>
			</Panel>

			<Panel title="First project choice">
				<FirstProjectDonut stats={firstProjects} />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Users who finished setup and still have their week-one project. Starter names come from the catalogue; Custom
					project means they named their own idea.
				</p>
			</Panel>

			<Panel title="Activity over time">
				<ActivityStrip days={activity} />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Days are program-timezone effective dates – the day the work counted for. Hours count journal devlogs only.
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
 * One metric as a donut pie: the biggest slices named, the long tail folded into Other. Shared by the continent and country panels, once for users and once for hours – both hand it rows shaped the same way and say which field to cut by.
 */
function MetricPie({
	title,
	rows,
	pick,
	format,
}: {
	title: string
	rows: { label: string; users: number; hours: number }[]
	pick: (row: { label: string; users: number; hours: number }) => number
	format: (n: number) => string
}) {
	const ranked = rows
		.map((r) => ({ label: r.label, value: pick(r) }))
		.filter((s) => s.value > 0)
		.sort((a, b) => b.value - a.value)
	const total = ranked.reduce((n, s) => n + s.value, 0)
	if (total === 0) return <EmptyState>No data yet.</EmptyState>

	// Past six the wedges turn to slivers, so the rest reads as one slice. The legend names the same slices, so the pie and its key never disagree.
	const MAX_SLICES = 6
	const head = ranked.slice(0, MAX_SLICES)
	const tail = ranked.slice(MAX_SLICES)
	const slices =
		tail.length > 0
			? [...head, { label: `Other (${tail.length})`, value: tail.reduce((n, s) => n + s.value, 0) }]
			: head

	const COLORS = [
		"var(--color-accent)",
		"var(--color-teal)",
		"var(--color-coin)",
		"var(--color-flame)",
		"var(--color-magenta)",
		"var(--color-ink-strong)",
		"var(--color-field-edge)",
	]
	const colored = slices.map((s, i) => ({
		...s,
		// Other is always the grey tail, whatever landed in the last slot.
		color: s.label.startsWith("Other (")
			? "var(--color-field-edge)"
			: (COLORS[i % COLORS.length] ?? "var(--color-accent)"),
		pct: (s.value / total) * 100,
	}))
	const only = colored.length === 1 ? colored[0] : undefined

	const R = 88
	const HOLE = 56
	const CX = 100
	const CY = 100
	const point = (radius: number, angleDeg: number) => {
		const a = ((angleDeg - 90) * Math.PI) / 180
		return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a) }
	}

	let angle = 0
	const wedges = colored.map((s) => {
		const sweep = (s.value / total) * 360
		const w = { ...s, from: angle, sweep }
		angle += sweep
		return w
	})

	const summary = colored
		.slice(0, 3)
		.map((s) => `${s.label} ${s.pct.toFixed(1)}%`)
		.join(", ")

	return (
		<figure style={{ margin: 0 }}>
			<figcaption style={{ fontWeight: 800, textAlign: "center", marginBottom: "0.5rem" }}>
				{title} · {format(total)}
			</figcaption>
			<div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
				<svg
					viewBox="0 0 200 200"
					role="img"
					aria-label={`${title} by share: ${summary}${colored.length > 3 ? ", and more" : ""}`}
					style={{ width: "11rem", height: "11rem", flexShrink: 0 }}
				>
					{only ? (
						<>
							<circle cx={CX} cy={CY} r={R} style={{ fill: only.color }} />
							<circle cx={CX} cy={CY} r={HOLE} fill="#fff" />
						</>
					) : (
						wedges.map((w) => {
							const to = w.from + w.sweep
							const outerFrom = point(R, w.from)
							const outerTo = point(R, to)
							const innerTo = point(HOLE, to)
							const innerFrom = point(HOLE, w.from)
							const large = w.sweep > 180 ? 1 : 0
							return (
								<path
									key={w.label}
									d={`M ${outerFrom.x} ${outerFrom.y} A ${R} ${R} 0 ${large} 1 ${outerTo.x} ${outerTo.y} L ${innerTo.x} ${innerTo.y} A ${HOLE} ${HOLE} 0 ${large} 0 ${innerFrom.x} ${innerFrom.y} Z`}
									style={{ fill: w.color, stroke: "#fff", strokeWidth: 2 }}
								>
									<title>{`${w.label}: ${format(w.value)} (${w.pct.toFixed(1)}%)`}</title>
								</path>
							)
						})
					)}
					<text
						x={CX}
						y={CY - 2}
						textAnchor="middle"
						style={{ fontSize: "1.35rem", fontWeight: 800, fill: "var(--color-ink-strong)" }}
					>
						{format(total)}
					</text>
					<text x={CX} y={CY + 20} textAnchor="middle" style={{ fontSize: "0.8rem", fill: "var(--color-ink-muted)" }}>
						total {title.toLowerCase()}
					</text>
				</svg>
				<ul
					style={{
						listStyle: "none",
						margin: 0,
						padding: 0,
						display: "grid",
						gap: "0.3rem",
						minWidth: "10rem",
						flex: "1 1 10rem",
					}}
				>
					{colored.map((s) => (
						<li key={s.label} style={{ display: "flex", alignItems: "baseline", gap: "0.45rem", fontSize: "0.82rem" }}>
							<span
								aria-hidden="true"
								style={{
									display: "inline-block",
									width: "0.7rem",
									height: "0.7rem",
									borderRadius: "3px",
									background: s.color,
									flexShrink: 0,
									alignSelf: "center",
								}}
							/>
							<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
							<span style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
								{format(s.value)} · {s.pct.toFixed(1)}%
							</span>
						</li>
					))}
				</ul>
			</div>
		</figure>
	)
}

/**
 * Hours logged and devlogs written per day, as two strips sharing one day axis. Days are program-timezone effective dates, gap-filled first to last so the axis reads continuously; the strip scrolls sideways once the season outgrows the panel.
 */
function ActivityStrip({ days }: { days: DayActivity[] }) {
	if (days.length === 0) return <EmptyState>No devlogs yet.</EmptyState>
	const maxHours = Math.max(1, ...days.map((d) => d.hours))
	const maxDevlogs = Math.max(1, ...days.map((d) => d.devlogs))
	const totalHours = days.reduce((n, d) => n + d.hours, 0)
	const totalDevlogs = days.reduce((n, d) => n + d.devlogs, 0)
	const labelEvery = Math.max(1, Math.ceil(days.length / 14))
	const columns = `repeat(${days.length}, minmax(5px, 1fr))`
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

/**
 * First-project choice as a donut: one slice per starter plus Custom, with a legend carrying the counts. Segments are SVG circles rather than a chart dependency – the page's other visuals are hand-rolled the same way – and the figure carries a text summary so the shares do not live in colour alone.
 */
function FirstProjectDonut({ stats }: { stats: FirstProjectStat[] }) {
	const total = stats.reduce((n, s) => n + s.users, 0)
	if (total === 0) return <EmptyState>No finished setups yet.</EmptyState>
	const palette = [
		"var(--color-accent)",
		"var(--color-magenta)",
		"var(--color-teal)",
		"var(--color-coin)",
		"var(--color-flame)",
		"var(--color-ink-strong)",
		"var(--color-teal-soft)",
		"var(--color-ink-muted)",
	]
	const R = 15.9155 // 100 / 2π: a share of p% is a dash of p units
	// Segment offsets, computed up front: each slice starts where the last one ended, from path position 0 (3 o'clock). A positive dashoffset does NOT move the start forward – it starts the path that far into the pattern, eating the first segment's opening units (a grey quadrant, in the old code's case) – so the top start comes from the rotate below instead.
	const shares = stats.map((s) => (s.users / total) * 100)
	const segments = stats.map((s, i) => ({
		label: s.label,
		share: shares[i] ?? 0,
		start: -shares.slice(0, i).reduce((n, p) => n + p, 0),
	}))
	const summary = stats.map((s) => `${s.label} ${Math.round((s.users / total) * 100)}%`).join(", ")
	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: "1.5rem",
				alignItems: "center",
			}}
		>
			<svg
				role="img"
				aria-label={`First project choice: ${summary}`}
				viewBox="0 0 42 42"
				style={{ width: "11rem", height: "11rem", flexShrink: 0 }}
			>
				<circle cx="21" cy="21" r={R} fill="none" stroke="var(--color-surface-sunken)" strokeWidth="7" />
				{/* The ring starts at 3 o'clock; rotate it so it starts at the top. */}
				<g transform="rotate(-90 21 21)">
					{segments.map((seg, i) => (
						<circle
							key={seg.label}
							cx="21"
							cy="21"
							r={R}
							fill="none"
							stroke={palette[i % palette.length]}
							strokeWidth="7"
							strokeDasharray={`${Math.max(seg.share - 0.6, 0)} 100`}
							strokeDashoffset={seg.start}
						/>
					))}
				</g>
			</svg>
			<ul style={{ display: "grid", gap: "0.4rem", listStyle: "none", margin: 0, padding: 0, minWidth: 0 }}>
				{stats.map((s, i) => (
					<li
						key={s.label}
						style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", fontVariantNumeric: "tabular-nums" }}
					>
						<span
							aria-hidden="true"
							style={{
								width: "0.7rem",
								height: "0.7rem",
								borderRadius: "2px",
								background: palette[i % palette.length],
								flexShrink: 0,
								alignSelf: "center",
							}}
						/>
						<span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
							{s.label}
						</span>
						<span className="hl-hint">
							{s.users.toLocaleString("en-US")} · {Math.round((s.users / total) * 100)}%
						</span>
					</li>
				))}
			</ul>
		</div>
	)
}
