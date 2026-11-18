"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HardLink } from "@/components/site/HardLink"
import { type AdminNavGroup, isAdminNavActive } from "./admin-nav"

/**
 * The admin sections down the left of the console. Grouped, so the eye finds a page by its area rather than scanning one long row, and fixed in the column so a long page does not take the navigation away.
 */
export function AdminSidebar({ groups }: Readonly<{ groups: AdminNavGroup[] }>) {
	const pathname = usePathname()

	return (
		<nav aria-label="Admin sections" className="hl-admin-side">
			{/* On a phone the sections sit behind one disclosure, so the page is the first thing down the screen. On a desktop the list is always open and the disclosure is hidden. */}
			<details className="hl-admin-menu">
				<summary>Sections</summary>
				<div className="hl-admin-side-inner">
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
			</details>
		</nav>
	)
}
