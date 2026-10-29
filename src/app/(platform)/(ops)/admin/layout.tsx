import Link from "next/link"
import { OpsShell } from "@/app/components/OpsShell"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const { user, roles } = await requireAnyPermissionPage(
		Permission.VIEW_USERS,
		Permission.MANAGE_SHOP,
		Permission.FULFILL_ORDERS,
		Permission.VIEW_AUDIT_LOG,
		Permission.VIEW_UPLOADS,
		Permission.MANAGE_PROGRAM,
		Permission.MANAGE_FEED,
		Permission.MANAGE_CREDIT,
	)

	return (
		<OpsShell
			email={user.email}
			nav={
				<>
					<Link href="/admin">Overview</Link>
					{hasPermission(roles, Permission.VIEW_USERS) ? (
						<>
							<Link href="/admin/users">Users</Link>
							<Link href="/admin/projects">Projects</Link>
							<Link href="/admin/referrals">Referrals</Link>
						</>
					) : null}
					{hasPermission(roles, Permission.MANAGE_CREDIT) ? <Link href="/admin/grants">Grants</Link> : null}
					{hasPermission(roles, Permission.MANAGE_SHOP) ? <Link href="/admin/shop">Shop</Link> : null}
					{hasPermission(roles, Permission.FULFILL_ORDERS) ? <Link href="/admin/fulfillment">Fulfillment</Link> : null}
					{hasPermission(roles, Permission.MANAGE_PROGRAM) ? <Link href="/admin/program">Program</Link> : null}
					{hasPermission(roles, Permission.MANAGE_PROGRAM) ? <Link href="/admin/events">Events</Link> : null}
					{hasPermission(roles, Permission.MANAGE_FEED) ? <Link href="/admin/feed">Feed</Link> : null}
					{hasPermission(roles, Permission.MANAGE_FEED) ? <Link href="/admin/reports">Reports</Link> : null}
					{hasPermission(roles, Permission.VIEW_AUDIT_LOG) ? <Link href="/admin/audit">Audit</Link> : null}
					{hasPermission(roles, Permission.VIEW_UPLOADS) ? <Link href="/admin/uploads">Uploads</Link> : null}
					<Link href="/dashboard">Dashboard</Link>
				</>
			}
			title="Half-Life admin"
		>
			{children}
		</OpsShell>
	)
}
