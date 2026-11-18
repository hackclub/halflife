/** One place the admin console can go: a page inside the app, or a page on another part of the site that needs a full load. */
export interface AdminNavItem {
	/** Leave the client router for this one, as a plain link does. */
	hard?: boolean
	href: string
	label: string
}

/** A heading in the sidebar and the palette, with the pages that sit under it. */
export interface AdminNavGroup {
	items: AdminNavItem[]
	label: string
}

/** Whether a path is inside a nav item: `/admin` only ever matches itself, every other item also matches what sits below it. */
export const isAdminNavActive = (pathname: string, href: string): boolean => {
	if (href === "/admin") return pathname === "/admin"
	return pathname === href || pathname.startsWith(`${href}/`)
}
