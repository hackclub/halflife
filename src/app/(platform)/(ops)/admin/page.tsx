import type { Metadata, Route } from "next"
import Link from "next/link"
import { ActivityStrip, DauChart, ProgrammeFilterProvider } from "@/app/components/admin/ActivityCharts"
import { ActivityShareChart } from "@/app/components/admin/ActivityShareChart"
import {
	CHART_H,
	DayAxis,
	EDGE,
	GridLines,
	niceTicks,
	PAD_B,
	PAD_T,
	pct,
	YAxis,
} from "@/app/components/admin/chart-geometry"
import { TabKeys } from "@/app/components/admin/TabKeys"
import { UserFlowDiagram } from "@/app/components/admin/UserFlowDiagram"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { getProgrammeNps } from "@/lib/airtable/nps"
import { GOAL_OPTIONS } from "@/lib/config/goal"
import { formatUtcDateTime } from "@/lib/deadline"
import { type ParticipantGoal, Phase, type ReviewResult } from "@/lib/enums"
import { fmtInt } from "@/lib/numbers"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getProgramSettings } from "@/lib/program"
import {
	countContentReports,
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
	getUserFlowWeekly,
	getVerificationStats,
	type HoursDistribution,
	type WeekHoursCluster,
	type WeekProjectCluster,
} from "@/lib/queries/admin"
import { getUserFlowSankey } from "@/lib/queries/admin-flow"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { getLatestSyncRuns } from "@/lib/sync-run-log"

export const metadata: Metadata = {
	title: "Overview",
}

export const dynamic = "force-dynamic"

const fmtHours = (h: number) => `${h.toLocaleString("en-US", { maximumFractionDigits: 1 })}h`

/** A share of a whole. One decimal, because the small bands are where the comparison is worth making. */
const fmtPct = (share: number) => `${(share * 100).toFixed(1)}%`

/** An NPS keeps its sign, so a positive score reads as positive rather than as an unsigned count. */
const fmtNps = (score: number | null) => (score === null ? "-" : score > 0 ? `+${score}` : String(score))

/** Outcome wording, the same one a maker is told in lib/notifications. */
const RESULT_LABEL: { [_ in ReviewResult]: string } = {
	APPROVED: "Approved",
	REJECTED: "Rejected",
	RETURNED: "Changes requested",
}

/** The tabs in the order the chips and the [ and ] keys step through them. */
const TABS = [
	{ id: "summary", label: "Summary" },
	{ id: "people", label: "People" },
	{ id: "activity", label: "Activity" },
	{ id: "jobs", label: "Jobs" },
] as const

type OverviewTab = (typeof TABS)[number]["id"]

const tabHref = (id: OverviewTab): Route => (id === "summary" ? "/admin" : `/admin?tab=${id}`)

interface Props {
	searchParams: Promise<{ tab?: SearchParamValue }>
}

export default async function AdminOverviewPage({ searchParams }: Props) {
	await requireAnyPermissionPage(
		Permission.VIEW_USERS,
		Permission.MANAGE_SHOP,
		Permission.FULFILL_ORDERS,
		Permission.VIEW_AUDIT_LOG,
		Permission.MANAGE_PROGRAM,
	)
	// The tab, taken as the single value the URL named: a repeated parameter arrives as an array, which is not a tab.
	const { tab: requestedTab } = firstValues(await searchParams)
	const tab: OverviewTab = TABS.find(item => item.id === requestedTab)?.id ?? "summary"

	return (
		<div className="hl-stack">
			<PageHeader
				actions={
					<div className="hl-row">
						{TABS.map((item, index) => (
							<Link
								aria-current={item.id === tab || undefined}
								aria-keyshortcuts={`Alt+${index + 1}`}
								className="hl-chip"
								href={tabHref(item.id)}
								key={item.id}
							>
								{item.label}
								<kbd className="hl-hotkey hl-tab-key">{index + 1}</kbd>
							</Link>
						))}
					</div>
				}
				compact
				title="Overview"
			/>
			<TabKeys current={tabHref(tab)} hrefs={TABS.map(item => tabHref(item.id))} />

			{tab === "summary" ? <SummaryTab /> : null}
			{tab === "people" ? <PeopleTab /> : null}
			{tab === "activity" ? <ActivityTab /> : null}
			{tab === "jobs" ? <JobsTab /> : null}
		</div>
	)
}

