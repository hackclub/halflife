import type { Metadata } from "next"
import Link from "next/link"
import { TabKeys } from "@/app/components/admin/TabKeys"
import { Badge, type BadgeTone, Button, EmptyState, PageHeader, Panel, Select, Stat, Table } from "@/app/components/ui"
import { formatUtcDateTime } from "@/lib/deadline"
import { formatRemaining, remainingTone } from "@/lib/deadline-remaining"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { type DeadlineExtension, type ExtensionKind, listExtensions } from "@/lib/queries/admin-deadlines"
import { firstValues, type SearchParamValue } from "@/lib/search-params"

export const metadata: Metadata = {
	title: "Deadlines",
}

export const dynamic = "force-dynamic"

type Tab = "active" | "expired"

/** The tabs in the order the chips and the [ and ] keys step through them. */
const TABS: { id: Tab; label: string }[] = [
	{ id: "active", label: "Active" },
	{ id: "expired", label: "Expired" },
]

const tabHref = (id: Tab, kind?: ExtensionKind): string => {
	const params = new URLSearchParams()
	if (id === "expired") params.set("tab", "expired")
	if (kind) params.set("kind", kind)
	const query = params.toString()
	return query ? `/admin/deadlines?${query}` : "/admin/deadlines"
}

interface Search {
	kind?: SearchParamValue
	tab?: SearchParamValue
}

interface Props {
	searchParams: Promise<Search>
}

/** Anything unrecognised in the query string is dropped, not trusted. */
function kindFrom(value: string | undefined): ExtensionKind | undefined {
	if (value === "user" || value === "week" || value === "project") return value
	return undefined
}

/** What an extension covers, told apart by colour so a long list can be read down the kind column without reading the words. */
const KIND_TONE: { [_ in ExtensionKind]: BadgeTone } = {
	project: "info",
	user: "violet",
	week: "gold",
}

/** The name the row links under: the nickname the site shows, falling back to the email only for a caller who may see PII. */
function nameFor(item: DeadlineExtension, includePii: boolean): string {
	const email = includePii && item.email !== "" ? item.email : null
	const person = { displayName: item.userDisplayName, name: item.userName }
	if (email === null) return displayName(person) ?? "–"
	return displayName(person, email)
}

/** What the extension covers: a user extension spans every project its owner holds. */
function coversFor(item: DeadlineExtension): string {
	if (item.kind === "week") return `Week ${item.week}`
	if (item.kind === "project") return item.projectTitle ?? "–"
	return "Every project"
}

export default async function AdminDeadlinesPage({ searchParams }: Props) {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
	// The tab and the kind filter, each taken as the single value the URL named: a repeated parameter arrives as an array, and an array is not a value any row holds.
	const { kind: rawKind, tab: rawTab } = firstValues(await searchParams)
	const tab: Tab = rawTab === "expired" ? "expired" : "active"
	const kind = kindFrom(rawKind)
	// The owner's email leaves the server for ADMIN/AUDITOR only, exactly as the user directory does.
	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	const summary = await listExtensions({ includePii })
	const inTab = summary.items.filter(item => item.expired === (tab === "expired"))
	const items = kind ? inTab.filter(item => item.kind === kind) : inTab
	const now = new Date()

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
								{item.label} <span className="hl-count">{item.id === "active" ? summary.active : summary.expired}</span>
								<kbd className="hl-hotkey hl-tab-key">{index + 1}</kbd>
							</Link>
						))}
					</div>
				}
				compact
				subtitle="Every extension on record – who has extra time, when it runs out, and which ones have already run out."
				title="Deadlines"
			/>
			<TabKeys current={tabHref(tab)} hrefs={TABS.map(item => tabHref(item.id))} />

			<div className="hl-row">
				<Stat label="Active user extensions" value={summary.activeUser} />
				<Stat label="Active week extensions" value={summary.activeWeek} />
				<Stat label="Active project extensions" value={summary.activeProject} />
			</div>

			<Panel>
				<form className="hl-row" method="get">
					{tab === "expired" ? <input name="tab" type="hidden" value="expired" /> : null}
					{/* The select is uncontrolled, so it keeps whatever it was first given: the key remounts it when a kind badge sets the filter, or the bar would say "All kinds" over a filtered list. */}
					<Select defaultValue={kind ?? ""} key={kind} name="kind">
						<option value="">All kinds</option>
						<option value="user">User</option>
						<option value="week">Week</option>
						<option value="project">Project</option>
					</Select>
					<Button type="submit">Filter</Button>
					<Link className="hl-hint" href={tabHref(tab)}>
						Reset
					</Link>
				</form>
			</Panel>

			<Panel>
				{items.length === 0 ? (
					<EmptyState>
						{tab === "expired"
							? kind
								? `No expired ${kind} extensions.`
								: "No expired extensions."
							: kind
								? `No active ${kind} extensions.`
								: "No active extensions."}
					</EmptyState>
				) : (
					<Table
						head={
							includePii
								? ["User", "Email", "Kind", "Covers", "Expires", "Remaining"]
								: ["User", "Kind", "Covers", "Expires", "Remaining"]
						}
					>
						{items.map(item => (
							<tr key={`${item.kind}-${item.userId}-${item.projectId ?? ""}-${item.week ?? ""}`}>
								<td>
									<Link href={`/admin/users/${item.userId}`}>{nameFor(item, includePii)}</Link>
								</td>
								{includePii ? <td className="hl-mono">{item.email}</td> : null}
								<td>
									<Link href={tabHref(tab, item.kind)} title={`Show only ${item.kind} extensions`}>
										<Badge tone={KIND_TONE[item.kind]}>{item.kind}</Badge>
									</Link>
								</td>
								<td>{coversFor(item)}</td>
								<td className="hl-mono">{formatUtcDateTime(item.expiresAt)}</td>
								<td>
									{/*
									 * How an extension stands is the tab it is on, so the badge under Remaining opens that tab's whole list: the kind filter is dropped rather than carried, or the link would land on the page already open and change nothing.
									 */}
									<Link
										href={tabHref(item.expired ? "expired" : "active")}
										title={item.expired ? "Show all the expired extensions" : "Show all the active extensions"}
									>
										{item.expired ? (
											<Badge tone="muted">expired</Badge>
										) : (
											<Badge tone={remainingTone(item.expiresAt, now)}>{formatRemaining(item.expiresAt, now)}</Badge>
										)}
									</Link>
								</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>
		</div>
	)
}
