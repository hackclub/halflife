import Link from "next/link"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, roles } = await requireAnyPermissionPage(
    Permission.VIEW_USERS,
    Permission.MANAGE_SHOP,
    Permission.FULFILL_ORDERS,
    Permission.VIEW_AUDIT_LOG,
    Permission.MANAGE_PROGRAM,
    Permission.MANAGE_FEED,
  )

  return (
    <>
      <nav className="hl-nav">
        <strong>Half-Life admin</strong>
        <Link href="/admin">Overview</Link>
        {hasPermission(roles, Permission.VIEW_USERS) ? (
          <>
            <Link href="/admin/users">Users</Link>
            <Link href="/admin/projects">Projects</Link>
          </>
        ) : null}
        {hasPermission(roles, Permission.MANAGE_SHOP) ? <Link href="/admin/shop">Shop</Link> : null}
        {hasPermission(roles, Permission.FULFILL_ORDERS) ? <Link href="/admin/fulfillment">Fulfillment</Link> : null}
        {hasPermission(roles, Permission.MANAGE_PROGRAM) ? <Link href="/admin/program">Program</Link> : null}
        {hasPermission(roles, Permission.MANAGE_FEED) ? <Link href="/admin/feed">Feed</Link> : null}
        {hasPermission(roles, Permission.VIEW_AUDIT_LOG) ? <Link href="/admin/audit">Audit</Link> : null}
        <Link href="/dashboard">Dashboard</Link>
        <span className="hl-muted" style={{ marginLeft: "auto" }}>
          {user.email}
        </span>
      </nav>
      <main className="hl-shell">{children}</main>
    </>
  )
}