/** Summary: what needs attention, the headline figures, NPS and reviewer activity. Only its own queries run when this tab is open. */
async function SummaryTab() {
	const [counters, nps, activeUsers, projectReviewStatuses, reviewer, reportCounts] = await Promise.all([
		getAdminCounters(),
		getProgrammeNps(),
		getDailyActiveUsers(),
		getProjectReviewStatuses(),
		getReviewerStats(),
		countContentReports(),
	])

	return (
		<>
			{/* The figures sit beside the work waiting on staff once the summary is wide enough for both; below that they keep their own row. */}
			<div className="hl-overview-band">
				<Panel title="Needs attention">
					<nav aria-label="Work waiting on staff" className="hl-attention">
						<Link data-zero={counters.pendingOrders === 0 ? "true" : undefined} href="/admin/fulfillment">
							<strong>{fmtInt(counters.pendingOrders)}</strong>
							<span>orders to fulfil</span>
						</Link>
						<Link data-zero={counters.pendingReviews === 0 ? "true" : undefined} href="/reviews">
							<strong>{fmtInt(counters.pendingReviews)}</strong>
							<span>projects awaiting review</span>
						</Link>
						<Link data-zero={reportCounts.OPEN === 0 ? "true" : undefined} href="/admin/reports">
							<strong>{fmtInt(reportCounts.OPEN)}</strong>
							<span>open reports</span>
						</Link>
					</nav>
				</Panel>

				<div className="hl-row hl-overview-figures">
					<Stat label="Participants" value={counters.participants} />
					<Stat label="Active today" value={activeUsers.today} />
					<Stat label="Printers earned" value={counters.shipped} />
				</div>
			</div>

			{/* The two panels sit side by side once the summary is wide enough for both; below that they stack. */}
			<div className="hl-overview-pair">
				<div className="hl-overview-pair-cols">
					<Panel
						actions={<span className="hl-hint hl-note--inline">from the dashboard prompt</span>}
						title="Net Promoter Score"
					>
						{nps === null ? (
							<EmptyState>NPS is unavailable: Airtable is not configured or did not answer.</EmptyState>
						) : nps.responses === 0 ? (
							<EmptyState>Nobody has answered the NPS question yet.</EmptyState>
						) : (
							<div className="flex flex-wrap items-center justify-between gap-6">
								<ShareDonut
									centerLabel="responses"
									colors={["var(--color-teal)", "var(--color-coin)", "var(--color-flame)"]}
									empty="No NPS answers yet."
									measure="NPS answers"
									rows={[
										{ detail: "9-10", label: "Promoters", value: nps.promoters },
										{ detail: "7-8", label: "Passives", value: nps.passives },
										{ detail: "0-6", label: "Detractors", value: nps.detractors },
									]}
								/>
								<Stat label="Net Promoter Score" value={fmtNps(nps.score)} />
							</div>
						)}
						<p className="hl-hint hl-note">
							Promoters score 9 or 10, passives 7 or 8 and detractors 0 to 6. The score is the promoter share minus the
							detractor share, so it runs from -100 to 100, and everyone who has answered counts once. Read from the
							same Signups table the dashboard&apos;s prompt writes to, cached for a minute.
						</p>
					</Panel>

					{/* The wrapper is the container the figures' stacking reads, since a panel cannot take a class here; see `.hl-overview-reviewer`. */}
					<div className="hl-overview-reviewer">
						<Panel
							actions={
								<span className="hl-hint hl-note--inline">each project counted once, in the state its card shows</span>
							}
							title="Reviewer activity"
						>
							<div className="flex flex-wrap items-center justify-between gap-6">
								<ShareDonut
									centerLabel="submitted"
									colors={["var(--color-teal)", "var(--color-coin)", "var(--color-flame)", "var(--color-accent)"]}
									empty="No projects with a review state yet."
									measure="Project review status"
									rows={projectReviewStatuses.map(s => ({ label: s.label, value: s.value }))}
								/>
								{/* A column beside the donut, and a row once the donut pushes it onto its own line: the figures' own width decides, see `.hl-figure-stack`. */}
								<div className="hl-figure-stack">
									<div className="hl-figure-stack-list">
										<Stat label="Reviewed today" value={reviewer.reviewedToday} />
										<Stat label="Projects reviewed" value={reviewer.reviewedTotal} />
									</div>
								</div>
							</div>
							<Table head={["Outcome", "Today", "All time"]}>
								{reviewer.byResult.map(row => (
									<tr key={row.result}>
										<td>{RESULT_LABEL[row.result]}</td>
										<td className="hl-mono">{fmtInt(row.today)}</td>
										<td className="hl-mono">{fmtInt(row.total)}</td>
									</tr>
								))}
							</Table>
							<p className="hl-hint hl-note">
								Each project is counted once, in the one state it is in now: rejected if either phase was rejected,
								needs changes if either phase is waiting on the maker, pending if either phase is in review, otherwise
								approved. It is the same state the project&apos;s card shows, so a design approved while its build is
								still in review reads as pending rather than as two slices, and a resubmission does not leave a second
								copy of the project behind. Projects that have never been submitted are left out. Console decisions are
								included.
							</p>
						</Panel>
					</div>
				</div>
			</div>
		</>
	)
}

