import Link from "next/link"
import { ClipboardSearchButton } from "@/app/components/admin/ClipboardSearchButton"
import { CopyEmail } from "@/app/components/admin/CopyEmail"
import { Badge, Button, EmptyState, PageHeader, Panel, Table, TextInput } from "@/app/components/ui"
import { IconSearch } from "@/app/components/ui/icons"
import { displayName } from "@/lib/display-name"
import { penaltyFor } from "@/lib/moderation"
import { requirePermissionPage } from "@/lib/page-guards"
import {
	hasRole,
	PERMISSION_COUNT,
	PERMISSION_LEVEL_LABELS,
	Permission,
	permissionSummary,
	Role,
	readablePermission,
} from "@/lib/permissions"
import { listUsers, USER_STATES, type UserState } from "@/lib/queries/admin"
import { firstValues, type SearchParamValue } from "@/lib/search-params"

export const dynamic = "force-dynamic"

interface Props {
	searchParams: Promise<{ cursor?: SearchParamValue; q?: SearchParamValue; state?: SearchParamValue }>
}

/** The filter chips' labels, in the order an admin is most likely to want them. */
const STATE_LABELS: { [_ in UserState]: string } = {
	all: "Everyone",
	banned: "Banned",
	flagged: "Fraud flagged",
	suspended: "Suspended",
	unverified: "Not verified",
}

/** The directory URL for one filter, keeping the search, and the page cursor when a next page is asked for. An empty search and the "Everyone" chip both leave their parameter off. */
const directoryHref = (state: UserState, q: string | undefined, cursor?: string): string => {
	const params = new URLSearchParams()
	if (q) params.set("q", q)
	if (state !== "all") params.set("state", state)
	if (cursor) params.set("cursor", cursor)
	const query = params.toString()
	return query ? `/admin/users?${query}` : "/admin/users"
}

/**
 * The badge tone for each level.
 *
 * Only `full` gets a colour of its own. The other three are deliberately quiet: the point of the column is to find the accounts that can hand out every other permission, and a directory where every row is coloured says nothing about which one matters.
 */
const LEVEL_TONES = {
	full: "access",
	none: "muted",
	read: "muted",
	write: "muted",
} as const

export default async function AdminUsersPage({ searchParams }: Props) {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
	// The search box's value, and the page cursor, each taken as the single value the URL named: a repeated parameter arrives as an array, and an array where Prisma expects a string is a 500.
	const { q, cursor, state: stateParam } = firstValues(await searchParams)
	// An unknown state in the URL reads as "Everyone" rather than an error, the same way a mistyped cursor restarts the list.
	const state: UserState = USER_STATES.find(value => value === stateParam) ?? "all"

	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	const { items, nextCursor } = await listUsers({ cursor, limit: 50, q, state }, { includePii })

	return (
		<div className="hl-stack">
			<PageHeader compact title="Users" />

			<Panel>
				<nav aria-label="Filter by account state" className="hl-chips">
					{USER_STATES.map(value => (
						<Link
							aria-current={value === state ? "true" : undefined}
							className="hl-chip"
							href={directoryHref(value, q)}
							key={value}
						>
							{STATE_LABELS[value]}
						</Link>
					))}
				</nav>
				<form className="hl-row" method="get">
					{state === "all" ? null : <input name="state" type="hidden" value={state} />}
					<TextInput
						defaultValue={q ?? ""}
						name="q"
						placeholder={includePii ? "Search by name, email or Slack ID" : "Search by name"}
						style={{ maxWidth: "24rem" }}
					/>
					<Button type="submit">
						<IconSearch /> Search
					</Button>
					<ClipboardSearchButton path="/admin/users" />
				</form>
			</Panel>

			<Panel>
				{items.length === 0 ? (
					<EmptyState>No users match.</EmptyState>
				) : (
					<Table head={["Name", "Email", "Roles", "Access", "Verified", "Joined"]}>
						{items.map(user => {
							const summary = permissionSummary(user.roles.map(r => r.role))
							const granted = summary.permissions.map(readablePermission)
							return (
								<tr key={user.id}>
									<td>
										<Link href={`/admin/users/${user.id}`}>{displayName(user) ?? "-"}</Link>
										{user.fraudFlagged ? (
											<div>
												<Badge tone="danger">flagged</Badge>
											</div>
										) : null}
										{penaltyFor(user.bannedAt, user.suspendedUntil) === "banned" ? (
											<Badge tone="danger">banned</Badge>
										) : penaltyFor(user.bannedAt, user.suspendedUntil) === "suspended" ? (
											<Badge tone="warning">suspended</Badge>
										) : null}
									</td>
									<td>
										<CopyEmail email={user.email} />
									</td>
									<td>
										{user.roles.length === 0 ? (
											<span className="hl-hint">participant</span>
										) : (
											user.roles.map(r => (
												<Badge key={r.role} tone="muted">
													{r.role.toLowerCase()}
												</Badge>
											))
										)}
									</td>
									{/* The access level is the union of what the roles grant, so a person holding two of them is described by the two together. The list of permissions is the tooltip rather than the cell: an administrator has thirteen of them, and thirteen words down a column would bury the one line that matters. */}
									<td>
										<Badge
											title={granted.length > 0 ? `Can ${granted.join(", ")}` : "No staff permissions"}
											tone={LEVEL_TONES[summary.level]}
										>
											{PERMISSION_LEVEL_LABELS[summary.level]}
										</Badge>
										{granted.length > 0 ? (
											<div className="hl-hint">
												{granted.length} of {PERMISSION_COUNT} permissions
											</div>
										) : null}
									</td>
									<td>
										<Badge tone={user.verificationStatus === "verified" ? "success" : "warning"}>
											{user.verificationStatus ?? "unknown"}
										</Badge>
									</td>
									<td className="hl-mono">{user.createdAt.toDateString()}</td>
								</tr>
							)
						})}
					</Table>
				)}
				{nextCursor ? (
					<p>
						<Link href={directoryHref(state, q, nextCursor)}>Next page</Link>
					</p>
				) : null}
			</Panel>
		</div>
	)
}
