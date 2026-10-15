import Link from "next/link"
import { ActivityShareChart } from "@/app/components/admin/ActivityShareChart"
import { UserFlowDiagram } from "@/app/components/admin/UserFlowDiagram"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { type ParticipantGoal, Phase, type ReviewResult } from "@/app/generated/prisma/enums"
import { GOAL_OPTIONS } from "@/lib/config/goal"
import { fmtInt } from "@/lib/numbers"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import {
	type ActiveDay,
	type DayActivity,
	type GoalDayActivity,
	getAdminCounters,
	getAreaStats,
	getCountryStats,
	getDailyActiveUsers,
	getDailyActivity,
	getDailyActivityByGoal,
	getFirstProjectStats,
	getHoursByWeek,
	getHoursDistribution,
	getProjectReviewStatuses,
	getProjectsByWeek,
	getReviewerStats,
	getUserFlowFunnel,
	getUserFlowSankey,
	getVerificationStats,
	type HoursDistribution,
	type WeekHoursCluster,
	type WeekProjectCluster,
} from "@/lib/queries/admin"
import { getLatestSyncRuns } from "@/lib/sync-run-log"

export const dynamic = "force-dynamic"

const fmtHours = (h: number) => `${h.toLocaleString("en-US", { maximumFractionDigits: 1 })}h`

/** A share of a whole. One decimal, because the small bands are where the comparison is worth making. */
const fmtPct = (share: number) => `${(share * 100).toFixed(1)}%`