/** People: the sign-up flow, where people come from and what they chose. Only its own queries run when this tab is open. */
async function PeopleTab() {
	const [flow, sankeyData, weeklyFlow, areas, countries, hoursSpread, firstProjects, verification] = await Promise.all([
		getUserFlowFunnel(),
		getUserFlowSankey(),
		getUserFlowWeekly(),
		getAreaStats(),
		getCountryStats(),
		getHoursDistribution(),
		getFirstProjectStats(),
		getVerificationStats(),
	])

	return (
		<>
			<UserFlowDiagram sankey={sankeyData.diagram} steps={flow} weeks={weeklyFlow} />

			<Panel title="Activities after onboarding">
				<ActivityShareChart share={sankeyData.activityShare} />
			</Panel>

			<Panel title="Users & hours by continent">
				<div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] items-start gap-6">
					<MetricPie format={fmtInt} pick={r => r.users} rows={areas} title="Users" />
					<MetricPie format={fmtHours} pick={r => r.hours} rows={areas} title="Hours" />
				</div>
				<p className="hl-hint hl-note">
					Continents group each account&apos;s timezone; Unknown has none on file. Hours count journal devlogs
					(reviewer-adjusted where set) plus linked Hackatime time, attributed to the author&apos;s region.
				</p>
			</Panel>

			<Panel title="Users & hours by country">
				<div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] items-start gap-6">
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
				<p className="hl-hint hl-note">
					Countries map each account&apos;s timezone; zones with nothing to place read as Unknown.
				</p>
			</Panel>

			<Panel title="First project choice">
				<ShareDonut
					empty="No finished setups yet."
					measure="First project choice"
					rows={firstProjects.map(s => ({ label: s.label, value: s.users }))}
				/>
				<p className="hl-hint hl-note">
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
				<p className="hl-hint hl-note">
					Hack Club Auth&apos;s own reading of each account, taken at its last sign-in or purchase. Only a verified
					identity can be paid; needs verification is somebody part-way through IDV, and not asked is an account no
					sign-in has reported on yet.
				</p>
			</Panel>

			<Panel title="Hours per participant">
				<HoursHistogram data={hoursSpread} />
			</Panel>
		</>
	)
}

/** Activity: daily and weekly activity charts. Only its own queries run when this tab is open. */
async function ActivityTab() {
	const [settings, activity, activeUsers, activityByGoal, projectsByWeek, hoursByWeek] = await Promise.all([
		getProgramSettings(),
		getDailyActivity(),
		getDailyActiveUsers(),
		getDailyActivityByGoal(),
		getProjectsByWeek(),
		getHoursByWeek(),
	])

	// `eventStartDate` is stored as UTC midnight of the calendar day the programme opens, which is also the day week 1 opens in the programme's timezone. The charts' days are effective dates in that timezone, so its UTC date is what they are compared against.
	const programmeStart = settings.eventStartDate.toISOString().slice(0, 10)

	return (
		<>
			<ProgrammeFilterProvider programmeStart={programmeStart}>
				<Panel title="Daily active users">
					<DauChart days={activeUsers.days} />
					<p className="hl-hint hl-note">
						A person counts once a day, and only once that day&apos;s tracked time reaches 15 minutes. A visit with no
						time logged does not count, and neither do three devlogs where one would have done. Days are
						program-timezone effective dates, the day the work counted for. The bars behind the line are each
						week&apos;s average, over the days that week covers on the chart, and are labelled where they are wide
						enough to hold the number.
					</p>
				</Panel>

				<Panel title="Activity over time">
					<ActivityStrip days={activity} />
					<p className="hl-hint hl-note">
						Days are program-timezone effective dates, the day the work counted for. Hours count journal devlogs only.
					</p>
				</Panel>

				<Panel title="Activity per user over time">
					<ActivityStrip days={activity} perUser />
					<p className="hl-hint hl-note">
						One person&apos;s average working day rather than the programme&apos;s total. Read beside the chart above,
						the totals say how much was done and this says how thinly it was spread, so a busy day and a flat average
						together mean the work was going somewhere, and both rising means more people joined in.
					</p>
				</Panel>
			</ProgrammeFilterProvider>

			<Panel title="Hours per user by goal">
				<GoalHoursChart days={activityByGoal} />
				<p className="hl-hint hl-note">
					The same hours split by what each maker said they are here for. Where the three lines separate, the goal
					question is saying something about effort; where they move together, it is saying something about the
					programme.
				</p>
			</Panel>

			<Panel title="Projects per week">
				<ProjectsByWeekChart weeks={projectsByWeek} />
				<p className="hl-hint hl-note">
					What people are building, by the week it is for. A project sits in its theme&apos;s design week once the
					design has been handed in, and in the build week once the build has, so the two PCBs blocks are different
					projects, not one cohort counted twice.
				</p>
			</Panel>
			<Panel title="Hours per week">
				<HoursByWeekChart weeks={hoursByWeek} />
			</Panel>
		</>
	)
}

