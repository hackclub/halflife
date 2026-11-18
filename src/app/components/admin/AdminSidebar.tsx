"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { HardLink } from "@/components/site/HardLink"
import { type AdminNavGroup, isAdminNavActive } from "./admin-nav"

/**
 * The admin sections down the left of the console. Grouped, so the eye finds a page by its area rather than scanning one long row, and fixed in the column so a long page does not take the navigation away.
 *
 * On a phone the list sits behind one "Sections" button and closes again once a page is chosen. On a desktop the list is always shown, and the button is hidden.
 */
export function AdminSidebar({ groups }: Readonly<{ groups: AdminNavGroup[] }>) {
	const pathname = usePathname()
	// The list is open for the page it was opened on, so choosing another page folds it away again without an effect.
	const [openPath, setOpenPath] = useState<string | null>(null)
	const open = openPath === pathname

	return (
		<nav aria-label="Admin sections" className="hl-admin-side">
			<button
				aria-controls="admin-sections"
				aria-expanded={open}
				className="hl-admin-menu-toggle"
				onClick={() => setOpenPath(open ? null : pathname)}
				type="button"
			>
				Sections
			</button>
			<div className="hl-admin-side-inner" data-open={open ? "true" : "false"} id="admin-sections">
				{groups.map(group => (
					<div className="hl-admin-group" key={group.label}>
						<div className="hl-admin-group-label">{group.label}</div>
						{group.items.map(item => {
							const active = isAdminNavActive(pathname, item.href)
							if (item.hard)
								return (
									<HardLink href={item.href} key={item.href}>
										{item.label}
									</HardLink>
								)
							return (
								<Link
									aria-current={active ? "page" : undefined}
									className="hl-admin-link"
									href={item.href}
									key={item.href}
								>
									{item.label}
								</Link>
							)
						})}
					</div>
				))}
			</div>
		</nav>
	)
}