/** Outcome wording, the same one a maker is told in lib/notifications. */
const RESULT_LABEL: Record<ReviewResult, string> = {
	APPROVED: "Approved",
	REJECTED: "Rejected",
	RETURNED: "Changes requested",
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
		activeUsers,
		activityByGoal,
		projectsByWeek,
		hoursByWeek,
		hoursSpread,
		firstProjects,
		projectReviewStatuses,
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
			"project_review_summary",
		]),
		getUserFlowFunnel(),
		getUserFlowSankey(),
		getAreaStats(),
		getCountryStats(),
		getDailyActivity(),
		getDailyActiveUsers(),
		getDailyActivityByGoal(),
		getProjectsByWeek(),
		getHoursByWeek(),
		getHoursDistribution(),
		getFirstProjectStats(),
		getProjectReviewStatuses(),
		getVerificationStats(),
		getReviewerStats(),
	])

	return (
		<div className="hl-stack">
			<PageHeader title="Overview" />

			<div className="hl-row">
				<Stat label="Orders to fulfil" value={counters.pendingOrders} />
				<Stat label="Participants" value={counters.participants} />
				<Stat label="Active today" value={activeUsers.today} />
				<Stat label="Printers earned" value={counters.shipped} />
			</div>

			<Panel
				actions={
					<span className="hl-hint" style={{ fontSize: "0.78rem" }}>
						the headline counts hand-ins, the outcome rows count projects
					</span>
				}
				title="Reviewer activity"
			>
				<div
					style={{
						alignItems: "center",
						display: "flex",
						flexWrap: "wrap",
						gap: "1.5rem",
						justifyContent: "space-between",
					}}
				>
					<ShareDonut
						colors={["var(--color-teal)", "var(--color-coin)", "var(--color-flame)", "var(--color-accent)"]}
						empty="No projects with a review state yet."
						measure="Project review status"
						rows={projectReviewStatuses.map(s => ({ label: s.label, value: s.value }))}
					/>
					<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
						<Stat label="Reviewed today" value={reviewer.reviewedToday} />
						<Stat label="Projects reviewed" value={reviewer.reviewedTotal} />
					</div>
				</div>
				{counters.pendingReviewsUnsent > 0 && (
					<p className="hl-hint" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
						<span className="hl-mono">{fmtInt(counters.pendingReviewsUnsent)}</span> more are handed in and in review
						here but never reached Ari, so no reviewer has them –{" "}
						<Link href="/admin/program">what broke, and a Retry for each</Link>.
					</p>
				)}
				<Table head={["Outcome", "Today", "All time"]}>
					{reviewer.byResult.map(row => (
						<tr key={row.result}>
							<td>{RESULT_LABEL[row.result]}</td>
							<td className="hl-mono">{fmtInt(row.today)}</td>
							<td className="hl-mono">{fmtInt(row.total)}</td>
						</tr>
					))}
				</Table>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					The ring counts ships the way Ari does – one slice per (project, phase) hand-in, by the decision standing on
					it now. A design approved long ago still reads as approved even once its build is handed in, and a sent-back
					design only leaves changes requested when it is resubmitted. Pending is unresolved hand-ins Ari holds;
					anything Ari never received is counted apart above, because a hand-in Ari has never seen is not on its board.
					Console decisions are included. A review an admin later undid still reads by the submission it decided, since
					the hand-in itself stays resolved.
				</p>
			</Panel>

			<UserFlowDiagram sankey={sankeyData.diagram} steps={flow} />

			<Panel title="Activities after onboarding">
				<ActivityShareChart share={sankeyData.activityShare} />
			</Panel>

			<Panel title="Users & hours by continent">
				<div
					style={{
						alignItems: "start",
						display: "grid",
						gap: "1.5rem",
						gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
					}}
				>
					<MetricPie format={fmtInt} pick={r => r.users} rows={areas} title="Users" />
					<MetricPie format={fmtHours} pick={r => r.hours} rows={areas} title="Hours" />
				</div>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Continents group each account&apos;s timezone; Unknown has none on file. Hours count journal devlogs
					(reviewer-adjusted where set) plus linked Hackatime time, attributed to the author&apos;s region.
				</p>
			</Panel>

			<Panel title="Users & hours by country">
				<div
					style={{
						alignItems: "start",
						display: "grid",
						gap: "1.5rem",
						gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))",
					}}
				>
					<MetricPie
						format={fmtInt}
						pick={r => r.users}
						rows={countries.map(c => ({ hours: c.hours, label: c.country, users: c.users }))}
						title="Users"
					/>
					<MetricPie
						format={fmtHours}
						pick={r => r.hours}
						rows={countries.map(c => ({ hours: c.hours, label: c.country, users: c.users }))}
						title="Hours"
					/>
				</div>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Countries map each account&apos;s timezone; zones with nothing to place read as Unknown.
				</p>
			</Panel>

			<Panel title="First project choice">
				<ShareDonut
					empty="No finished setups yet."
					measure="First project choice"
					rows={firstProjects.map(s => ({ label: s.label, value: s.users }))}
				/>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Users who finished setup and still have their week-one project. Starter names come from the catalogue; Custom
					project means they named their own idea.
				</p>
			</Panel>

			<Panel title="Identity verification">
				<ShareDonut
					empty="No accounts yet."
					measure="Identity status"
					rows={verification.map(s => ({ label: s.label, value: s.users }))}
				/>
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Hack Club Auth&apos;s own reading of each account, taken at its last sign-in or purchase. Only a verified
					identity can be paid; needs verification is somebody part-way through IDV, and not asked is an account no
					sign-in has reported on yet.
				</p>
			</Panel>

			<Panel title="Hours per participant">
				<HoursHistogram data={hoursSpread} />
			</Panel>

			<Panel title="Daily active users">
				<DauChart days={activeUsers.days} />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					A person counts once a day, and only once that day&apos;s tracked time reaches 15 minutes – a visit with no
					time logged does not count, and neither do three devlogs where one would have done. Days are program-timezone
					effective dates, the day the work counted for.
				</p>
			</Panel>

			<Panel title="Activity over time">
				<ActivityStrip days={activity} />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					Days are program-timezone effective dates – the day the work counted for. Hours count journal devlogs only.
				</p>
			</Panel>

			<Panel title="Activity per user over time">
				<ActivityStrip days={activity} perUser />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					One person&apos;s average working day rather than the programme&apos;s total. Read beside the chart above, the
					totals say how much was done and this says how thinly it was spread – so a busy day and a flat average
					together mean the work was going somewhere, and both rising means more people joined in.
				</p>
			</Panel>

			<Panel title="Hours per user by goal">
				<GoalHoursChart days={activityByGoal} />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					The same hours split by what each maker said they are here for. Where the three lines separate, the goal
					question is saying something about effort; where they move together, it is saying something about the
					programme.
				</p>
			</Panel>

			<Panel title="Projects per week">
				<ProjectsByWeekChart weeks={projectsByWeek} />
				<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
					What people are building, by the week it is for. A project sits in its theme&apos;s design week once the
					design has been handed in, and in the build week once the build has – so the two PCBs blocks are different
					projects, not one cohort counted twice.
				</p>
			</Panel>
			<Panel title="Hours per week">
				<HoursByWeekChart weeks={hoursByWeek} />
			</Panel>

			<Panel
				actions={<Link href="/admin/audit?action=AIRTABLE_SYNC_FAILURE">Sync failures</Link>}
				title="Scheduled jobs"
			>
				{syncs.length === 0 ? (
					<EmptyState>No job has completed yet. Run them by hand from Orchard to check the wiring.</EmptyState>
				) : (
					<Table head={["Job", "Last success", "Result"]}>
						{syncs.map(run => (
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
		.map(r => ({ label: r.label, value: pick(r) }))
		.filter(s => s.value > 0)
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
	const wedges = colored.map(s => {
		const sweep = (s.value / total) * 360
		const w = { ...s, from: angle, sweep }
		angle += sweep
		return w
	})

	const summary = colored
		.slice(0, 3)
		.map(s => `${s.label} ${s.pct.toFixed(1)}%`)
		.join(", ")

	return (
		<figure style={{ margin: 0 }}>
			<figcaption style={{ fontWeight: 800, marginBottom: "0.5rem", textAlign: "center" }}>
				{title} · {format(total)}
			</figcaption>
			<div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "1rem" }}>
				<svg
					aria-label={`${title} by share: ${summary}${colored.length > 3 ? ", and more" : ""}`}
					role="img"
					style={{ flexShrink: 0, height: "11rem", width: "11rem" }}
					viewBox="0 0 200 200"
				>
					{only ? (
						<>
							<circle cx={CX} cy={CY} r={R} style={{ fill: only.color }} />
							<circle cx={CX} cy={CY} fill="#fff" r={HOLE} />
						</>
					) : (
						wedges.map(w => {
							const to = w.from + w.sweep
							const outerFrom = point(R, w.from)
							const outerTo = point(R, to)
							const innerTo = point(HOLE, to)
							const innerFrom = point(HOLE, w.from)
							const large = w.sweep > 180 ? 1 : 0
							return (
								<path
									d={`M ${outerFrom.x} ${outerFrom.y} A ${R} ${R} 0 ${large} 1 ${outerTo.x} ${outerTo.y} L ${innerTo.x} ${innerTo.y} A ${HOLE} ${HOLE} 0 ${large} 0 ${innerFrom.x} ${innerFrom.y} Z`}
									key={w.label}
									style={{ fill: w.color, stroke: "#fff", strokeWidth: 2 }}
								>
									<title>{`${w.label}: ${format(w.value)} (${w.pct.toFixed(1)}%)`}</title>
								</path>
							)
						})
					)}
					<text
						style={{ fill: "var(--color-ink-strong)", fontSize: "1.35rem", fontWeight: 800 }}
						textAnchor="middle"
						x={CX}
						y={CY - 2}
					>
						{format(total)}
					</text>
					<text style={{ fill: "var(--color-ink-muted)", fontSize: "0.8rem" }} textAnchor="middle" x={CX} y={CY + 20}>
						total {title.toLowerCase()}
					</text>
				</svg>
				<table
					style={{
						borderCollapse: "collapse",
						flex: "1 1 10rem",
						fontSize: "0.82rem",
						fontVariantNumeric: "tabular-nums",
						minWidth: "10rem",
					}}
				>
					<tbody>
						{colored.map(s => (
							<tr key={s.label}>
								<td style={{ padding: "0.15rem 0.75rem 0.15rem 0" }}>
									<span style={{ alignItems: "center", display: "inline-flex", gap: "0.45rem" }}>
										<span
											aria-hidden="true"
											style={{
												background: s.color,
												borderRadius: "3px",
												display: "inline-block",
												flexShrink: 0,
												height: "0.7rem",
												width: "0.7rem",
											}}
										/>
										<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
											{s.label}
										</span>
									</span>
								</td>
								<td style={{ padding: "0.15rem 0.75rem 0.15rem 0", textAlign: "right", whiteSpace: "nowrap" }}>
									{format(s.value)}
								</td>
								<td style={{ padding: "0.15rem 0", textAlign: "right", whiteSpace: "nowrap" }}>{s.pct.toFixed(1)}%</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</figure>
	)
}

/**
 * The grid every activity chart draws on, shared so a change to one is a change to all.
 *
 * The top inset is a caption band: a tick at the maximum lands exactly on the plot's top edge, and the axis caption
 * sits above it, so without the band "38" prints over "h". The height carries that band rather than the plot losing
 * it, so the data area and the gridline spacing are the size they were.
 */
const CHART_H = 214
const PAD_T = 24
const PAD_B = 8

/**
 * The x axis is a share of the chart's own width and the y axis is in pixels, which is what lets a chart fill whatever
 * panel it lands in without being measured. A percentage resolves against the SVG's viewport, so there is no viewBox
 * and no scale factor for the HTML scale labels to fall out of step with, and the dots stay round because nothing is
 * being stretched.
 *
 * The cost of that choice is that x can never ride in a `d` attribute – path data takes user units only – so the lines
 * are drawn one segment per pair of points. It replaced a fixed pixel width per chart, which left most of a wide panel
 * empty; `EDGE` is what keeps the first and last marks off the sides.
 */
const EDGE = 0.012
const pct = (fraction: number) => `${(fraction * 100).toFixed(3)}%`

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
 * `perUser` divides each day by the people who logged something that day rather than plotting the totals. It is the
 * same chart otherwise, deliberately: the shapes are meant to be laid side by side, and a second component that drew
 * a slightly different grid would defeat that. It answers a different question – not how much the programme did, but
 * how much one person's working day held – so the two are read together, the totals for volume and these for whether
 * that volume is spread thin. A day with a single contributor reads tall here, because that is what an average over
 * one person is, and nothing in the data can say otherwise.
 */
function ActivityStrip({ days, perUser = false }: { days: DayActivity[]; perUser?: boolean }) {
	if (days.length === 0) return <EmptyState>No devlogs yet.</EmptyState>

	// A gap-filled day with no contributors has no average to take and no activity to take it from, so it reads as
	// zero. Left as `value / users` it would divide by zero into NaN and put a hole in the path.
	const perActiveUser = (value: number, users: number) => (users > 0 ? value / users : 0)
	const hoursOf = (d: DayActivity) => (perUser ? perActiveUser(d.hours, d.users) : d.hours)
	const devlogsOf = (d: DayActivity) => (perUser ? perActiveUser(d.devlogs, d.users) : d.devlogs)

	const plotH = CHART_H - PAD_T - PAD_B

	const maxHours = Math.max(1, ...days.map(hoursOf))
	const maxDevlogs = Math.max(1, ...days.map(devlogsOf))
	// The span's own figure, for the legend. On the per-user chart this is the mean of what is drawn rather than a
	// total, so it is divided by the days on the axis – including the quiet ones, since those are plotted too.
	const sumHours = days.reduce((n, d) => n + hoursOf(d), 0)
	const sumDevlogs = days.reduce((n, d) => n + devlogsOf(d), 0)
	const meanHours = sumHours / days.length
	const meanDevlogs = sumDevlogs / days.length

	// The count axis keeps a decimal per user, where a total would round a fraction of a devlog to nothing.
	const fmtCount = (v: number) => (perUser ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : fmtInt(v))
	const legendHours = perUser
		? `hours per user (averaging ${fmtHours(meanHours)})`
		: `hours (${fmtHours(sumHours)} total)`
	const legendDevlogs = perUser
		? `devlogs per user (averaging ${fmtCount(meanDevlogs)})`
		: `devlogs (${fmtInt(sumDevlogs)} total)`

	const xOf = (i: number) => (days.length === 1 ? 0.5 : EDGE + (i / (days.length - 1)) * (1 - 2 * EDGE))
	const yFor = (v: number, max: number) => PAD_T + plotH - (v / max) * plotH
	const points = (pick: (d: DayActivity) => number, max: number) =>
		days.map((d, i) => ({ x: xOf(i), y: yFor(pick(d), max) }))
	/** One segment per pair of points, because a `d` attribute cannot carry the percentage x. */
	const segments = (at: { x: number; y: number }[]) =>
		at.slice(1).map((point, i) => {
			const previous = at[i] ?? point
			return { x1: previous.x, x2: point.x, y1: previous.y, y2: point.y }
		})
	const hoursSegments = segments(points(hoursOf, maxHours))
	const devlogsSegments = segments(points(devlogsOf, maxDevlogs))
	/** The fill under the hours line, as a column per day rather than a closed path, for the same reason. */
	const areaBars = days.map((d, i) => ({
		width: (i === days.length - 1 ? 1 - EDGE : xOf(i + 1)) - xOf(i),
		x: xOf(i),
		y: yFor(hoursOf(d), maxHours),
	}))

	// Five per axis, so both scales are readable. Rounded to something a person would say rather than to the raw
	// maximum, which on a spiky series lands on an unreadable 574.3h.
	const steps = (max: number) => Array.from({ length: 5 }, (_, i) => (max / 4) * i)
	const hoursTicks = steps(maxHours)
	const devlogTicks = steps(maxDevlogs)
	const roundTick = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10)

	const labelEvery = Math.max(1, Math.ceil(days.length / 14))
	const first = days[0]?.day
	const last = days[days.length - 1]?.day
	const what = perUser ? "per active user " : ""
	const note = perUser
		? " Each line is divided by the people who logged something that day, so a quiet day with one contributor reads tall."
		: ""

	return (
		<div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
				<span
					aria-hidden="true"
					style={{
						background: "var(--color-accent)",
						display: "inline-block",
						height: "0.15rem",
						marginRight: "0.35rem",
						verticalAlign: "middle",
						width: "0.7rem",
					}}
				/>
				{legendHours}
				<span
					aria-hidden="true"
					style={{
						background: "var(--color-magenta)",
						display: "inline-block",
						height: "0.15rem",
						marginLeft: "1rem",
						marginRight: "0.35rem",
						verticalAlign: "middle",
						width: "0.7rem",
					}}
				/>
				{legendDevlogs}
			</p>
			{/* The two scale columns are grid siblings of the chart, so they share its row. Each label is placed at the
			    exact pixel its gridline sits on, so the two scales read off one row rather than eyeballed. */}
			<div style={{ alignItems: "start", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto" }}>
				<div style={{ height: `${CHART_H}px`, position: "relative", width: "3.1rem" }}>
					{hoursTicks.map((t, i) => (
						<span
							aria-hidden="true"
							key={`hl${i}`}
							style={{
								color: "var(--color-accent-ink)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								position: "absolute",
								right: 6,
								top: yFor(t, maxHours),
								transform: "translateY(-50%)",
							}}
						>
							{fmtHours(roundTick(t)).replace("h", "")}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							fontSize: "0.6rem",
							// Pinned so the caption's box is its own height rather than an inherited line-height's: the
							// band below it is what keeps it clear of the top tick label, and that budget has to be knowable.
							lineHeight: 1,
							position: "absolute",
							right: 6,
							top: -1,
						}}
					>
						h
					</span>
				</div>

				<div>
					<svg
						aria-label={`Hours logged ${what}per day from ${first} to ${last}, peaking at ${fmtHours(
							maxHours,
						)}, and devlogs written ${what}per day over the same period, peaking at ${fmtCount(maxDevlogs)}`}
						height={CHART_H}
						role="img"
						style={{ display: "block" }}
						width="100%"
					>
						{hoursTicks.map((t, i) => (
							<line
								key={`hg${i}`}
								stroke="var(--color-line-soft)"
								strokeWidth="1"
								x1={pct(EDGE)}
								x2={pct(1 - EDGE)}
								y1={yFor(t, maxHours)}
								y2={yFor(t, maxHours)}
							/>
						))}
						{devlogTicks.map((t, i) => (
							<line
								key={`dg${i}`}
								stroke="var(--color-line-soft)"
								strokeDasharray="2 3"
								strokeWidth="1"
								x1={pct(EDGE)}
								x2={pct(1 - EDGE)}
								y1={yFor(t, maxDevlogs)}
								y2={yFor(t, maxDevlogs)}
							/>
						))}
						{areaBars.map((bar, i) => (
							<rect
								fill="var(--color-accent)"
								height={PAD_T + plotH - bar.y}
								key={`a${i}`}
								opacity="0.1"
								width={pct(bar.width)}
								x={pct(bar.x)}
								y={bar.y}
							/>
						))}
						{hoursSegments.map((segment, i) => (
							<line
								key={`h${i}`}
								stroke="var(--color-accent)"
								strokeLinecap="round"
								strokeWidth="1.75"
								x1={pct(segment.x1)}
								x2={pct(segment.x2)}
								y1={segment.y1}
								y2={segment.y2}
							/>
						))}
						{devlogsSegments.map((segment, i) => (
							<line
								key={`d${i}`}
								stroke="var(--color-magenta)"
								strokeDasharray="4 2"
								strokeLinecap="round"
								strokeWidth="1.25"
								x1={pct(segment.x1)}
								x2={pct(segment.x2)}
								y1={segment.y1}
								y2={segment.y2}
							/>
						))}
						{days.map((d, i) => (
							<circle cx={pct(xOf(i))} cy={yFor(hoursOf(d), maxHours)} fill="var(--color-accent)" key={d.day} r="1.6">
								<title>
									{perUser
										? `${d.day}: ${fmtHours(hoursOf(d))} and ${fmtCount(devlogsOf(d))} devlogs per user, across ${fmtInt(d.users)} ${d.users === 1 ? "person" : "people"}`
										: `${d.day}: ${fmtHours(d.hours)} logged, ${fmtInt(d.devlogs)} devlogs`}
								</title>
							</circle>
						))}
					</svg>
					<div
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							display: "grid",
							fontSize: "0.65rem",
							gap: "1px",
							gridTemplateColumns: `repeat(${days.length}, 1fr)`,
							marginTop: "4px",
							// The plot leaves EDGE either side, so the labels take the same inset and sit under their ticks.
							paddingLeft: pct(EDGE),
							paddingRight: pct(EDGE),
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

				<div style={{ height: `${CHART_H}px`, position: "relative", width: "3.4rem" }}>
					{devlogTicks.map((t, i) => (
						<span
							aria-hidden="true"
							key={`dl${i}`}
							style={{
								color: "var(--color-magenta)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								left: 6,
								position: "absolute",
								top: yFor(t, maxDevlogs),
								transform: "translateY(-50%)",
							}}
						>
							{fmtCount(roundTick(t))}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							fontSize: "0.6rem",
							left: 6,
							// The same pinned box as the hours caption: one band, two captions, both meant to clear the tick.
							lineHeight: 1,
							position: "absolute",
							top: -1,
						}}
					>
						devlogs
					</span>
				</div>
			</div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
				Dashed is devlogs against the right axis, solid is hours against the left; each is scaled to its own maximum, so
				compare the shapes and not the heights. Days are program-timezone effective dates – the day the work counted
				for. Hours count journal devlogs only.{note}
			</p>
		</div>
	)
}

/**
 * People active per day, as one line.
 *
 * Active is "tracked at least 15 minutes that day", the bar `UserDay` is built on (lib/analytics), so this draws the DAU the analytics export reports rather than counting it a second way. It is people, not entries: someone with three devlogs and someone with one count the same, which is why this line sits so much lower than the hours drawn below it.
 *
 * One line on one axis, so there is no second scale and no dashed series – the whole reading is where the line sits and how many are under it.
 */
function DauChart({ days }: { days: ActiveDay[] }) {
	if (days.length === 0) return <EmptyState>Nobody has tracked 15 minutes in a day yet.</EmptyState>

	const plotH = CHART_H - PAD_T - PAD_B

	const values = days.map(d => d.users)
	// At least 1, so a stretch with nobody active draws along the baseline rather than dividing by zero.
	const max = Math.max(1, ...values)
	const peak = Math.max(...values)
	const mean = values.reduce((n, v) => n + v, 0) / days.length

	const xOf = (i: number) => (days.length === 1 ? 0.5 : EDGE + (i / (days.length - 1)) * (1 - 2 * EDGE))
	const yFor = (v: number) => PAD_T + plotH - (v / max) * plotH
	const at = days.map((d, i) => ({ x: xOf(i), y: yFor(d.users) }))
	/** One segment per pair of points, because a `d` attribute cannot carry the percentage x. */
	const segments = at.slice(1).map((point, i) => {
		const previous = at[i] ?? point
		return { x1: previous.x, x2: point.x, y1: previous.y, y2: point.y }
	})
	/** The fill under the line, as a column per day rather than a closed path, for the same reason. */
	const areaBars = days.map((d, i) => ({
		width: (i === days.length - 1 ? 1 - EDGE : xOf(i + 1)) - xOf(i),
		x: xOf(i),
		y: yFor(d.users),
	}))

	// Five ticks rounded to whole people: a head count has no meaningful fraction, so the axis is in the integers the line is.
	const ticks = Array.from({ length: 5 }, (_, i) => Math.round((max / 4) * i))
	const labelEvery = Math.max(1, Math.ceil(days.length / 14))
	const first = days[0]?.day
	const last = days[days.length - 1]?.day

	return (
		<div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
				<span
					aria-hidden="true"
					style={{
						background: "var(--color-teal)",
						display: "inline-block",
						height: "0.15rem",
						marginRight: "0.35rem",
						verticalAlign: "middle",
						width: "0.7rem",
					}}
				/>
				active users (15+ minutes tracked) – averaging {fmtInt(Math.round(mean))} a day, peaking at {fmtInt(peak)}
			</p>
			{/* One scale column, pinned to the chart's own row so each label sits on the gridline it names. */}
			<div style={{ alignItems: "start", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)" }}>
				<div style={{ height: `${CHART_H}px`, position: "relative", width: "2.6rem" }}>
					{ticks.map((t, i) => (
						<span
							aria-hidden="true"
							key={`t${i}`}
							style={{
								color: "var(--color-teal-ink)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								position: "absolute",
								right: 6,
								top: yFor(t),
								transform: "translateY(-50%)",
							}}
						>
							{fmtInt(t)}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							fontSize: "0.6rem",
							lineHeight: 1,
							position: "absolute",
							right: 6,
							top: -1,
						}}
					>
						users
					</span>
				</div>

				<div>
					<svg
						aria-label={`Daily active users from ${first} to ${last}: averaging ${fmtInt(Math.round(mean))} a day and peaking at ${fmtInt(peak)}`}
						height={CHART_H}
						role="img"
						style={{ display: "block" }}
						width="100%"
					>
						{ticks.map((t, i) => (
							<line
								key={`g${i}`}
								stroke="var(--color-line-soft)"
								strokeWidth="1"
								x1={pct(EDGE)}
								x2={pct(1 - EDGE)}
								y1={yFor(t)}
								y2={yFor(t)}
							/>
						))}
						{areaBars.map((bar, i) => (
							<rect
								fill="var(--color-teal)"
								height={PAD_T + plotH - bar.y}
								key={`a${i}`}
								opacity="0.1"
								width={pct(bar.width)}
								x={pct(bar.x)}
								y={bar.y}
							/>
						))}
						{segments.map((segment, i) => (
							<line
								key={`l${i}`}
								stroke="var(--color-teal)"
								strokeLinecap="round"
								strokeWidth="1.75"
								x1={pct(segment.x1)}
								x2={pct(segment.x2)}
								y1={segment.y1}
								y2={segment.y2}
							/>
						))}
						{days.map((d, i) => (
							<circle cx={pct(xOf(i))} cy={yFor(d.users)} fill="var(--color-teal)" key={d.day} r="1.6">
								<title>{`${d.day}: ${fmtInt(d.users)} active ${d.users === 1 ? "person" : "people"}`}</title>
							</circle>
						))}
					</svg>
					<div
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							display: "grid",
							fontSize: "0.65rem",
							gap: "1px",
							gridTemplateColumns: `repeat(${days.length}, 1fr)`,
							marginTop: "4px",
							// The plot leaves EDGE either side, so the labels take the same inset and sit under their dots.
							paddingLeft: pct(EDGE),
							paddingRight: pct(EDGE),
						}}
					>
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
		</div>
	)
}

/** One line per answer to the goal prompt, in `GOAL_OPTIONS` order. */
const GOAL_LINE_COLOUR: Record<ParticipantGoal, string> = {
	FULL_FUNDING: "var(--color-teal)",
	PARTIAL_FUNDING: "var(--color-coin)",
	PRINTER: "var(--color-accent)",
}

/**
 * Journal hours per active user per day, one line per answer to the goal prompt.
 *
 * One axis, unlike `ActivityStrip`: all three lines are the same measure, so they are directly comparable and a shared scale is the whole point. Scaling each to its own maximum would make three groups doing very different amounts look like three groups doing the same, which is the one thing this chart exists to tell apart.
 *
 * The gaps are the other half of the reading. A goal whose line stops is a goal nobody is still working towards, and the totals chart above cannot show that at all, because it adds everyone together.
 *
 * The denominator is the people working towards that goal who logged something that day – the same convention the per-user chart uses, so it is the two read together that answer "who is still here, and are they doing more or less". The head count is on the tooltip, which is where it matters.
 */
function GoalHoursChart({ days }: { days: GoalDayActivity[] }) {
	if (days.length === 0) return <EmptyState>No hours logged since anyone answered the goal prompt.</EmptyState>

	const plotH = CHART_H - PAD_T - PAD_B

	// A goal nobody worked towards that day has no average to take, so it reads as zero rather than dividing by nobody.
	const perUser = (hours: number, users: number) => (users > 0 ? hours / users : 0)
	const lines = GOAL_OPTIONS.map(option => {
		const values = days.map(d => {
			const goal = d.byGoal.find(g => g.goal === option.value)
			return goal ? perUser(goal.hours, goal.users) : 0
		})
		return {
			colour: GOAL_LINE_COLOUR[option.value],
			label: option.short,
			mean: values.reduce((n, v) => n + v, 0) / days.length,
			values,
		}
	})

	// One maximum across all three: the comparison between the lines is the chart.
	const maxHours = Math.max(1, ...lines.flatMap(l => l.values))

	const xOf = (i: number) => (days.length === 1 ? 0.5 : EDGE + (i / (days.length - 1)) * (1 - 2 * EDGE))
	const yFor = (v: number) => PAD_T + plotH - (v / maxHours) * plotH
	/** One segment per pair of points: a `d` attribute cannot carry the percentage x. */
	const segments = (values: number[]) =>
		values.slice(1).map((value, i) => {
			const previous = values[i] ?? value
			return { x1: xOf(i), x2: xOf(i + 1), y1: yFor(previous), y2: yFor(value) }
		})

	const ticks = Array.from({ length: 5 }, (_, i) => (maxHours / 4) * i)
	const roundTick = (n: number) => (n >= 10 ? Math.round(n) : Math.round(n * 10) / 10)
	const labelEvery = Math.max(1, Math.ceil(days.length / 14))
	const first = days[0]?.day
	const last = days[days.length - 1]?.day
	// One title per day on every line's dot, so hovering any of the three gives the whole day rather than a third of it.
	const title = (d: GoalDayActivity) =>
		`${d.day}: ${d.byGoal
			.map(g => `${GOAL_OPTIONS.find(o => o.value === g.goal)?.short ?? g.goal} ${fmtHours(perUser(g.hours, g.users))}`)
			.join(", ")} per person`

	return (
		<div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
				{lines.map((line, i) => (
					<span key={line.label} style={{ marginLeft: i === 0 ? 0 : "1rem" }}>
						<span
							aria-hidden="true"
							style={{
								background: line.colour,
								display: "inline-block",
								height: "0.15rem",
								marginRight: "0.35rem",
								verticalAlign: "middle",
								width: "0.7rem",
							}}
						/>
						{line.label} (averaging {fmtHours(line.mean)})
					</span>
				))}
			</p>
			<div style={{ alignItems: "start", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)" }}>
				<div style={{ height: `${CHART_H}px`, position: "relative", width: "3.1rem" }}>
					{ticks.map((t, i) => (
						<span
							aria-hidden="true"
							key={`g${i}`}
							style={{
								color: "var(--color-accent-ink)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								position: "absolute",
								right: 6,
								top: yFor(t),
								transform: "translateY(-50%)",
							}}
						>
							{fmtHours(roundTick(t)).replace("h", "")}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							fontSize: "0.6rem",
							lineHeight: 1,
							position: "absolute",
							right: 6,
							top: -1,
						}}
					>
						h
					</span>
				</div>

				<div>
					<svg
						aria-label={`Hours per active user per day from ${first} to ${last}, one line per goal: ${lines
							.map(l => `${l.label} peaking at ${fmtHours(Math.max(...l.values))}`)
							.join("; ")}`}
						height={CHART_H}
						role="img"
						style={{ display: "block" }}
						width="100%"
					>
						{ticks.map((t, i) => (
							<line
								key={`gg${i}`}
								stroke="var(--color-line-soft)"
								strokeWidth="1"
								x1={pct(EDGE)}
								x2={pct(1 - EDGE)}
								y1={yFor(t)}
								y2={yFor(t)}
							/>
						))}
						{lines.map(line =>
							segments(line.values).map((segment, i) => (
								<line
									key={`${line.label}-${i}`}
									stroke={line.colour}
									strokeLinecap="round"
									strokeWidth="1.75"
									x1={pct(segment.x1)}
									x2={pct(segment.x2)}
									y1={segment.y1}
									y2={segment.y2}
								/>
							)),
						)}
						{days.map((d, i) =>
							lines.map(line => (
								<circle
									cx={pct(xOf(i))}
									cy={yFor(line.values[i] ?? 0)}
									fill={line.colour}
									key={`${d.day}-${line.label}`}
									r="1.6"
								>
									<title>{title(d)}</title>
								</circle>
							)),
						)}
					</svg>
					<div
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							display: "grid",
							fontSize: "0.65rem",
							gap: "1px",
							gridTemplateColumns: `repeat(${days.length}, 1fr)`,
							marginTop: "4px",
							// The plot leaves EDGE either side, so the labels take the same inset and sit under their ticks.
							paddingLeft: pct(EDGE),
							paddingRight: pct(EDGE),
						}}
					>
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
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
				Hours per person who logged something that day, so a line says what one of those people did rather than how many
				there were. All three share one scale, so the lines can be read against each other. A maker who has not answered
				the goal prompt yet is on no line. Days are program-timezone effective dates; hours count journal devlogs only.
			</p>
		</div>
	)
}

/** The four columns every cluster is split into, in the order they are drawn. */
const PROJECT_KIND = [
	{ colour: "var(--color-magenta)", key: "starter", label: "Starter project" },
	{ colour: "var(--color-accent)", key: "tier1", label: "Custom, tier 1" },
	{ colour: "var(--color-teal)", key: "tier2", label: "Custom, tier 2" },
	{ colour: "var(--color-coin)", key: "tier3", label: "Custom, tier 3" },
] as const

/** A week of the season as either per-week chart draws it. */
type WeekColumn = { week: number; label: string; phase: Phase | null }

/** What a week is called in a tooltip – the theme alone does not say whether it is the design half or the build half. */
const weekNameOf = (week: WeekColumn) =>
	week.phase === Phase.DESIGN
		? `${week.label} design week`
		: week.phase === Phase.BUILD
			? `${week.label} build week`
			: "Warm-up"

/**
 * The season's two halves, as spans of columns to label beneath the axis.
 *
 * Read off the columns rather than assumed: they are contiguous in week order, so a phase's first index and its count are all the grid needs, and a season with a different number of design or build weeks still labels itself correctly.
 */
function seasonBands(weeks: WeekColumn[]) {
	return [
		{ phase: null, text: "warm-up" },
		{ phase: Phase.DESIGN, text: "design · weeks 1-5" },
		{ phase: Phase.BUILD, text: "build · weeks 6-10" },
	]
		.map(band => ({
			...band,
			at: weeks.findIndex(week => week.phase === band.phase),
			span: weeks.filter(week => week.phase === band.phase).length,
		}))
		.filter(band => band.span > 0)
}

/** The four kinds, as the swatch-and-label row both per-week charts put above their plot. */
function ProjectKindLegend() {
	return (
		<p className="hl-hint" style={{ fontSize: "0.78rem", marginBottom: "0.75rem" }}>
			{PROJECT_KIND.map((kind, i) => (
				<span key={kind.key} style={{ marginLeft: i === 0 ? 0 : "1rem" }}>
					<span
						aria-hidden="true"
						style={{
							background: kind.colour,
							borderRadius: "2px",
							display: "inline-block",
							height: "0.7rem",
							marginRight: "0.35rem",
							verticalAlign: "middle",
							width: "0.7rem",
						}}
					/>
					{kind.label}
				</span>
			))}
		</p>
	)
}

/** The theme names and the season bands under the plot, one grid cell per column so a label lands under its own bars. */
function WeekAxisLabels({ weeks }: { weeks: WeekColumn[] }) {
	return (
		<>
			<div
				style={{
					color: "var(--color-ink-muted)",
					display: "grid",
					fontSize: "0.6rem",
					gridTemplateColumns: `repeat(${weeks.length}, 1fr)`,
					marginTop: "4px",
					paddingLeft: pct(EDGE),
					paddingRight: pct(EDGE),
					textAlign: "center",
				}}
			>
				{weeks.map(week => (
					<div key={week.week} style={{ overflowWrap: "anywhere" }}>
						{week.label}
					</div>
				))}
			</div>
			<div
				style={{
					color: "var(--color-ink-muted)",
					display: "grid",
					fontSize: "0.58rem",
					gridTemplateColumns: `repeat(${weeks.length}, 1fr)`,
					marginTop: "2px",
					paddingLeft: pct(EDGE),
					paddingRight: pct(EDGE),
					textAlign: "center",
				}}
			>
				{seasonBands(weeks).map(band => (
					<div key={band.text} style={{ gridColumn: `${band.at + 1} / span ${band.span}` }}>
						{band.text}
					</div>
				))}
			</div>
		</>
	)
}

/**
 * One column cluster per week, each split into the four kinds of project.
 *
 * The clusters are the warm-up import and then the ten weeks, and those ten are five themes twice – so a cluster is labelled with the theme and the band beneath it names the half of the season, because "PCBs" is week 1 and week 6 and only the band says which. A project is counted in both of its theme's weeks, which is what it is for.
 *
 * Bars are drawn in pixels like the line charts and for the same reason: the axis labels are HTML in a grid of one cell per cluster, and only a fixed stride puts each label under its own bars.
 */
function ProjectsByWeekChart({ weeks }: { weeks: WeekProjectCluster[] }) {
	const totals = weeks.map(week => PROJECT_KIND.reduce((n, kind) => n + week[kind.key], 0))
	if (totals.length === 0 || totals.every(t => t === 0))
		return <EmptyState>No project has been started yet.</EmptyState>

	const plotH = CHART_H - PAD_T - PAD_B
	// Four bars to a cluster, sized as shares of the stride so the labels – one grid cell per cluster – still land
	// under their own bars at any panel width.
	const stride = (1 - 2 * EDGE) / weeks.length
	// The four bars take most of a cluster and the rest is the gutter between clusters. The gaps inside a cluster are
	// shares of the cluster rather than of the whole width: eleven clusters leave a stride under a tenth of the width,
	// so a gap sized against the width would be wider than the bars it is meant to separate.
	const CLUSTER_FILL = 0.62
	const BAR_GAP_SHARE = 0.12
	const clusterW = CLUSTER_FILL * stride
	const BAR_GAP = clusterW * BAR_GAP_SHARE
	const barW = (clusterW - (PROJECT_KIND.length - 1) * BAR_GAP) / PROJECT_KIND.length

	// These are counts, so the top is rounded up to a whole number of tick steps: a gridline labelled 9.25 would be nonsense on an axis of projects.
	const axisMax = Math.max(4, Math.ceil(Math.max(1, ...totals) / 4) * 4)
	const ticks = Array.from({ length: 5 }, (_, i) => (axisMax / 4) * i)

	const yFor = (v: number) => PAD_T + plotH - (v / axisMax) * plotH
	const centreOf = (i: number) => EDGE + (i + 0.5) * stride

	return (
		<div>
			<ProjectKindLegend />
			<div style={{ alignItems: "start", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)" }}>
				<div style={{ height: `${CHART_H}px`, position: "relative", width: "3.1rem" }}>
					{ticks.map((t, i) => (
						<span
							aria-hidden="true"
							key={`p${i}`}
							style={{
								color: "var(--color-accent-ink)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								position: "absolute",
								right: 6,
								top: yFor(t),
								transform: "translateY(-50%)",
							}}
						>
							{fmtInt(t)}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							fontSize: "0.6rem",
							lineHeight: 1,
							position: "absolute",
							right: 6,
							top: -1,
						}}
					>
						projects
					</span>
				</div>

				<div>
					<svg
						aria-label={`Projects being built for each week: ${weeks
							.map((week, i) => `${weekNameOf(week)} ${fmtInt(totals[i] ?? 0)}`)
							.join(", ")}`}
						height={CHART_H}
						role="img"
						style={{ display: "block" }}
						width="100%"
					>
						{ticks.map((t, i) => (
							<line
								key={`pg${i}`}
								stroke="var(--color-line-soft)"
								strokeWidth="1"
								x1={pct(EDGE)}
								x2={pct(1 - EDGE)}
								y1={yFor(t)}
								y2={yFor(t)}
							/>
						))}
						{weeks.map((week, i) =>
							PROJECT_KIND.map((kind, k) => {
								const count = week[kind.key]
								if (count === 0) return null
								const top = yFor(count)
								return (
									<rect
										fill={kind.colour}
										height={PAD_T + plotH - top}
										key={`${week.week}-${kind.key}`}
										width={pct(barW)}
										x={pct(centreOf(i) - clusterW / 2 + k * (barW + BAR_GAP))}
										y={top}
									>
										<title>{`${weekNameOf(week)} · ${kind.label}: ${fmtInt(count)}`}</title>
									</rect>
								)
							}),
						)}
					</svg>
					<WeekAxisLabels weeks={weeks} />
				</div>
			</div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
				Their stage, by the week that stage runs in: a project is in a week&apos;s column once that phase has been
				handed in, and appears in both of its theme&apos;s weeks only when it has reached both stages – design months
				before the build is a different piece of work. A project that has been described and not yet handed in is in no
				column, because no week is funding anything for it yet. The tier is the reviewer&apos;s once they have set one,
				and what the maker asked for until then; a starter project is its own column because picking one locks the
				request to Tier 1.
			</p>
		</div>
	)
}

/** An axis top a person can read hours off: 1, 2, 2.5 or 5 times a power of ten. */
function niceHoursMax(max: number): number {
	if (max <= 0) return 1
	const magnitude = 10 ** Math.floor(Math.log10(max))
	for (const step of [1, 2, 2.5, 5]) if (max <= step * magnitude) return step * magnitude
	return 10 * magnitude
}

/**
 * One stacked column per week, each split into the four kinds of project.
 *
 * The companion to the projects chart and deliberately the same shape: same eleven columns, same order of the four kinds, same bands beneath the axis. One says how many projects are in each stage, this says how much work they are – so they are read side by side rather than one instead of the other.
 *
 * Stacked rather than four bars to a cluster, because the question here is the week's total and how it splits, not four separate totals. That is also what makes the two charts worth having both: a cluster of four bars answers "how does starter compare with tier 3 here", and a stack answers "which week is carrying the work, and whose".
 *
 * Both charts attribute by phase, so a project's build week is its build work in each: the same threshold decides when a project appears in the projects chart and when its hours start counting here.
 */
function HoursByWeekChart({ weeks }: { weeks: WeekHoursCluster[] }) {
	const totals = weeks.map(week => PROJECT_KIND.reduce((n, kind) => n + week[kind.key], 0))
	if (totals.length === 0 || totals.every(t => t === 0)) return <EmptyState>No hours have been logged yet.</EmptyState>

	const plotH = CHART_H - PAD_T - PAD_B
	// One bar per week rather than four: the stack is one column, so it takes most of the stride and the rest is the gutter between weeks.
	const stride = (1 - 2 * EDGE) / weeks.length
	const barW = 0.62 * stride

	const axisMax = niceHoursMax(Math.max(...totals))
	const ticks = Array.from({ length: 5 }, (_, i) => (axisMax / 4) * i)

	const yFor = (v: number) => PAD_T + plotH - (v / axisMax) * plotH
	const centreOf = (i: number) => EDGE + (i + 0.5) * stride

	return (
		<div>
			<ProjectKindLegend />
			<div style={{ alignItems: "start", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)" }}>
				<div style={{ height: `${CHART_H}px`, position: "relative", width: "3.1rem" }}>
					{ticks.map((t, i) => (
						<span
							aria-hidden="true"
							key={`h${i}`}
							style={{
								color: "var(--color-accent-ink)",
								fontSize: "0.65rem",
								fontVariantNumeric: "tabular-nums",
								position: "absolute",
								right: 6,
								top: yFor(t),
								transform: "translateY(-50%)",
							}}
						>
							{fmtInt(t)}
						</span>
					))}
					<span
						aria-hidden="true"
						style={{
							color: "var(--color-ink-muted)",
							fontSize: "0.6rem",
							lineHeight: 1,
							position: "absolute",
							right: 6,
							top: -1,
						}}
					>
						hours
					</span>
				</div>

				<div>
					<svg
						aria-label={`Hours logged for each week: ${weeks
							.map((week, i) => `${weekNameOf(week)} ${fmtHours(totals[i] ?? 0)}`)
							.join(", ")}`}
						height={CHART_H}
						role="img"
						style={{ display: "block" }}
						width="100%"
					>
						{ticks.map((t, i) => (
							<line
								key={`hg${i}`}
								stroke="var(--color-line-soft)"
								strokeWidth="1"
								x1={pct(EDGE)}
								x2={pct(1 - EDGE)}
								y1={yFor(t)}
								y2={yFor(t)}
							/>
						))}
						{weeks.map((week, i) => {
							// Stacked from the floor up in legend order, so a segment's colour is findable without reading the tooltip. Each rect spans its own band of the stack: the running total before it is the bottom edge, after it the top.
							let stacked = 0
							return PROJECT_KIND.map(kind => {
								const value = week[kind.key]
								if (value === 0) return null
								const bottom = yFor(stacked)
								stacked += value
								const top = yFor(stacked)
								return (
									<rect
										fill={kind.colour}
										height={bottom - top}
										key={`${week.week}-${kind.key}`}
										width={pct(barW)}
										x={pct(centreOf(i) - barW / 2)}
										y={top}
									>
										<title>{`${weekNameOf(week)} · ${kind.label}: ${fmtHours(value)}`}</title>
									</rect>
								)
							})
						})}
						{/* The week's total above its column. The stack answers the shape; this answers "how much", which is the number a reader would otherwise have to add up from the tooltips. Skipped at zero, where there is no bar to sit above and a row of "0h" would only add noise. */}
						{weeks.map((week, i) => {
							const total = totals[i] ?? 0
							if (total === 0) return null
							return (
								<text
									fill="var(--color-ink-muted)"
									fontSize="0.6rem"
									key={`hlab-${week.week}`}
									style={{ fontVariantNumeric: "tabular-nums" }}
									textAnchor="middle"
									x={pct(centreOf(i))}
									y={yFor(total) - 4}
								>
									{fmtHours(total)}
								</text>
							)
						})}
					</svg>
					<WeekAxisLabels weeks={weeks} />
				</div>
			</div>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
				Hours logged for each week, attributed to the phase they were logged in – so a week&apos;s column is its own
				part of its projects, not their whole story, and every hour is counted once. The same projects the chart above
				counts, read as work rather than as headcount; a week can be busy there and flat here when its projects are
				named but nothing has been logged against them yet. Hours are the ledger&apos;s, so a session that was both
				journalled and tracked counts once.
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

	const shares = data.buckets.map(b => ({ byAccounts: b.participants / accounts, byHours: b.hours / totalHours }))
	// One scale across both series, so the taller of the two is always the full height and the comparison holds.
	const scale = Math.max(0.0001, ...shares.flatMap(s => [s.byAccounts, s.byHours]))

	const summary = data.buckets
		.filter(b => b.participants > 0)
		.map(b => `${b.label} hours ${b.participants}`)
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
						background: "var(--color-accent)",
						borderRadius: "2px",
						display: "inline-block",
						height: "0.7rem",
						marginRight: "0.35rem",
						verticalAlign: "baseline",
						width: "0.7rem",
					}}
				/>
				share of accounts
				<span
					aria-hidden="true"
					style={{
						// Same colour and opacity as the bar itself, so the key and the mark cannot drift apart.
						background: "var(--color-magenta)",
						borderRadius: "2px",
						display: "inline-block",
						height: "0.7rem",
						marginLeft: "1rem",
						marginRight: "0.35rem",
						opacity: 0.3,
						verticalAlign: "baseline",
						width: "0.7rem",
					}}
				/>
				share of hours
			</p>
			<figure style={{ margin: 0 }}>
				{/* The plot carries its own height and its columns stretch to fill it. Both are load-bearing: a
				    percentage bar has nothing to resolve against inside an auto-height parent, and `align-items: end`
				    would stop the column growing into one – which is how this chart rendered no bars at all. */}
				<div
					aria-label={`Participants and hours by hours logged: ${summary}`}
					role="img"
					style={{
						columnGap: "3px",
						display: "grid",
						gridTemplateColumns: `repeat(${data.buckets.length}, 1fr)`,
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
								style={{ display: "flex", flexDirection: "column", minWidth: 0 }}
								title={`${b.label}h: ${fmtInt(b.participants)} participants · ${fmtPct(
									share.byAccounts,
								)} of accounts with hours · ${fmtHours(b.hours)}, ${fmtPct(share.byHours)} of all hours`}
							>
								<span
									aria-hidden="true"
									style={{
										color: "var(--color-ink-muted)",
										fontSize: "0.7rem",
										fontVariantNumeric: "tabular-nums",
										lineHeight: 1,
										paddingBottom: "0.55rem",
										textAlign: "center",
									}}
								>
									{b.participants > 0 ? fmtInt(b.participants) : ""}
								</span>
								{/* flex: 1 so the bars take the space the count label does not. Both bars are pinned to
								    the floor and drawn full-width so they overlap; the hours bar sits on top, translucent,
								    so a band that is hours-heavy reads as a pale cap over the solid bar and one that is
								    people-heavy reads as a solid cap over the pale. */}
								<div style={{ flex: 1, minHeight: 0, position: "relative" }}>
									<div
										style={{
											background: b.participants === 0 ? "var(--color-surface-sunken)" : "var(--color-accent)",
											borderRadius: "3px 3px 0 0",
											bottom: 0,
											height: `${(share.byAccounts / scale) * 100}%`,
											left: 0,
											position: "absolute",
											right: 0,
										}}
									/>
									<div
										aria-hidden="true"
										style={{
											background: "var(--color-magenta)",
											borderRadius: "3px 3px 0 0",
											bottom: 0,
											height: `${(share.byHours / scale) * 100}%`,
											left: 0,
											opacity: 0.3,
											position: "absolute",
											right: 0,
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
						columnGap: "3px",
						display: "grid",
						gridTemplateColumns: `repeat(${data.buckets.length}, 1fr)`,
						marginTop: "0.3rem",
					}}
				>
					{data.buckets.map(b => (
						<span
							key={b.label}
							style={{
								color: "var(--color-ink-muted)",
								fontSize: "0.6rem",
								overflow: "hidden",
								textAlign: "center",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
							title={b.label}
						>
							{b.label}
						</span>
					))}
				</figcaption>
			</figure>
			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem" }}>
				Both series share one scale, so a pale bar taller than the solid one means the band holds more of the
				programme&apos;s hours than of its people. Hours count journal devlogs (reviewer-adjusted where set) plus linked
				Hackatime time, the same hours the geography panels total, and a sitting that was both journalled and tracked
				counts once rather than twice. {fmtInt(data.withoutHours)} accounts have no hours at all and are left off the
				chart; hover a bar for both shares.
				{data.overlapUnknownPhases > 0 && (
					<>
						{" "}
						<b>
							{fmtInt(data.overlapUnknownPhases)} phase{data.overlapUnknownPhases === 1 ? "" : "s"} could not have its
							Hackatime overlap measured, so those hours are counted on both sides and every total here reads high by up
							to that much.
						</b>{" "}
						The tracked intervals are cached, and `hackatime-sync` warms them every fifteen minutes.
					</>
				)}
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
	colors,
}: {
	rows: { label: string; value: number }[]
	/** What the ring counts, for the figure's accessible name. */
	measure: string
	empty: string
	/** Optional per-slice colors, in row order. Falls back to the default palette. */
	colors?: string[]
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
	const shares = rows.map(r => (r.value / total) * 100)
	const segments = rows.map((r, i) => ({
		label: r.label,
		share: shares[i] ?? 0,
		start: -shares.slice(0, i).reduce((n, p) => n + p, 0),
	}))
	const summary = rows.map(r => `${r.label} ${Math.round((r.value / total) * 100)}%`).join(", ")
	return (
		<div
			style={{
				alignItems: "center",
				display: "flex",
				flexWrap: "wrap",
				gap: "1.5rem",
			}}
		>
			<svg
				aria-label={`${measure}: ${summary}`}
				role="img"
				style={{ flexShrink: 0, height: "11rem", width: "11rem" }}
				viewBox="0 0 42 42"
			>
				<circle cx="21" cy="21" fill="none" r={R} stroke="var(--color-surface-sunken)" strokeWidth="7" />
				{/* The ring starts at 3 o'clock; rotate it so it starts at the top. */}
				<g transform="rotate(-90 21 21)">
					{segments.map((seg, i) => (
						<circle
							cx="21"
							cy="21"
							fill="none"
							key={seg.label}
							r={R}
							stroke={colors?.[i] ?? palette[i % palette.length]}
							strokeDasharray={`${Math.max(seg.share - 0.6, 0)} 100`}
							strokeDashoffset={seg.start}
							strokeWidth="7"
						/>
					))}
				</g>
			</svg>
			<table style={{ borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
				<tbody>
					{rows.map((row, i) => (
						<tr key={row.label}>
							<td style={{ padding: "0.2rem 0.75rem 0.2rem 0" }}>
								<span style={{ alignItems: "center", display: "inline-flex", gap: "0.5rem" }}>
									<span
										aria-hidden="true"
										style={{
											background: colors?.[i] ?? palette[i % palette.length],
											borderRadius: "2px",
											flexShrink: 0,
											height: "0.7rem",
											width: "0.7rem",
										}}
									/>
									<span style={{ fontWeight: 700 }}>{row.label}</span>
								</span>
							</td>
							<td style={{ padding: "0.2rem 0.75rem 0.2rem 0", textAlign: "right" }}>{fmtInt(row.value)}</td>
							<td style={{ padding: "0.2rem 0", textAlign: "right" }}>{Math.round((row.value / total) * 100)}%</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