/** Jobs: when each scheduled job last succeeded and what it recorded. */
async function JobsTab() {
	const syncs = await getLatestSyncRuns([
		"hackatime",
		"airtable_ysws",
		"airtable_rsvp",
		"airtable_loops",
		"claim_sweep",
		"printer_reconcile",
		"help_ticket_summary",
		"project_review_summary",
	])

	return (
		<Panel actions={<Link href="/admin/audit?action=AIRTABLE_SYNC_FAILURE">Sync failures</Link>} title="Scheduled jobs">
			{syncs.length === 0 ? (
				<EmptyState>No job has completed yet. Run them by hand from Orchard to check the wiring.</EmptyState>
			) : (
				<Table head={["Job", "Last success", "Result"]}>
					{syncs.map(run => (
						<tr key={run.syncKey}>
							<td className="hl-mono">{run.syncKey}</td>
							<td className="hl-mono">{formatUtcDateTime(run.lastRunAt)}</td>
							<td>
								<SyncResult result={run.result} />
							</td>
						</tr>
					))}
				</Table>
			)}
		</Panel>
	)
}

/** A value as a job records it: plain, so a flag reads `false` rather than `"false"` behind JSON quotes. */
function scalarText(value: unknown): string {
	if (value === null || value === undefined) return "—"
	if (typeof value === "string") return value
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
	return JSON.stringify(value) ?? "—"
}

/**
 * A job's result as the counters it actually holds.
 *
 * Every scheduled job records a flat object – `scanned`, `updated`, `failed`, `degraded` – and the one-line JSON dump made a reader pick the numbers out of brackets, quotes and commas. Here the keys are small mono labels and the values sit beside them, wrapping down the cell instead of forcing the panel sideways. A job that ever records something nested falls back to indented JSON, so nothing is hidden behind a summary.
 */
function SyncResult({ result }: Readonly<{ result: unknown }>) {
	if (result === null || result === undefined) return <span className="hl-muted">—</span>
	if (typeof result !== "object") return <span className="hl-mono">{scalarText(result)}</span>

	const entries = Object.entries(result)
	if (entries.length === 0) return <span className="hl-muted">—</span>

	// An array or a nested object is a payload, not a set of counters, so it keeps the shape JSON gives it.
	if (Array.isArray(result) || entries.some(([, value]) => value !== null && typeof value === "object"))
		return <pre className="hl-audit-json">{JSON.stringify(result, null, 2)}</pre>

	return (
		<ul className="hl-sync-result">
			{entries.map(([key, value]) => (
				<li key={key}>
					<span className="hl-sync-key">{key}</span>
					<span className="hl-sync-value">{scalarText(value)}</span>
				</li>
			))}
		</ul>
	)
}

/**
 * One metric as a donut pie: the biggest slices named, the long tail folded into Other. Shared by the continent and country panels, once for users and once for hours – both hand it rows shaped the same way and say which field to cut by.
 */
