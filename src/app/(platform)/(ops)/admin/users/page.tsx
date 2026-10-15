import Link from "next/link"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { listUsers } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

type Props = { searchParams: Promise<{ q?: string; cursor?: string }> }

export default async function AdminUsersPage({ searchParams }: Props) {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
	const { q, cursor } = await searchParams

	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	const { items, nextCursor } = await listUsers({ q, cursor, limit: 50 }, { includePii })

	return (
		<div className="hl-stack">
			<PageHeader title="Users" />

			<Panel>
				<form className="hl-row" method="get">
					<input
						className="hl-input"
						defaultValue={q ?? ""}
						name="q"
						placeholder="Search by name, email or Slack ID"
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
					<Table head={["Name", "Email", "Roles", "Verified", "Joined"]}>
						{items.map(user => (
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
								<td>
									<Badge tone={user.verificationStatus === "verified" ? "success" : "warning"}>
										{user.verificationStatus ?? "unknown"}
									</Badge>
								</td>
								<td className="hl-mono">{user.createdAt.toDateString()}</td>
							</tr>
						))}
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
