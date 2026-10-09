import Link from "next/link"
import { ActivityShareChart } from "@/app/components/admin/ActivityShareChart"
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

/** A share of a whole. One decimal, because the small bands are where the comparison is worth making. */
const fmtPct = (share: number) => `${(share * 100).toFixed(1)}%`

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
		sankeyData,
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
					Awaiting review counts live hand-ins – unresolved submissions on phases currently in review. A hand-in
					that never reached Ari still counts here; the program page lists what Ari is actually holding. The other
					three count projects, once however many of their phases were reviewed, shown by the outcome standing now –
					a project approved on design and sent back on build reads as changes requested. Ari&apos;s decisions are
					included. A review an admin or Ari later undid no longer counts.
				</p>
			</Panel>

			<UserFlowDiagram steps={flow} sankey={sankeyData.diagram} />

			<Panel title="Activities after onboarding">
				<ActivityShareChart share={sankeyData.activityShare} />
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
 * Hours and devlogs per day, as two lines over one shared day axis and two scales.
 *
 * One chart rather than two stacked ones because the two move together, and that is the thing worth seeing: a day
 * where the hours line jumps and the devlogs line does not is a long sitting, and a day where both jump is a busy
 * one. Stacked, that comparison needed the eye to travel between panels and hold one scale in mind.
 *
 * Two axes because the magnitudes are unrelated and either could outgrow the other as the season runs. Sharing one
 * scale would pin the smaller series to the baseline and read as a flat line, which is worse than no line at all.
 * Each line is therefore drawn against its own maximum, and each axis is labelled with its series, so neither is
 * read off the other's numbers.
 *
 * Drawn in pixels rather than a scaled viewBox, and that is what keeps the axes outside the scroll area. The scale
 * labels are HTML beside the chart, so they have to line up with the gridlines to the pixel; a viewBox stretched to
 * fit its container has no fixed pixel height to line up against, and stretching it non-uniformly to get one turns
 * the per-day dots into ellipses.
 */