function MetricPie({
	title: heading,
	rows,
	pick,
	format,
}: {
	title: string
	rows: { label: string; users: number; hours: number }[]
	pick(row: { label: string; users: number; hours: number }): number
	format(n: number): string
}) {
	const ranked = rows
		.map(r => ({ label: r.label, value: pick(r) }))
		.filter(s => s.value > 0)
		.toSorted((a, b) => b.value - a.value)
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

	const wedges: ((typeof colored)[number] & { from: number; sweep: number })[] = []
	let angle = 0
	for (const s of colored) {
		const sweep = (s.value / total) * 360
		wedges.push({ ...s, from: angle, sweep })
		angle += sweep
	}

	const summary = colored
		.slice(0, 3)
		.map(s => `${s.label} ${s.pct.toFixed(1)}%`)
		.join(", ")

	return (
		<figure className="m-0">
			<figcaption className="mb-2 text-center font-extrabold">
				{heading} · {format(total)}
			</figcaption>
			<div className="flex flex-wrap items-center gap-4">
				<svg
					aria-label={`${heading} by share: ${summary}${colored.length > 3 ? ", and more" : ""}`}
					className="size-44 shrink-0"
					role="img"
					viewBox="0 0 200 200"
				>
					{only ? (
						<>
							<circle cx={CX} cy={CY} fill={only.color} r={R} />
							<circle cx={CX} cy={CY} r={HOLE} style={{ fill: "var(--color-surface-raised)" }} />
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
									fill={w.color}
									key={w.label}
									strokeWidth={2}
									style={{ stroke: "var(--color-surface-raised)" }}
								>
									<title>{`${w.label}: ${format(w.value)} (${w.pct.toFixed(1)}%)`}</title>
								</path>
							)
						})
					)}
					<text
						className="fill-(--color-ink-strong) text-[1.35rem] font-extrabold"
						textAnchor="middle"
						x={CX}
						y={CY - 2}
					>
						{format(total)}
					</text>
					<text className="fill-(--color-ink) text-[0.8rem] font-medium" textAnchor="middle" x={CX} y={CY + 20}>
						total {heading.toLowerCase()}
					</text>
				</svg>
				<table className="min-w-40 flex-[1_1_10rem] border-collapse text-[0.82rem] tabular-nums">
					<tbody>
						{colored.map(s => (
							<tr key={s.label}>
								<td className="py-[0.15rem] pr-3 pl-0">
									<span className="inline-flex items-center gap-[0.45rem]">
										<span
											aria-hidden="true"
											className="inline-block size-[0.7rem] shrink-0 rounded-[3px]"
											style={{ background: s.color }}
										/>
										<span className="overflow-hidden text-ellipsis whitespace-nowrap">{s.label}</span>
									</span>
								</td>
								<td className="py-[0.15rem] pr-3 pl-0 text-right whitespace-nowrap">{format(s.value)}</td>
								<td className="py-[0.15rem] text-right whitespace-nowrap">{s.pct.toFixed(1)}%</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</figure>
	)
}

/** One line per answer to the goal prompt, in `GOAL_OPTIONS` order. */
const GOAL_LINE_COLOUR: { [_ in ParticipantGoal]: string } = {
	FULL_FUNDING: "var(--color-teal)",
	PARTIAL_FUNDING: "var(--color-coin)",
	PRINTER: "var(--color-accent)",
}

const perUser = (hours: number, users: number) => (users > 0 ? hours / users : 0)

const title = (d: GoalDayActivity) =>
	`${d.day}: ${d.byGoal
		.map(g => `${GOAL_OPTIONS.find(o => o.value === g.goal)?.short ?? g.goal} ${fmtHours(perUser(g.hours, g.users))}`)
		.join(", ")} per person`

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

	// One maximum across all three: the comparison between the lines is the chart. The axis grows to the next round tick above it so the lines share readable gridlines.
	const maxHours = Math.max(1, ...lines.flatMap(l => l.values))
	const axis = niceTicks(maxHours)

	const xOf = (i: number) => (days.length === 1 ? 0.5 : EDGE + (i / (days.length - 1)) * (1 - 2 * EDGE))
	const yFor = (v: number) => PAD_T + plotH - (v / axis.top) * plotH
	/** One segment per pair of points: a `d` attribute cannot carry the percentage x. */
	const segments = (values: number[]) =>
		values.slice(1).map((value, i) => {
			const previous = values[i] ?? value
			return { x1: xOf(i), x2: xOf(i + 1), y1: yFor(previous), y2: yFor(value) }
		})

	const { ticks } = axis
	const labelEvery = Math.max(1, Math.ceil(days.length / 14))
	const first = days[0]?.day
	const last = days.at(-1)?.day
	// One title per day on every line's dot, so hovering any of the three gives the whole day rather than a third of it.

	return (
		<div>
			<p className="hl-hint hl-note--lead">
				{lines.map((line, i) => (
					<span className={i === 0 ? undefined : "ml-4"} key={line.label}>
						<span
							aria-hidden="true"
							className="mr-[0.35rem] inline-block h-[0.15rem] w-[0.7rem] align-middle"
							style={{ background: line.colour }}
						/>
						{line.label} (averaging {fmtHours(line.mean)})
					</span>
				))}
			</p>
			<div className="grid grid-cols-[auto_minmax(0,1fr)] items-start">
				<YAxis caption="h" format={t => fmtHours(t).replace("h", "")} ticks={ticks} yFor={yFor} />

				<div>
					<svg
						aria-label={`Hours per active user per day from ${first} to ${last}, one line per goal: ${lines
							.map(l => `${l.label} peaking at ${fmtHours(Math.max(...l.values))}`)
							.join("; ")}`}
						className="block"
						height={CHART_H}
						role="img"
						width="100%"
					>
						<GridLines ticks={ticks} yFor={yFor} />
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
					<DayAxis days={days} labelEvery={labelEvery} />
				</div>
			</div>
			<p className="hl-hint hl-note hl-note--tight">
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
interface WeekColumn {
	label: string
	phase: Phase | null
	week: number
}

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
		<p className="hl-hint hl-note--lead">
			{PROJECT_KIND.map((kind, i) => (
				<span className={i === 0 ? undefined : "ml-4"} key={kind.key}>
					<span
						aria-hidden="true"
						className="mr-[0.35rem] inline-block size-[0.7rem] rounded-[2px] align-middle"
						style={{ background: kind.colour }}
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
				className="mt-1 grid text-center text-[0.6rem] text-(--color-ink-muted)"
				style={{
					gridTemplateColumns: `repeat(${weeks.length}, 1fr)`,
					paddingLeft: pct(EDGE),
					paddingRight: pct(EDGE),
				}}
			>
				{weeks.map(week => (
					<div className="wrap-anywhere" key={week.week}>
						{week.label}
					</div>
				))}
			</div>
			<div
				className="mt-[2px] grid text-center text-[0.58rem] text-(--color-ink-muted)"
				style={{
					gridTemplateColumns: `repeat(${weeks.length}, 1fr)`,
					paddingLeft: pct(EDGE),
					paddingRight: pct(EDGE),
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
	if (totals.every(t => t === 0)) return <EmptyState>No project has been started yet.</EmptyState>

	const plotH = CHART_H - PAD_T - PAD_B
	// Four bars to a cluster, sized as shares of the stride so the labels – one grid cell per cluster – still land under their own bars at any panel width.
	const stride = (1 - 2 * EDGE) / weeks.length
	// The four bars take most of a cluster and the rest is the gutter between clusters. The gaps inside a cluster are shares of the cluster rather than of the whole width: eleven clusters leave a stride under a tenth of the width, so a gap sized against the width would be wider than the bars it is meant to separate.
	const CLUSTER_FILL = 0.62
	const BAR_GAP_SHARE = 0.12
	const clusterW = CLUSTER_FILL * stride
	const BAR_GAP = clusterW * BAR_GAP_SHARE
	const barW = (clusterW - (PROJECT_KIND.length - 1) * BAR_GAP) / PROJECT_KIND.length

	// These are counts, so the axis is in whole projects and every gridline is a multiple of the step. The tallest mark is one kind's bar, never the week's four added together – they stand side by side and are never drawn as one column, so sizing to the sum put a week of 280-high bars against a top of 560. Four is the floor, so a near-empty chart still has a grid to read against.
	const tallest = Math.max(1, ...weeks.flatMap(week => PROJECT_KIND.map(kind => week[kind.key])))
	const axis = niceTicks(Math.max(4, tallest), { integer: true })
	const { ticks } = axis

	const yFor = (v: number) => PAD_T + plotH - (v / axis.top) * plotH
	const centreOf = (i: number) => EDGE + (i + 0.5) * stride

	return (
		<div>
			<ProjectKindLegend />
			<div className="grid grid-cols-[auto_minmax(0,1fr)] items-start">
				<YAxis caption="projects" format={fmtInt} ticks={ticks} yFor={yFor} />

				<div>
					<svg
						aria-label={`Projects being built for each week: ${weeks
							.map((week, i) => `${weekNameOf(week)} ${fmtInt(totals[i] ?? 0)}`)
							.join(", ")}`}
						className="block"
						height={CHART_H}
						role="img"
						width="100%"
					>
						<GridLines ticks={ticks} yFor={yFor} />
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
			<p className="hl-hint hl-note hl-note--tight">
				Their stage, by the week that stage runs in: a project is in a week&apos;s column once that phase has been
				handed in, and appears in both of its theme&apos;s weeks only when it has reached both stages. Design months
				before the build is a different piece of work. A project that has been described and not yet handed in is in no
				column, because no week is funding anything for it yet. The tier is the reviewer&apos;s once they have set one,
				and what the maker asked for until then; a starter project is its own column because picking one locks the
				request to Tier 1.
			</p>
		</div>
	)
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
	if (totals.every(t => t === 0)) return <EmptyState>No hours have been logged yet.</EmptyState>

	const plotH = CHART_H - PAD_T - PAD_B
	// One bar per week rather than four: the stack is one column, so it takes most of the stride and the rest is the gutter between weeks.
	const stride = (1 - 2 * EDGE) / weeks.length
	const barW = 0.62 * stride

	const axis = niceTicks(Math.max(...totals))
	const { ticks } = axis

	const yFor = (v: number) => PAD_T + plotH - (v / axis.top) * plotH
	const centreOf = (i: number) => EDGE + (i + 0.5) * stride

	return (
		<div>
			<ProjectKindLegend />
			<div className="grid grid-cols-[auto_minmax(0,1fr)] items-start">
				<YAxis caption="hours" format={t => fmtHours(t).replace("h", "")} ticks={ticks} yFor={yFor} />

				<div>
					<svg
						aria-label={`Hours logged for each week: ${weeks
							.map((week, i) => `${weekNameOf(week)} ${fmtHours(totals[i] ?? 0)}`)
							.join(", ")}`}
						className="block"
						height={CHART_H}
						role="img"
						width="100%"
					>
						<GridLines ticks={ticks} yFor={yFor} />
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
									className="tabular-nums"
									fill="var(--color-ink-muted)"
									fontSize="0.6rem"
									key={`hlab-${week.week}`}
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
			<p className="hl-hint hl-note hl-note--tight">
				Hours logged for each week, attributed to the phase they were logged in, so a week&apos;s column is its own part
				of its projects, not their whole story, and every hour is counted once. The same projects the chart above
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
 * The solid bar is the band's share of the accounts, the pale one its share of the hours. Both are drawn against one scale – the largest share either series has – so the pair can be compared directly: where the pale bar tops the solid one, that band holds more of the programme's hours than of its people, and the other way round where it does not. Scaling each series to its own maximum would look tidier and mean nothing, because a band would look hours-heavy purely because hours happen to be spread more evenly than people.
 *
 * The shares, not the counts, are the thing drawn: buckets are unequal by design, so a count bar would say as much about the bucket's width as about the band. The counts are still what is written above each column, because that is the number an operator actually reads off this chart.
 */
function HoursHistogram({ data }: { data: HoursDistribution }) {
	if (data.withHours === 0) return <EmptyState>No hours logged yet.</EmptyState>

	// Guarded because both shares divide by them: a cohort or a total that somehow came to zero would otherwise put NaN% in every tooltip and a NaN height on every bar, which is worse than a slightly wrong number.
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
			{/* Inline gap: `.hl-row` sets its own unlayered gap, which would beat a utility here. */}
			<div className="hl-row mb-[0.9rem]" style={{ gap: "1.25rem" }}>
				<Stat label="Accounts with hours" value={fmtInt(data.withHours)} />
				<Stat label="Median hours" value={data.median === null ? "-" : fmtHours(data.median)} />
				<Stat label="Total hours" value={fmtHours(data.totalHours)} />
			</div>
			<p className="hl-hint hl-note--legend">
				<span
					aria-hidden="true"
					className="mr-[0.35rem] inline-block size-[0.7rem] rounded-[2px] align-baseline bg-(--color-accent)"
				/>
				share of accounts
				{/* Same colour and opacity as the bar itself, so the key and the mark cannot drift apart. */}
				<span
					aria-hidden="true"
					className="mr-[0.35rem] ml-4 inline-block size-[0.7rem] rounded-[2px] align-baseline bg-(--color-magenta) opacity-30"
				/>
				share of hours
			</p>
			<figure className="m-0">
				{/* The plot carries its own height and its columns stretch to fill it. Both are load-bearing: a percentage bar has nothing to resolve against inside an auto-height parent, and `align-items: end` would stop the column growing into one – which is how this chart rendered no bars at all. */}
				<div
					aria-label={`Participants and hours by hours logged: ${summary}`}
					className="grid h-44 gap-x-[3px]"
					role="img"
					style={{ gridTemplateColumns: `repeat(${data.buckets.length}, 1fr)` }}
				>
					{data.buckets.map((b, i) => {
						const share = shares[i] ?? { byAccounts: 0, byHours: 0 }
						return (
							// The tooltip hangs on the whole column rather than on a bar. Both bars are absolutely positioned and the hours one is painted last, so a title on the solid bar would be covered by the translucent one wherever the hours bar is the taller – exactly the half of the chart the tooltip is most worth reading. The column is the common ancestor, so hovering anywhere in it, bars included, reaches the one tooltip.
							<div
								className="flex min-w-0 flex-col"
								key={b.label}
								title={`${b.label}h: ${fmtInt(b.participants)} participants · ${fmtPct(
									share.byAccounts,
								)} of accounts with hours · ${fmtHours(b.hours)}, ${fmtPct(share.byHours)} of all hours`}
							>
								<span
									aria-hidden="true"
									className="pb-[0.55rem] text-center text-[0.7rem] leading-none text-(--color-ink-muted) tabular-nums"
								>
									{b.participants > 0 ? fmtInt(b.participants) : ""}
								</span>
								{/* flex: 1 so the bars take the space the count label does not. Both bars are pinned to the floor and drawn full-width so they overlap; the hours bar sits on top, translucent, so a band that is hours-heavy reads as a pale cap over the solid bar and one that is people-heavy reads as a solid cap over the pale. */}
								<div className="relative min-h-0 flex-1">
									<div
										className="absolute inset-x-0 bottom-0 rounded-t-[3px]"
										style={{
											background: b.participants === 0 ? "var(--color-surface-sunken)" : "var(--color-accent)",
											height: `${(share.byAccounts / scale) * 100}%`,
										}}
									/>
									<div
										aria-hidden="true"
										className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-(--color-magenta) opacity-30"
										style={{ height: `${(share.byHours / scale) * 100}%` }}
									/>
								</div>
							</div>
						)
					})}
				</div>
				<figcaption
					aria-hidden="true"
					className="mt-[0.3rem] grid gap-x-[3px]"
					style={{ gridTemplateColumns: `repeat(${data.buckets.length}, 1fr)` }}
				>
					{data.buckets.map(b => (
						<span
							className="overflow-hidden text-center text-[0.6rem] text-ellipsis whitespace-nowrap text-(--color-ink-muted)"
							key={b.label}
							title={b.label}
						>
							{b.label}
						</span>
					))}
				</figcaption>
			</figure>
			<p className="hl-hint hl-note">
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
	centerLabel,
}: {
	rows: { label: string; value: number; detail?: string }[]
	/** What the ring counts, for the figure's accessible name. */
	measure: string
	empty: string
	/** Optional per-slice colors, in row order. Falls back to the default palette. */
	colors?: string[]
	/** When set, the ring's total is written in the middle under this caption. */
	centerLabel?: string
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
	const hasDetail = rows.some(row => row.detail !== undefined)
	return (
		<div className="flex flex-wrap items-center gap-6">
			<svg
				aria-label={`${measure}${centerLabel ? `, ${fmtInt(total)} ${centerLabel} in total` : ""}: ${summary}`}
				className="size-44 shrink-0"
				role="img"
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
				{centerLabel ? (
					<>
						<text
							className="fill-(--color-ink-strong) text-[6px] font-extrabold tabular-nums"
							dominantBaseline="middle"
							textAnchor="middle"
							x="21"
							y="19.4"
						>
							{fmtInt(total)}
						</text>
						<text
							className="fill-(--color-ink-muted) text-[2.9px]"
							dominantBaseline="middle"
							textAnchor="middle"
							x="21"
							y="24"
						>
							{centerLabel}
						</text>
					</>
				) : null}
			</svg>
			<table className="border-collapse tabular-nums">
				<tbody>
					{rows.map((row, i) => (
						<tr key={row.label}>
							<td className="py-[0.2rem] pr-3 pl-0">
								<span className="inline-flex items-center gap-2">
									<span
										aria-hidden="true"
										className="size-[0.7rem] shrink-0 rounded-[2px]"
										style={{ background: colors?.[i] ?? palette[i % palette.length] }}
									/>
									<span className="font-bold">{row.label}</span>
								</span>
							</td>
							{/* A detail, such as a score band, gets a column of its own, so the name reads without its range; the column only exists when some row has one. */}
							{hasDetail ? <td className="py-[0.2rem] pr-3 pl-0 text-(--color-ink-muted)">{row.detail}</td> : null}
							<td className="py-[0.2rem] pr-3 pl-0 text-right">{fmtInt(row.value)}</td>
							<td className="py-[0.2rem] text-right">{Math.round((row.value / total) * 100)}%</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
