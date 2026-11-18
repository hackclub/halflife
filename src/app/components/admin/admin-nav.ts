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

/** A row in the command palette: a nav item, with the heading it sits under. */
export interface AdminPaletteEntry extends AdminNavItem {
	group: string
}

/** Whether a path is inside a nav item: `/admin` only ever matches itself, every other item also matches what sits below it. */
export const isAdminNavActive = (pathname: string, href: string): boolean => {
	if (href === "/admin") return pathname === "/admin"
	return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The rows the palette shows for a query. Pages match on their label or heading; a query of two or more characters also adds a search row that opens the users directory with that query, when this person can reach the directory at all.
 */
export const paletteEntries = (groups: AdminNavGroup[], query: string): AdminPaletteEntry[] => {
	const trimmed = query.trim()
	const term = trimmed.toLowerCase()
	const pages = groups
		.flatMap(group => group.items.map(item => ({ ...item, group: group.label })))
		.filter(entry => term === "" || `${entry.label} ${entry.group}`.toLowerCase().includes(term))
	const hasUsers = groups.some(group => group.items.some(item => item.href === "/admin/users"))
	if (trimmed.length < 2 || !hasUsers) return pages
	return [
		...pages,
		{
			group: "Search",
			href: `/admin/users?q=${encodeURIComponent(trimmed)}`,
			label: `Find users matching "${trimmed}"`,
		},
	]
}