function ActivityStrip({ days }: { days: DayActivity[] }) {
	if (days.length === 0) return <EmptyState>No devlogs yet.</EmptyState>

	const CHART_H = 200
	const PAD_T = 10
	const PAD_B = 8
	const plotH = CHART_H - PAD_T - PAD_B
	// Wide enough that a day is worth a few pixels; the container scrolls past it rather than compressing the
	// season into something where a day is a fraction of one.
	const chartW = Math.max(480, days.length * 3)
	const PAD_L = 6
	const PAD_R = 6
	const plotW = chartW - PAD_L - PAD_R

	const maxHours = Math.max(1, ...days.map((d) => d.hours))
	const maxDevlogs = Math.max(1, ...days.map((d) => d.devlogs))
	const totalHours = days.reduce((n, d) => n + d.hours, 0)
	const totalDevlogs = days.reduce((n, d) => n + d.devlogs, 0)

	const xOf = (i: number) => PAD_L + (days.length === 1 ? plotW / 2 : (i / (days.length - 1)) * plotW)
	const yFor = (v: number, max: number) => PAD_T + plotH - (v / max) * plotH
	const line = (pick: (d: DayActivity) => number, max: number) =>
		days.map((d, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yFor(pick(d), max).toFixed(1)}`).join(" ")
	const hoursPath = line((d) => d.hours, maxHours)
	const devlogsPath = line((d) => d.devlogs, maxDevlogs)
	const areaPath = `${hoursPath} L ${xOf(days.length - 1).toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L ${xOf(0).toFixed(
		1,
	)} ${(PAD_T + plotH).toFixed(1)} Z`

	// Five per axis, so both scales are readable. Rounded to something a person would say rather than to the raw
	// maximum, which on a spiky series lands on an unreadable 574.3h.
	const steps = (max: number) => Array.from({ length: 5 }, (_, i) => (max / 4) * i)
	const hoursTicks = steps(maxHours)
	const devlogTicks = steps(maxDevlogs)
	const roundTick = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10)

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
						height: "0.15rem",
						background: "var(--color-magenta)",
						marginRight: "0.35rem",
						marginLeft: "1rem",
						verticalAlign: "middle",
					}}
				/>
				devlogs ({fmtInt(totalDevlogs)} total)
			</p>
			{/* The two scale columns are grid siblings of the chart, so they share its row and never scroll; only the
			    chart cell overflows. Each label is placed at the exact pixel its gridline sits on, so the two scales
			    read off one row rather than eyeballed. */}
			<div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", alignItems: "start" }}>
				<div style={{ position: "relative", width: "3.1rem", height: `${CHART_H}px` }}>
					{hoursTicks.map((t, i) => (
						<span
							key={`hl${i}`}
							aria-hidden="true"
							style={{
								position: "absolute",
								right: 6,
								top: yFor(t, maxHours),
								transform: "translateY(-50%)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								color: "var(--color-accent-ink)",
							}}
						>
							{fmtHours(roundTick(t)).replace("h", "")}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							position: "absolute",
							right: 6,
							top: -1,
							fontSize: "0.6rem",
							color: "var(--color-ink-muted)",
						}}
					>
						h
					</span>
				</div>

				<div style={{ overflowX: "auto" }}>
					<div style={{ width: `${chartW}px` }}>
						<svg
							width={chartW}
							height={CHART_H}
							viewBox={`0 0 ${chartW} ${CHART_H}`}
							role="img"
							aria-label={`Hours logged per day from ${first} to ${last}, peaking at ${fmtHours(
								maxHours,
							)}, and devlogs written per day over the same period, peaking at ${fmtInt(maxDevlogs)}`}
							style={{ display: "block" }}
						>
							{hoursTicks.map((t, i) => (
								<line
									key={`hg${i}`}
									x1={PAD_L}
									x2={chartW - PAD_R}
									y1={yFor(t, maxHours)}
									y2={yFor(t, maxHours)}
									stroke="var(--color-line-soft)"
									strokeWidth="1"
								/>
							))}
							{devlogTicks.map((t, i) => (
								<line
									key={`dg${i}`}
									x1={PAD_L}
									x2={chartW - PAD_R}
									y1={yFor(t, maxDevlogs)}
									y2={yFor(t, maxDevlogs)}
									stroke="var(--color-line-soft)"
									strokeWidth="1"
									strokeDasharray="2 3"
								/>
							))}
							<path d={areaPath} fill="var(--color-accent)" opacity="0.1" />
							<path d={hoursPath} fill="none" stroke="var(--color-accent)" strokeWidth="1.75" strokeLinejoin="round" />
							<path
								d={devlogsPath}
								fill="none"
								stroke="var(--color-magenta)"
								strokeWidth="1.25"
								strokeLinejoin="round"
								strokeDasharray="4 2"
							/>
							{days.map((d, i) => (
								<circle key={d.day} cx={xOf(i)} cy={yFor(d.hours, maxHours)} r="1.6" fill="var(--color-accent)">
									<title>{`${d.day}: ${fmtHours(d.hours)} logged, ${fmtInt(d.devlogs)} devlogs`}</title>
								</circle>
							))}
						</svg>
						<div
							aria-hidden="true"
							style={{
								display: "grid",
								gridTemplateColumns: `repeat(${days.length}, 1fr)`,
								gap: "1px",
								marginTop: "4px",
								// The plot leaves PAD_L/R for its own edges, so the labels take the same inset and sit under their ticks.
								paddingLeft: PAD_L,
								paddingRight: PAD_R,
								fontSize: "0.65rem",
								color: "var(--color-ink-muted)",
							}}
						>
							{/* Each printed label spans its whole labelEvery block: one label per column squeezes a "MM-DD" into a few pixels on a long season and it ellipsizes to its first character ("1…", "0…"). */}
							{days.map((d, i) =>
								i % labelEvery === 0 ? (
									<div
										key={d.day}
										style={{
											gridColumn: `${i + 1} / span ${Math.min(labelEvery, days.length - i)}`,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap",
										}}
									>
										{d.day.slice(5)}
									</div>
								) : null,
							)}
						</div>
					</div>
				</div>

				<div style={{ position: "relative", width: "3.4rem", height: `${CHART_H}px` }}>
					{devlogTicks.map((t, i) => (
						<span
							key={`dl${i}`}
							aria-hidden="true"
							style={{
								position: "absolute",
								left: 6,
								top: yFor(t, maxDevlogs),
								transform: "translateY(-50%)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								color: "var(--color-magenta)",
							}}
						>
							{fmtInt(roundTick(t))}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							position: "absolute",
							left: 6,
							top: -1,
							fontSize: "0.6rem",
							color: "var(--color-ink-muted)",
						}}
					>
						devlogs
					</span>
				</div>
			</div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
				Dashed is devlogs against the right axis, solid is hours against the left; each is scaled to its own maximum, so
				compare the shapes and not the heights. Days are program-timezone effective dates – the day the work counted
				for. Hours count journal devlogs only.
			</p>
		</div>
	)
}

/**
 * How the cohort's hours are spread, as two measures over each band of hours.
 *
 * The solid bar is the band's share of the accounts, the pale one its share of the hours. Both are drawn against
 * one scale – the largest share either series has – so the pair can be compared directly: where the pale bar tops
 * the solid one, that band holds more of the programme's hours than of its people, and the other way round where it
 * does not. Scaling each series to its own maximum would look tidier and mean nothing, because a band would look
 * hours-heavy purely because hours happen to be spread more evenly than people.
 *
 * The shares, not the counts, are the thing drawn: buckets are unequal by design, so a count bar would say as much
 * about the bucket's width as about the band. The counts are still what is written above each column, because that
 * is the number an operator actually reads off this chart.
 */
function HoursHistogram({ data }: { data: HoursDistribution }) {
	if (data.withHours === 0) return <EmptyState>No hours logged yet.</EmptyState>

	// Guarded because both shares divide by them: a cohort or a total that somehow came to zero would otherwise put
	// NaN% in every tooltip and a NaN height on every bar, which is worse than a slightly wrong number.
	const accounts = Math.max(data.withHours, 1)
	const totalHours = Math.max(data.totalHours, 0.0001)

	const shares = data.buckets.map((b) => ({ byAccounts: b.participants / accounts, byHours: b.hours / totalHours }))
	// One scale across both series, so the taller of the two is always the full height and the comparison holds.
	const scale = Math.max(0.0001, ...shares.flatMap((s) => [s.byAccounts, s.byHours]))

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
			<p className="hl-hint" style={{ fontSize: "0.75rem", margin: "0 0 0.5rem" }}>
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
				share of accounts
				<span
					aria-hidden="true"
					style={{
						display: "inline-block",
						width: "0.7rem",
						height: "0.7rem",
						borderRadius: "2px",
						// Same colour and opacity as the bar itself, so the key and the mark cannot drift apart.
						background: "var(--color-magenta)",
						opacity: 0.3,
						marginRight: "0.35rem",
						marginLeft: "1rem",
						verticalAlign: "baseline",
					}}
				/>
				share of hours
			</p>
			<figure style={{ margin: 0 }}>
				{/* The plot carries its own height and its columns stretch to fill it. Both are load-bearing: a
				    percentage bar has nothing to resolve against inside an auto-height parent, and `align-items: end`
				    would stop the column growing into one – which is how this chart rendered no bars at all. */}
				<div
					role="img"
					aria-label={`Participants and hours by hours logged: ${summary}`}
					style={{
						display: "grid",
						gridTemplateColumns: `repeat(${data.buckets.length}, 1fr)`,
						columnGap: "3px",
						height: "11rem",
					}}
				>
					{data.buckets.map((b, i) => {
						const share = shares[i] ?? { byAccounts: 0, byHours: 0 }
						return (
							// The tooltip hangs on the whole column rather than on a bar. Both bars are absolutely
							// positioned and the hours one is painted last, so a title on the solid bar would be covered
							// by the translucent one wherever the hours bar is the taller – exactly the half of the chart
							// the tooltip is most worth reading. The column is the common ancestor, so hovering anywhere
							// in it, bars included, reaches the one tooltip.
							<div
								key={b.label}
								title={`${b.label}h: ${fmtInt(b.participants)} participants · ${fmtPct(
									share.byAccounts,
								)} of accounts with hours · ${fmtHours(b.hours)}, ${fmtPct(share.byHours)} of all hours`}
								style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
							>
								<span
									aria-hidden="true"
									style={{
										fontSize: "0.7rem",
										fontVariantNumeric: "tabular-nums",
										textAlign: "center",
										color: "var(--color-ink-muted)",
										lineHeight: 1,
										paddingBottom: "0.55rem",
									}}
								>
									{b.participants > 0 ? fmtInt(b.participants) : ""}
								</span>
								{/* flex: 1 so the bars take the space the count label does not. Both bars are pinned to
								    the floor and drawn full-width so they overlap; the hours bar sits on top, translucent,
								    so a band that is hours-heavy reads as a pale cap over the solid bar and one that is
								    people-heavy reads as a solid cap over the pale. */}
								<div style={{ flex: 1, position: "relative", minHeight: 0 }}>
									<div
										style={{
											position: "absolute",
											left: 0,
											right: 0,
											bottom: 0,
											height: `${(share.byAccounts / scale) * 100}%`,
											background: b.participants === 0 ? "var(--color-surface-sunken)" : "var(--color-accent)",
											borderRadius: "3px 3px 0 0",
										}}
									/>
									<div
										aria-hidden="true"
										style={{
											position: "absolute",
											left: 0,
											right: 0,
											bottom: 0,
											height: `${(share.byHours / scale) * 100}%`,
											background: "var(--color-magenta)",
											opacity: 0.3,
											borderRadius: "3px 3px 0 0",
										}}
									/>
								</div>
							</div>
						)
					})}
				</div>
				<figcaption
					aria-hidden="true"
					style={{
						display: "grid",
						gridTemplateColumns: `repeat(${data.buckets.length}, 1fr)`,
						columnGap: "3px",
						marginTop: "0.3rem",
					}}
				>
					{data.buckets.map((b) => (
						<span
							key={b.label}
							title={b.label}
							style={{
								fontSize: "0.6rem",
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
				Both series share one scale, so a pale bar taller than the solid one means the band holds more of the
				programme&apos;s hours than of its people. Hours count journal devlogs (reviewer-adjusted where set) plus linked
				Hackatime time, the same hours the geography panels total. {fmtInt(data.withoutHours)} accounts have no hours at
				all and are left off the chart; hover a bar for both shares.
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
