import { notFound } from "next/navigation"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { CreditGrantForm } from "@/app/components/forms/CreditGrantForm"
import { EmailForm } from "@/app/components/forms/EmailForm"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { RoleEditor } from "@/app/components/forms/RoleEditor"
import { Badge, EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { CREDIT_NAME_PLURAL, getThemeDef } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import { isIdentityVerified } from "@/lib/hca-profile"
import { isHcbConfigured } from "@/lib/hcb"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, hasRole, Permission, permissionSummary, Role, readablePermission } from "@/lib/permissions"
import { getUserDetail } from "@/lib/queries/admin"
import { ThemedProjectRow } from "./ThemedProjectRow"

interface Props {
	params: Promise<{ id: string }>
}

export default async function AdminUserPage({ params }: Props) {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
	const { id } = await params
	const canManageCredit = hasPermission(roles, Permission.MANAGE_CREDIT)
	// Fresh from HCA, not the status stored at the last sign-in: a maker who verified since then must not be shown a locked payout, and the routes check the same answer. Only asked when this page can issue something, because it may call HCA.
	const identityVerified = canManageCredit ? await isIdentityVerified(id) : false

	const detail = await getUserDetail(id, {
		includeSensitive: hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR),
	})
	if (!detail) notFound()

	const { user, balances, ledger, orders, printer } = detail
	const summary = permissionSummary(user.roles.map(r => r.role))
	const canManageRoles = hasPermission(roles, Permission.MANAGE_ROLES)
	const canManageUsers = hasPermission(roles, Permission.MANAGE_USERS)
	const canOverride = hasPermission(roles, Permission.OVERRIDE_DECISIONS)
	const canMoveTheme = hasPermission(roles, Permission.MANAGE_PROGRAM)
	const canSendGrant = canManageCredit && isHcbConfigured() && identityVerified

	return (
		<div className="hl-stack">
			<PageHeader
				actions={user.fraudFlagged ? <Badge tone="danger">flagged</Badge> : null}
				subtitle={user.email}
				title={displayName(user, user.email)}
			/>

			{/* The nickname is what every surface shows; this is the one place staff
				need the whole name, because the payout and shipping rows split it. */}
			{user.name && user.name !== displayName(user) ? <p className="hl-hint">Full name on file: {user.name}</p> : null}

			<div className="hl-row">
				<Stat label={`${CREDIT_NAME_PLURAL} to spend`} value={balances.spendable} />
				<Stat label="Printer fund" value={balances.banked} />
				<Stat label="Themes shipped" value={`${printer.shippedCount} / ${printer.required}`} />
				<Stat label="Verified" value={user.verificationStatus ?? "unknown"} />
			</div>

			{canManageUsers ? (
				<Panel title="Email">
					<EmailForm current={user.email} url={`/api/admin/users/${id}`} />
				</Panel>
			) : null}

			{canManageUsers ? (
				<Panel title="Moderation">
					<div className="hl-row">
						<ActionButton
							body={{ fraudFlagged: !user.fraudFlagged }}
							confirm={
								user.fraudFlagged ? "Let this account submit again?" : "Flagging blocks all submissions. Continue?"
							}
							label={user.fraudFlagged ? "Clear the flag" : "Flag this account"}
							method="PATCH"
							url={`/api/admin/users/${id}`}
							variant={user.fraudFlagged ? "default" : "danger"}
						/>
					</div>
				</Panel>
			) : null}

			{canManageUsers ? (
				<Panel title="Extension">
					<p className="hl-hint" style={{ marginTop: 0 }}>
						Covers every project they own: passed weeks take journal entries again, and work can be submitted past a
						global close. For one project only, use its row below.
					</p>
					<ExtensionForm
						current={user.submissionExtensionUntil?.toISOString() ?? null}
						url={`/api/admin/users/${id}`}
					/>
				</Panel>
			) : null}

			{canManageRoles ? (
				<Panel title="Roles">
					<RoleEditor current={user.roles.map(r => r.role)} userId={id} />
				</Panel>
			) : null}

			{/* What the roles above actually amount to, which is the question a person granting one is really asking. A seat is a name; the level is the reach. */}
			<Panel title="Access">
				<p className="hl-hint" style={{ marginTop: 0 }}>
					{summary.permissions.length > 0
						? `Can ${summary.permissions.map(readablePermission).join(", ")}.`
						: "Holds no staff permissions, so this account cannot reach the staff console."}
				</p>
			</Panel>

			<Panel title="Themed projects" wide>
				{canManageCredit && isHcbConfigured() && (
					<p className="hl-hint" style={{ marginTop: 0 }}>
						{identityVerified
							? "Sending a grant tops up the maker's HCB card grant directly. It is a manual fallback – the payout pipeline is the normal path – and can only be sent once per project."
							: "Grants are locked until this maker verifies their identity at identity.hackclub.com."}
					</p>
				)}
				<Table
					className="hl-table--roomy"
					head={[
						"Project",
						"Review",
						"Tier",
						"Grant",
						"Hours",
						canSendGrant || canMoveTheme || canManageUsers || canOverride ? "Actions" : null,
					].filter(Boolean)}
				>
					{user.themeProjects.map(project => (
						<ThemedProjectRow
							canExtend={canManageUsers}
							canMoveTheme={canMoveTheme}
							canOverride={canOverride}
							canSendGrant={canSendGrant}
							data={{
								approvedHours: project.approvedHours,
								buildStatus: project.buildStatus,
								designStatus: project.designStatus,
								extension: project.submissionExtensionUntil?.toISOString() ?? null,
								grantSent: project.hcbGrantTopUps.length > 0,
								grantUsd: project.grantUsd,
								id: project.id,
								theme: project.theme,
								themeLabel: getThemeDef(project.theme).label,
								tier: project.tier,
								title: project.title,
							}}
							key={project.id}
						/>
					))}
				</Table>
			</Panel>

			{canManageCredit ? (
				<Panel title="Adjust credit">
					<CreditGrantForm canGrant={identityVerified} userId={id} />
				</Panel>
			) : null}

			<Panel title="Ledger">
				{ledger.length === 0 ? (
					<EmptyState>No entries.</EmptyState>
				) : (
					<Table head={["When", "Kind", "Note", "Amount", "Balance"]}>
						{ledger.map(entry => (
							<tr key={entry.id}>
								<td className="hl-mono">{entry.createdAt.toLocaleString()}</td>
								<td className="hl-mono">{entry.kind}</td>
								<td>{entry.note ?? "—"}</td>
								<td className="hl-mono">{entry.amount > 0 ? `+${entry.amount}` : entry.amount}</td>
								<td className="hl-mono">{entry.balanceAfter}</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>

			<Panel title="Orders">
				{orders.length === 0 ? (
					<EmptyState>No orders.</EmptyState>
				) : (
					<Table head={["#", "Item", "Cost", "Status"]}>
						{orders.map(order => (
							<tr key={order.id}>
								<td className="hl-mono">{order.orderNumber}</td>
								<td>{order.itemNameSnapshot}</td>
								<td>{order.totalCredits}</td>
								<td>{order.status.toLowerCase()}</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>
		</div>
	)
}

export const dynamic = "force-dynamic"
