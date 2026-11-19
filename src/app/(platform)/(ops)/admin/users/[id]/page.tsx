import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { type TimelineEvent, UserTimeline } from "@/app/components/admin/UserTimeline"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { CreditGrantForm } from "@/app/components/forms/CreditGrantForm"
import { EmailForm } from "@/app/components/forms/EmailForm"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { PenaltyCard } from "@/app/components/forms/PenaltyCard"
import { RoleEditor } from "@/app/components/forms/RoleEditor"
import { Badge, EmptyState, PageHeader, Panel, Stat, statusLabel, Table } from "@/app/components/ui"
import { CREDIT_NAME_PLURAL, scheduleForWeek, TOTAL_WEEKS, themeLabel } from "@/lib/config/program"
import { projectTierId } from "@/lib/config/tiers"
import { formatUtcDateTime } from "@/lib/deadline"
import { displayName } from "@/lib/display-name"
import { PayoutSource, Phase, PhaseStatus } from "@/lib/enums"
import { isIdentityVerified } from "@/lib/hca-profile"
import { isHcbConfigured } from "@/lib/hcb"
import { penaltyFor } from "@/lib/moderation"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, hasRole, Permission, permissionSummary, Role, readablePermission } from "@/lib/permissions"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import { getProgramSettings, isPhaseDecided } from "@/lib/program"
import { getUserDetail } from "@/lib/queries/admin"
import { parseDbTimestamp } from "@/lib/time"
import { ThemedProjectRow } from "./ThemedProjectRow"
import { WeekExtensionForm } from "./WeekExtensionForm"

export const metadata: Metadata = {
	title: "User",
}

