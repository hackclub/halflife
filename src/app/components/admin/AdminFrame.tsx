import type { ReactNode } from "react"
import { AdminPalette } from "./AdminPalette"
import { AdminSidebar } from "./AdminSidebar"
import type { AdminNavGroup } from "./admin-nav"

/**
 * The admin console's frame: a slim header with search and the signed-in address, a sidebar of grouped sections, and the page filling the rest of the window. The page gets the full width of the window rather than the reading column the rest of the ops console uses, because its tables are the widest things on the site.
 */
export function AdminFrame({
	children,
	email,
	groups,
}: Readonly<{ children: ReactNode; email: string; groups: AdminNavGroup[] }>) {
	return (
		<div className="hl-admin">
			<header className="hl-admin-top">
				<strong className="hl-admin-brand">Half-Life admin</strong>
				<AdminPalette groups={groups} />
				<span className="hl-muted hl-admin-email">{email}</span>
			</header>
			<div className="hl-admin-body">
				<AdminSidebar groups={groups} />
				<main className="hl-admin-main">{children}</main>
			</div>
		</div>
	)
}
