import Link from "next/link"
import { UserFlowDiagram } from "@/app/components/admin/UserFlowDiagram"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import type { ReviewResult } from "@/app/generated/prisma/enums"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import {
	type DayActivity,
	getAdminCounters,
	getAreaStats,
	getCountryStats,
	getDailyActivity,
	getFirstProjectStats,
	getHoursDistribution,
	getReviewerStats,
	getUserFlowFunnel,
	getUserFlowSankey,
	getVerificationStats,
	type HoursDistribution,
} from "@/lib/queries/admin"
import { getLatestSyncRuns } from "@/lib/sync-run-log"

export const dynamic = "force-dynamic"

const fmtInt = (n: number) => n.toLocaleString("en-US")
const fmtHours = (h: number) => `${h.toLocaleString("en-US", { maximumFractionDigits: 1 })}h`

/** Outcome wording, the same one a maker is told in lib/notifications. */
const RESULT_LABEL: Record<ReviewResult, string> = {
	APPROVED: "Approved",
	RETURNED: "Changes requested",
	REJECTED: "Rejected",
}

export default async function AdminOverviewPage() {
	await requireAnyPermissionPage(
		Permission.VIEW_USERS,
		Permission.MANAGE_SHOP,
		Permission.FULFILL_ORDERS,
		Permission.VIEW_AUDIT_LOG,
		Permission.MANAGE_PROGRAM,
	)

	const [
		counters,
		syncs,
		flow,
		sankey,
		areas,
		countries,
		activity,
		hoursSpread,
		firstProjects,
		verification,
		reviewer,
	] = await Promise.all([
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
		getUserFlowSankey(),
		getAreaStats(),
		getCountryStats(),
		getDailyActivity(),
		getHoursDistribution(),
		getFirstProjectStats(),
		getVerificationStats(),
		getReviewerStats(),
	])

	return (
		<div className="hl-stack">
			<PageHeader title="Overview" />

			<div className="hl-row">
				<Stat label="Orders to fulfil" value={counters.pendingOrders} />
				<Stat label="Participants" value={counters.participants} />
				<Stat label="Printers earned" value={counters.shipped} />
			</div>

			<Panel
				title="Reviewer activity"
				actions={
					<span className="hl-hint" style={{ fontSize: "0.78rem" }}>
						mirrors Ari, so no need to open it for the totals
					</span>
				}
			>
				<div className="hl-row">
					<Stat label="Awaiting review" value={counters.pendingReviews} />
					<Stat label="Reviewed today" value={reviewer.reviewedToday} />
					<Stat label="Reviewed total" value={reviewer.reviewedTotal} />
				</div>
				<Table head={["Outcome", "Today", "All time"]}>
					{reviewer.byResult.map((row) => (
						<tr key={row.result}>
							<td>{RESULT_LABEL[row.result]}</td>
							<td className="hl-mono">{fmtInt(row.today)}</td>
							<td className="hl-mono">{fmtInt(row.total)}</td>
						</tr>
					))}
				</Table>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Awaiting review counts hand-ins; the other three count projects, once however many of their phases were
					reviewed, shown by the outcome standing now – a project approved on design and sent back on build reads as
					changes requested. Ari&apos;s decisions are included. A review an admin or Ari later undid no longer counts.
				</p>
			</Panel>

			<UserFlowDiagram steps={flow} sankey={sankey} />

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
				<ShareDonut
					measure="First project choice"
					empty="No finished setups yet."
					rows={firstProjects.map((s) => ({ label: s.label, value: s.users }))}
				/>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Users who finished setup and still have their week-one project. Starter names come from the catalogue; Custom
					project means they named their own idea.
				</p>
			</Panel>

			<Panel title="Identity verification">
				<ShareDonut
					measure="Identity status"
					empty="No accounts yet."
					rows={verification.map((s) => ({ label: s.label, value: s.users }))}
				/>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Hack Club Auth&apos;s own reading of each account, taken at its last sign-in or submit. Only a verified
					identity can be paid; needs submission is somebody part-way through IDV, and not asked is an account no
					sign-in has reported on yet.
				</p>
			</Panel>

			<Panel title="Hours per participant">
				<HoursHistogram data={hoursSpread} />
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
 * Hours logged and devlogs written per day, as two line series over a shared day axis.
 *
 * Hours as a continuous line rather than the bar strip this replaced, because the shape is the question: a bar per
 * day made a steady week look like a spike next to a quiet one, since each bar was scaled to the panel rather than
 * to its neighbours. On a line, a flat stretch reads as flat.
 *
 * Devlogs stay bars, under the hours line and on its own scale – they are a different magnitude (10,872 devlogs
 * against 28,063 hours) and are read as a count rather than a trend, so sharing an axis would flatten one of them
 * into nothing.
 */
function ActivityStrip({ days }: { days: DayActivity[] }) {
	if (days.length === 0) return <EmptyState>No devlogs yet.</EmptyState>

	const W = 1000
	const H = 150
	const PAD_L = 34
	const PAD_R = 6
	const PAD_T = 8
	const PAD_B = 16
	const plotW = W - PAD_L - PAD_R
	const plotH = H - PAD_T - PAD_B

	const maxHours = Math.max(1, ...days.map((d) => d.hours))
	const maxDevlogs = Math.max(1, ...days.map((d) => d.devlogs))
	const totalHours = days.reduce((n, d) => n + d.hours, 0)
	const totalDevlogs = days.reduce((n, d) => n + d.devlogs, 0)

	// One x per day even when there are hundreds, so a single day is a single vertex rather than a skipped
	// segment: a polyline across index positions keeps the spacing honest at any length.
	const xOf = (i: number) => PAD_L + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW)
	const yHours = (h: number) => PAD_T + plotH - (h / maxHours) * plotH
	const hoursPath = days
		.map((d, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yHours(d.hours).toFixed(1)}`)
		.join(" ")
	const areaPath = `${hoursPath} L ${xOf(days.length - 1).toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L ${xOf(0).toFixed(1)} ${(
		PAD_T + plotH
	).toFixed(1)} Z`

	// Four gridlines, rounded to something a person would say: 0, a quarter, half, three quarters and the top.
	const ticks = Array.from({ length: 5 }, (_, i) => (maxHours / 4) * i)
	const labelEvery = Math.max(1, Math.ceil(days.length / 14))
	const first = days[0]?.day
	const last = days[days.length - 1]?.day

	return (
		<div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
				<span
					aria-hidden="true"
					style={{
						display: "inline-block",
						width: "0.7rem",
						height: "0.15rem",
						background: "var(--color-accent)",
						marginRight: "0.35rem",
						verticalAlign: "middle",
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
				<div style={{ minWidth: `${Math.max(days.length * 3, 480)}px` }}>
					<svg
						viewBox={`0 0 ${W} ${H}`}
						role="img"
						aria-label={`Hours logged per day from ${first} to ${last}, peaking at ${fmtHours(maxHours)}`}
						// Height left to the viewBox ratio rather than pinned: scaling to fit a fixed height would
						// stretch the drawing non-uniformly, and the per-day dots come out as ellipses.
						style={{ width: "100%", height: "auto", display: "block" }}
					>
						{ticks.map((t) => (
							<g key={t}>
								<line
									x1={PAD_L}
									x2={W - PAD_R}
									y1={yHours(t)}
									y2={yHours(t)}
									stroke="var(--color-line-soft)"
									strokeWidth="1"
									vectorEffect="non-scaling-stroke"
								/>
								<text
									x={PAD_L - 6}
									y={yHours(t) + 3}
									textAnchor="end"
									style={{ fontSize: "9px", fill: "var(--color-ink-muted)" }}
								>
									{fmtHours(t)}
								</text>
							</g>
						))}
						<path d={areaPath} fill="var(--color-accent)" opacity="0.12" />
						<path
							d={hoursPath}
							fill="none"
							stroke="var(--color-accent)"
							strokeWidth="2"
							strokeLinejoin="round"
							vectorEffect="non-scaling-stroke"
						/>
						{days.map((d, i) => (
							<circle key={d.day} cx={xOf(i)} cy={yHours(d.hours)} r="2" fill="var(--color-accent)">
								<title>{`${d.day}: ${fmtHours(d.hours)} logged`}</title>
							</circle>
						))}
					</svg>
					<div
						role="img"
						aria-label={`Devlogs written per day from ${first} to ${last}`}
						style={{
							display: "grid",
							gridTemplateColumns: `repeat(${days.length}, 1fr)`,
							gap: "1px",
							alignItems: "end",
							height: "2.5rem",
							marginTop: "6px",
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
							gridTemplateColumns: `repeat(${days.length}, 1fr)`,
							gap: "1px",
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
 * How the cohort's hours are spread: one bar per bucket of participants, tallest where most people sit.
 *
 * Bars rather than a step line, because the question is "how many people are in each band", which is a count per
 * band and reads as a count. Every bar is labelled with its own number, so the shape never has to be read off a
 * y-axis – which matters here because the bands are unequal by design and the tallest is several times the
 * shortest.
 *
 * Accounts with no hours are stated as a count rather than drawn: at three quarters of the cohort, a zero bar
 * would be several times the tallest real one and would flatten the whole distribution to make room.
 */
function HoursHistogram({ data }: { data: HoursDistribution }) {
	if (data.withHours === 0) return <EmptyState>No hours logged yet.</EmptyState>

	const max = Math.max(1, ...data.buckets.map((b) => b.participants))
	const summary = data.buckets
		.filter((b) => b.participants > 0)
		.map((b) => `${b.label} hours ${b.participants}`)
		.join(", ")

	return (
		<div>
			<div className="hl-row" style={{ gap: "1.25rem", marginBottom: "0.9rem" }}>
				<Stat label="Accounts with hours" value={fmtInt(data.withHours)} />
				<Stat label="Median hours" value={data.median === null ? "—" : fmtHours(data.median)} />
				<Stat label="Total hours" value={fmtHours(data.totalHours)} />
			</div>
			<figure style={{ margin: 0 }}>
				<div
					role="img"
					aria-label={`Participants by hours logged: ${summary}`}
					style={{
						display: "grid",
						gridTemplateColumns: `repeat(${data.buckets.length}, 1fr)`,
						gap: "4px",
						alignItems: "end",
					}}
				>
					{data.buckets.map((b) => (
						<div
							key={b.label}
							style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: "0.3rem" }}
						>
							<span
								aria-hidden="true"
								style={{
									fontSize: "0.72rem",
									fontVariantNumeric: "tabular-nums",
									textAlign: "center",
									color: "var(--color-ink-muted)",
								}}
							>
								{b.participants > 0 ? fmtInt(b.participants) : ""}
							</span>
							<div
								title={`${b.label}h: ${fmtInt(b.participants)} participants, ${fmtHours(b.hours)} total`}
								style={{
									height: `${Math.max((b.participants / max) * 100, b.participants > 0 ? 1.5 : 0)}%`,
									background: b.participants === 0 ? "var(--color-surface-sunken)" : "var(--color-accent)",
									borderRadius: "3px 3px 0 0",
								}}
							/>
						</div>
					))}
				</div>
				<figcaption
					aria-hidden="true"
					style={{
						display: "grid",
						gridTemplateColumns: `repeat(${data.buckets.length}, 1fr)`,
						gap: "4px",
						marginTop: "0.3rem",
					}}
				>
					{data.buckets.map((b) => (
						<span
							key={b.label}
							style={{
								fontSize: "0.65rem",
								color: "var(--color-ink-muted)",
								textAlign: "center",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{b.label}
						</span>
					))}
				</figcaption>
			</figure>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
				Bands widen as hours grow – the distribution is long-tailed, and equal bands would put almost everyone in the
				first one. Hours count journal devlogs (reviewer-adjusted where set) plus linked Hackatime time, the same hours
				the geography panels total. {fmtInt(data.withoutHours)} accounts have no hours at all and are left off the
				chart; hover a bar for the band&apos;s share of the total.
			</p>
		</div>
	)
}

/**
 * One set of named shares as a donut: every slice named in the legend beside it, with its count and its share. Segments are SVG circles rather than a chart dependency – the page's other visuals are hand-rolled the same way – and the figure carries a text summary so the shares do not live in colour alone.
 *
 * Two panels use it: the first-project choice, and the Hack Club Auth identity statuses. It deliberately does not fold a tail into "Other" the way the continent and country pies do – an identity status is a word an operator needs to read, not a sliver to be summarised.
 */
function ShareDonut({
	rows,
	measure,
	empty,
}: {
	rows: { label: string; value: number }[]
	/** What the ring counts, for the figure's accessible name. */
	measure: string
	empty: string
}) {
	const total = rows.reduce((n, r) => n + r.value, 0)
	if (total === 0) return <EmptyState>{empty}</EmptyState>
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
	const shares = rows.map((r) => (r.value / total) * 100)
	const segments = rows.map((r, i) => ({
		label: r.label,
		share: shares[i] ?? 0,
		start: -shares.slice(0, i).reduce((n, p) => n + p, 0),
	}))
	const summary = rows.map((r) => `${r.label} ${Math.round((r.value / total) * 100)}%`).join(", ")
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
				aria-label={`${measure}: ${summary}`}
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
				{rows.map((row, i) => (
					<li
						key={row.label}
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
							{row.label}
						</span>
						<span className="hl-hint">
							{row.value.toLocaleString("en-US")} · {Math.round((row.value / total) * 100)}%
						</span>
					</li>
				))}
			</ul>
		</div>
	)
}
