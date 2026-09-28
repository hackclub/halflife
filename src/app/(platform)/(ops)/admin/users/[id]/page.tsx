import { notFound } from "next/navigation"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { CreditGrantForm } from "@/app/components/forms/CreditGrantForm"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { GrantForm } from "@/app/components/forms/GrantForm"
import { RoleEditor } from "@/app/components/forms/RoleEditor"
import { Badge, EmptyState, PageHeader, Panel, Stat, statusLabel, statusTone, Table } from "@/app/components/ui"
import { CREDIT_NAME_PLURAL, getThemeDef } from "@/lib/config/program"
import { isHcbConfigured } from "@/lib/hcb"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"
import { getUserDetail } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }

export default async function AdminUserPage({ params }: Props) {
  const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
  const { id } = await params

  const detail = await getUserDetail(id)
  if (!detail) notFound()

  const { user, balances, ledger, orders, printer } = detail
  const canManageRoles = hasPermission(roles, Permission.MANAGE_ROLES)
  const canManageCredit = hasPermission(roles, Permission.MANAGE_CREDIT)
  const canManageUsers = hasPermission(roles, Permission.MANAGE_USERS)
  const canOverride = hasPermission(roles, Permission.OVERRIDE_DECISIONS)
  const canSendGrant = canManageCredit && isHcbConfigured()

  return (
    <div className="hl-stack">
      <PageHeader
        title={user.name ?? user.email}
        subtitle={user.email}
        actions={user.fraudFlagged ? <Badge tone="danger">flagged</Badge> : null}
      />

      <div className="hl-row">
        <Stat label={`${CREDIT_NAME_PLURAL} to spend`} value={balances.spendable} />
        <Stat label="Printer fund" value={balances.banked} />
        <Stat label="Themes shipped" value={`${printer.shippedCount} / ${printer.required}`} />
        <Stat label="Verified" value={user.verificationStatus ?? "unknown"} />
      </div>

      {canManageUsers ? (
        <Panel title="Moderation">
          <div className="hl-row">
            <ActionButton
              url={`/api/admin/users/${id}`}
              method="PATCH"
              body={{ fraudFlagged: !user.fraudFlagged }}
              label={user.fraudFlagged ? "Clear the flag" : "Flag this account"}
              variant={user.fraudFlagged ? "default" : "danger"}
              confirm={
                user.fraudFlagged ? "Let this account submit again?" : "Flagging blocks all submissions. Continue?"
              }
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
            url={`/api/admin/users/${id}`}
            current={user.submissionExtensionUntil?.toISOString() ?? null}
          />
        </Panel>
      ) : null}

      {canManageRoles ? (
        <Panel title="Roles">
          <RoleEditor userId={id} current={user.roles.map((r) => r.role)} />
        </Panel>
      ) : null}

      <Panel title="Themed projects">
        {canSendGrant && (
          <p className="hl-hint" style={{ marginTop: 0 }}>
            Sending a grant tops up the maker&apos;s HCB card grant directly. It is a manual fallback — the payout
            pipeline is the normal path — and can only be sent once per project.
          </p>
        )}
        <Table
          head={[
            "Theme",
            "Design",
            "Build",
            "Tier",
            "Grant",
            "Hours",
            canSendGrant ? "Send grant" : null,
            canManageUsers ? "Extension" : null,
            canOverride ? "" : null,
          ].filter(Boolean)}
        >
          {user.themeProjects.map((project) => (
            <tr key={project.id} id={`project-${project.id}`}>
              <td>
                {getThemeDef(project.theme).label}
                <div className="hl-hint">{project.title}</div>
              </td>
              <td>
                <Badge tone={statusTone(project.designStatus)}>{statusLabel(project.designStatus)}</Badge>
              </td>
              <td>
                <Badge tone={statusTone(project.buildStatus)}>{statusLabel(project.buildStatus)}</Badge>
              </td>
              <td>{project.tier ?? "—"}</td>
              <td>{project.grantUsd !== null ? `$${project.grantUsd}` : "—"}</td>
              <td className="hl-mono">{project.approvedHours ?? "—"}</td>
              {canSendGrant ? (
                <td style={{ minWidth: "14rem" }}>
                  {project.designStatus === "approved" && project.grantUsd ? (
                    <GrantForm
                      projectId={project.id}
                      amountUsd={project.grantUsd}
                      alreadySent={project.hcbGrantTopUps.length > 0}
                    />
                  ) : (
                    <span className="hl-hint">—</span>
                  )}
                </td>
              ) : null}
              {canManageUsers ? (
                <td style={{ minWidth: "18rem" }}>
                  <ExtensionForm
                    url={`/api/admin/theme-projects/${project.id}`}
                    current={project.submissionExtensionUntil?.toISOString() ?? null}
                  />
                </td>
              ) : null}
              {canOverride ? (
                <td>
                  {project.designStatus === "approved" ? (
                    <ActionButton
                      url={`/api/admin/theme-projects/${project.id}/override`}
                      body={{
                        action: "unapprove",
                        phase: "DESIGN",
                        reason: "Un-approved by an admin",
                      }}
                      label="Un-approve design"
                      confirm="Un-approve the design? This clears the tier and grant."
                    />
                  ) : null}
                  {project.buildStatus === "approved" ? (
                    <ActionButton
                      url={`/api/admin/theme-projects/${project.id}/override`}
                      body={{
                        action: "unapprove",
                        phase: "BUILD",
                        reason: "Un-approved by an admin",
                      }}
                      label="Un-approve build"
                      confirm={`Un-approve the build? This reconciles their ${CREDIT_NAME_PLURAL} back down.`}
                    />
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </Table>
      </Panel>

      {canManageCredit ? (
        <Panel title="Adjust credit">
          <CreditGrantForm userId={id} />
        </Panel>
      ) : null}

      <Panel title="Ledger">
        {ledger.length === 0 ? (
          <EmptyState>No entries.</EmptyState>
        ) : (
          <Table head={["When", "Kind", "Note", "Amount", "Balance"]}>
            {ledger.map((entry) => (
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
            {orders.map((order) => (
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