export const dynamic = "force-dynamic"

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
	const settings = await getProgramSettings()
	// Airtable is the old payer; under HCB a manual top-up would be a second way to pay the same project.
	const canSendGrant =
		canManageCredit && isHcbConfigured() && identityVerified && settings.payoutSource === PayoutSource.AIRTABLE
	// Banning and suspending are the ADMIN seat specifically: the same blast radius as reversing a role grant, reached through the same panel.
	const isAdmin = hasRole(roles, Role.ADMIN)
	const penalties = isAdmin
		? await db.orm.public.User.whereUnique({ id })
				.select("bannedAt", "bannedById", "banReason", "suspendedById", "suspendedUntil", "suspensionReason")
				.first()
		: null
	// How much of the ban's own hide is still on record, so unban can offer restore. Two counts, taken when only admins reach this branch and rarely: a member with penalties.
	const rollbackContentHidden = isAdmin
		? (
				await Promise.all([
					db.orm.public.Post.where({ userId: id })
						.where(post => post.hiddenByBanAt.isNotNull())
						.aggregate(a => ({ count: a.count() })),
					db.orm.public.PostComment.where({ userId: id })
						.where(comment => comment.hiddenByBanAt.isNotNull())
						.aggregate(a => ({ count: a.count() })),
				])
			).some(r => r.count > 0)
		: false
	// Which penalty is on right now. An expired suspension still has its end timestamp on the row, so the timestamps alone cannot decide whether to show a badge.
	const penalty = penalties ? penaltyFor(penalties.bannedAt, penalties.suspendedUntil) : "none"

	const weekExtensionByWeek = new Map(user.weekExtensions.map(extension => [extension.week, extension]))
	const now = new Date()
	const weekExtensionOptions = Array.from({ length: TOTAL_WEEKS }, (_, index) => {
		const week = index + 1
		const slot = scheduleForWeek(week)
		const extension = weekExtensionByWeek.get(week)
		const state = extension ? (extension.submissionExtensionUntil > now ? " · extended" : " · expired") : ""
		const label = slot
			? `Week ${week} – ${themeLabel(slot.theme.id)} ${slot.phase === Phase.DESIGN ? "design" : "build"}`
			: `Week ${week}`
		return {
			current: extension?.submissionExtensionUntil.toISOString() ?? null,
			label: `${label}${state}`,
			week,
		}
	})

	// Everything the account has that carries a date, in one list: when it joined, what roles it was given, its printer milestones, and every ledger movement.
	const timeline: TimelineEvent[] = [
		{ at: user.createdAt, title: "Joined the programme" },
		...user.roles.map(role => ({
			at: new Date(role.grantedAt),
			detail: role.grantedBy ? "Granted by a staff account" : undefined,
			title: `Given the ${role.role.toLowerCase()} role`,
		})),
		...(user.printerAward
			? [
					{ at: user.printerAward.qualifiedAt, title: "Qualified for a printer" },
					...(user.printerAward.shippedAt ? [{ at: user.printerAward.shippedAt, title: "Printer shipped" }] : []),
					...(user.printerAward.deliveredAt ? [{ at: user.printerAward.deliveredAt, title: "Printer delivered" }] : []),
					...(user.printerAward.revokedAt
						? [
								{
									at: user.printerAward.revokedAt,
									detail: user.printerAward.revokedReason ?? undefined,
									title: "Printer award revoked",
								},
							]
						: []),
				]
			: []),
		...ledger.map(entry => ({
			at: entry.createdAt,
			detail: entry.note ?? undefined,
			title: `${entry.kind.toLowerCase().replaceAll("_", " ")} ${entry.amount > 0 ? `+${entry.amount}` : entry.amount}`,
		})),
	]

	return (
		<div className="hl-stack">
			<PageHeader
				actions={user.fraudFlagged ? <Badge tone="danger">flagged</Badge> : null}
				compact
				subtitle={user.email}
				title={displayName(user, user.email)}
			/>

			{/* The nickname is what every surface shows; this is the one place staff need the whole name, because the payout and shipping rows split it. */}
			{user.name && user.name !== displayName(user) ? <p className="hl-hint">Full name on file: {user.name}</p> : null}

			<div className="hl-row">
				<Stat label={`${CREDIT_NAME_PLURAL} to spend`} value={balances.spendable} />
				<Stat label="Printer fund" value={balances.banked} />
				<Stat label="Projects shipped" value={`${printer.shippedCount} / ${printer.required}`} />
				<Stat
					label="Verified"
					value={<span style={{ fontSize: "1.1rem" }}>{statusLabel(user.verificationStatus ?? "unverified")}</span>}
				/>
			</div>

			<nav aria-label="Jump to a section" className="hl-jump">
				<a href="#history">History</a>
				<a href="#account">Email</a>
				<a href="#moderation">Moderation</a>
				<a href="#projects">Projects</a>
				<a href="#ledger">Ledger</a>
				<a href="#orders">Orders</a>
			</nav>

			<Panel id="history" title="History">
				{timeline.length === 0 ? <EmptyState>Nothing recorded yet.</EmptyState> : <UserTimeline events={timeline} />}
			</Panel>

			{canManageUsers ? (
				<Panel id="account" title="Email">
					<EmailForm current={user.email} url={`/api/admin/users/${id}`} />
				</Panel>
			) : null}

			{canManageUsers ? (
				<Panel id="moderation" title="Moderation">
					<div className="hl-row">
						<ActionButton
							body={{ fraudFlagged: !user.fraudFlagged }}
							confirm={
								user.fraudFlagged ? "Let this account submit again?" : "Flagging blocks all submissions. Continue?"
							}
							label={user.fraudFlagged ? "Clear the flag" : "Flag this account"}
							method="PATCH"
							tone={user.fraudFlagged ? "default" : "danger"}
							url={`/api/admin/users/${id}`}
							variant="default"
						/>
					</div>
				</Panel>
			) : null}

			{canManageUsers ? (
				<Panel title="Extension">
					<p className="hl-hint" style={{ marginTop: 0 }}>
						Covers every project they own: passed weeks take journal entries again, and work can be submitted past a
						global close. For one project only, use its row below; for one week, including a week with no project yet,
						use the week extension below.
					</p>
					<ExtensionForm
						current={user.submissionExtensionUntil?.toISOString() ?? null}
						url={`/api/admin/users/${id}`}
					/>
				</Panel>
			) : null}

			{canManageUsers ? (
				<Panel title="Week extension">
					<p className="hl-hint" style={{ marginTop: 0 }}>
						Give one week more time, including a week they have not started and so have no project row for. The
						extension stays on the week and covers its project once they begin it.
					</p>
					<WeekExtensionForm options={weekExtensionOptions} urlPrefix={`/api/admin/users/${id}/weeks`} />
				</Panel>
			) : null}

			{isAdmin && penalties ? (
				<Panel title="Penalties">
					{penalty === "none" ? null : (
						<div className="hl-row">
							<Badge tone={penalty === "banned" ? "danger" : "warning"}>{penalty}</Badge>
						</div>
					)}
					<PenaltyCard
						banned={penalties.bannedAt !== null}
						bannedAt={penalties.bannedAt ? parseDbTimestamp(penalties.bannedAt).toISOString() : null}
						banReason={penalties.banReason}
						rollbackContentHidden={rollbackContentHidden}
						suspended={penalty === "suspended"}
						suspendedUntil={penalties.suspendedUntil ? parseDbTimestamp(penalties.suspendedUntil).toISOString() : null}
						suspensionReason={penalties.suspensionReason}
						url={`/api/admin/users/${id}/penalties`}
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

			<Panel id="projects" title="Themed projects" wide>
				{canManageCredit && isHcbConfigured() && (
					<p className="hl-hint" style={{ marginTop: 0 }}>
						{settings.payoutSource === PayoutSource.HCB
							? "HCB card grants are issued in bulk from the Grant cards page. A project shows its card grant here once it has been issued."
							: identityVerified
								? "Sending a grant tops up the maker's HCB card grant directly. It is the old payout fallback and can only be sent once per project."
								: "Grants are locked until this maker verifies their identity at auth.hackclub.com."}
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
							canEditHours={canOverride}
							canExtend={canManageUsers}
							canMoveTheme={canMoveTheme}
							canOverride={canOverride}
							canSendGrant={canSendGrant}
							data={{
								approvedHours: project.approvedHours,
								buildStatus: project.buildStatus,
								cardGrantSent: project.hcbGrantCards.some(card => card.status === "ISSUED"),
								designStatus: project.designStatus,
								extension: project.submissionExtensionUntil?.toISOString() ?? null,
								grantSent: project.hcbGrantTopUps.length > 0,
								// A grant is decided with the design, so one on an undecided project is an artefact of an import rather than money owed.
								grantUsd: project.designStatus === PhaseStatus.approved ? project.grantUsd : null,
								id: project.id,
								journal: project.workSessions.map(session => {
									const status = statusFor(project, session.phase)
									return {
										decided: isPhaseDecided(status),
										effectiveDate: session.effectiveDate,
										hoursApproved: session.hoursApproved,
										hoursClaimed: session.hoursClaimed,
										id: session.id,
										locked: status === PhaseStatus.in_review,
										phase: session.phase,
										title: session.title,
									}
								}),
								starterProjectId: project.starterProjectId,
								theme: project.theme,
								themeLabel: themeLabel(project.theme),
								tier: projectTierId(project),
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

			<Panel id="ledger" title="Ledger">
				{ledger.length === 0 ? (
					<EmptyState>No entries.</EmptyState>
				) : (
					<Table head={["When", "Kind", "Note", "Amount", "Balance"]}>
						{ledger.map(entry => (
							<tr key={entry.id}>
								<td className="hl-mono">{formatUtcDateTime(entry.createdAt)}</td>
								<td className="hl-mono">{entry.kind}</td>
								<td>{entry.note ?? "-"}</td>
								<td className="hl-mono">{entry.amount > 0 ? `+${entry.amount}` : entry.amount}</td>
								<td className="hl-mono">{entry.balanceAfter}</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>

			<Panel id="orders" title="Orders">
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
