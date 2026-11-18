import { AdminFrame } from "@/app/components/admin/AdminFrame"
import type { AdminNavGroup, AdminNavItem } from "@/app/components/admin/admin-nav"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

/** The items when this person may open them, and none otherwise, so a section keeps only the pages they can reach. */
const pages = (allowed: boolean, items: AdminNavItem[]): AdminNavItem[] => (allowed ? items : [])

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

	const can = (permission: Permission): boolean => hasPermission(roles, permission)

	// A section with no pages left is dropped, so the sidebar never shows a heading over nothing.
	const groups: AdminNavGroup[] = [
		{
			items: [
				{ href: "/admin", label: "Overview" },
				{ href: "/dashboard", label: "My dashboard" },
			],
			label: "Overview",
		},
		{
			items: [
				...pages(can(Permission.VIEW_USERS), [
					{ href: "/admin/users", label: "Users" },
					{ href: "/admin/projects", label: "Projects" },
					{ href: "/admin/referrals", label: "Referrals" },
				]),
			],
			label: "People",
		},
		{
			items: [
				...pages(can(Permission.MANAGE_FEED), [
					{ href: "/admin/reports", label: "Reports" },
					{ href: "/admin/feed", label: "Feed" },
				]),
			],
			label: "Moderation",
		},
		{
			items: [
				...pages(can(Permission.MANAGE_CREDIT), [
					{ href: "/admin/grants", label: "Grants" },
					{ href: "/admin/ledger", label: "Ledger" },
				]),
				...pages(can(Permission.MANAGE_SHOP), [{ href: "/admin/shop", label: "Shop" }]),
				...pages(can(Permission.FULFILL_ORDERS), [{ href: "/admin/fulfillment", label: "Fulfillment" }]),
			],
			label: "Money",
		},
		{
			items: [
				...pages(can(Permission.MANAGE_PROGRAM), [
					{ href: "/admin/program", label: "Program" },
					{ href: "/admin/events", label: "Events" },
				]),
				...pages(can(Permission.VIEW_USERS), [{ href: "/admin/deadlines", label: "Deadlines" }]),
			],
			label: "Programme",
		},
		{
			items: [
				...pages(can(Permission.VIEW_AUDIT_LOG), [{ href: "/admin/audit", label: "Audit" }]),
				...pages(can(Permission.VIEW_UPLOADS), [{ href: "/admin/uploads", label: "Uploads" }]),
				...pages(can(Permission.REVIEW_SUBMISSIONS), [{ hard: true, href: "/reviews", label: "Reviews" }]),
			],
			label: "System",
		},
	].filter(group => group.items.length > 0)

	return (
		<AdminFrame email={user.email} groups={groups}>
			{children}
		</AdminFrame>
	)
}
