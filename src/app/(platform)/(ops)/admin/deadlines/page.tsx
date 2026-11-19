import type { Metadata } from "next"
import Link from "next/link"
import { Badge, Button, EmptyState, PageHeader, Panel, Select, Stat, Table } from "@/app/components/ui"
import { formatUtcDateTime } from "@/lib/deadline"
import { formatRemaining, remainingTone } from "@/lib/deadline-remaining"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { type DeadlineExtension, type ExtensionKind, listActiveExtensions } from "@/lib/queries/admin-deadlines"
import { firstValues, type SearchParamValue } from "@/lib/search-params"

export const metadata: Metadata = {
	title: "Deadlines",
}

export const dynamic = "force-dynamic"

interface Search {
	kind?: SearchParamValue
}

interface Props {
	searchParams: Promise<Search>
}

/** Anything unrecognised in the query string is dropped, not trusted. */
function kindFrom(value: string | undefined): ExtensionKind | undefined {
	if (value === "user" || value === "week" || value === "project") return value
	return undefined
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
	// The kind filter, taken as the single value the URL named: a repeated parameter arrives as an array, and an array is not a kind any row holds.
	const { kind: rawKind } = firstValues(await searchParams)
	const kind = kindFrom(rawKind)
	// The owner's email leaves the server for ADMIN/AUDITOR only, exactly as the user directory does.
	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	const summary = await listActiveExtensions({ includePii })
	const items = kind ? summary.items.filter(item => item.kind === kind) : summary.items
	const now = new Date()

	return (
		<div className="hl-stack">
			<PageHeader
				compact
				subtitle="Every live extension in one place – who has extra time and when it runs out."
				title="Deadlines"
			/>

			<div className="hl-row">
				<Stat label="Active user extensions" value={summary.userActive} />
				<Stat label="Active week extensions" value={summary.weekActive} />
				<Stat label="Active project extensions" value={summary.projectActive} />
			</div>

			<Panel>
				<form className="hl-row" method="get">
					<Select defaultValue={kind ?? ""} name="kind">
						<option value="">All kinds</option>
						<option value="user">User</option>
						<option value="week">Week</option>
						<option value="project">Project</option>
					</Select>
					<Button type="submit">Filter</Button>
					<Link className="hl-hint" href="/admin/deadlines">
						Reset
					</Link>
				</form>
			</Panel>

			<Panel>
				{items.length === 0 ? (
					<EmptyState>{kind ? `No active ${kind} extensions.` : "No active extensions."}</EmptyState>
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
									<Badge tone="muted">{item.kind}</Badge>
								</td>
								<td>{coversFor(item)}</td>
								<td className="hl-mono">{formatUtcDateTime(item.expiresAt)}</td>
								<td>
									<Badge tone={remainingTone(item.expiresAt, now)}>{formatRemaining(item.expiresAt, now)}</Badge>
								</td>
							</tr>
						))}
					</Table>
				)}
				{summary.expiredHidden > 0 ? (
					<p className="hl-hint" style={{ marginBottom: 0 }}>
						{summary.expiredHidden} expired, hidden.
					</p>
				) : null}
			</Panel>
		</div>
	)
}
