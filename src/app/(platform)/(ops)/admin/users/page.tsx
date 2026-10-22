import Link from "next/link"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import { displayName } from "@/lib/display-name"
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
import { listUsers } from "@/lib/queries/admin"
import { firstValues, type SearchParamValue } from "@/lib/search-params"

export const dynamic = "force-dynamic"

interface Props {
	searchParams: Promise<{ cursor?: SearchParamValue; q?: SearchParamValue }>
}

/**
 * The badge tone for each level.
 *
 * Only `full` gets a colour of its own. The other three are deliberately quiet: the
 * point of the column is to find the accounts that can hand out every other
 * permission, and a directory where every row is coloured says nothing about which
 * one matters.
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
	const { q, cursor } = firstValues(await searchParams)

	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	const { items, nextCursor } = await listUsers({ cursor, limit: 50, q }, { includePii })

	return (
		<div className="hl-stack">
			<PageHeader title="Users" />

			<Panel>
				<form className="hl-row" method="get">
					<input
						className="hl-input"
						defaultValue={q ?? ""}
						name="q"
						placeholder={includePii ? "Search by name, email or Slack ID" : "Search by name"}
						style={{ maxWidth: "24rem" }}
					/>
					<button className="hl-btn" type="submit">
						Search
					</button>
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
										<Link href={`/admin/users/${user.id}`}>{displayName(user) ?? "—"}</Link>
										{user.fraudFlagged ? (
											<div>
												<Badge tone="danger">flagged</Badge>
											</div>
										) : null}
									</td>
									<td className="hl-mono">{user.email}</td>
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
						<Link href={`/admin/users?${q ? `q=${q}&` : ""}cursor=${nextCursor}`}>Next page</Link>
					</p>
				) : null}
			</Panel>
		</div>
	)
}
