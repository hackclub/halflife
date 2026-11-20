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

/** The fields of a directory user the palette needs to recognise one by their email or Slack ID. */
export interface PaletteUser {
	email: string
	id: string
	name: string | null
	slackId: string | null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Slack IDs start with U (users) or W (enterprise users), then uppercase letters and digits.
const SLACK_ID = /^[UW][A-Z0-9]{6,}$/

/** Whether a query is shaped like an email address or a Slack ID, so it can name one person outright. */
export const isUserIdentifier = (query: string): boolean => {
	const trimmed = query.trim()
	return EMAIL.test(trimmed) || SLACK_ID.test(trimmed.toUpperCase())
}

/** The one user a query names by email (any case) or Slack ID (any case), from the users the directory returned. */
export const exactUser = (query: string, users: PaletteUser[]): PaletteUser | undefined => {
	if (!isUserIdentifier(query)) return undefined
	const trimmed = query.trim()
	const email = trimmed.toLowerCase()
	const slackId = trimmed.toUpperCase()
	return users.find(user => user.email.toLowerCase() === email || user.slackId === slackId)
}

/**
 * The rows the palette shows for a query. Pages match on their label or heading; a query of two or more characters also adds a search row that opens the users directory with that query, when this person can reach the directory at all. When the query names one user outright, their profile is the top row.
 */
export const paletteEntries = (groups: AdminNavGroup[], query: string, person?: PaletteUser): AdminPaletteEntry[] => {
	const trimmed = query.trim()
	const term = trimmed.toLowerCase()
	const pages = groups
		.flatMap(group => group.items.map(item => ({ ...item, group: group.label })))
		.filter(entry => term === "" || `${entry.label} ${entry.group}`.toLowerCase().includes(term))
	const hasUsers = groups.some(group => group.items.some(item => item.href === "/admin/users"))
	if (!hasUsers) return pages
	const profile: AdminPaletteEntry[] = person
		? [
				{
					group: "User",
					href: `/admin/users/${person.id}`,
					label: `Open ${person.name ?? person.email}`,
				},
			]
		: []
	if (trimmed.length < 2) return [...profile, ...pages]
	return [
		...profile,
		...pages,
		{
			group: "Search",
			href: `/admin/users?q=${encodeURIComponent(trimmed)}`,
			label: `Find users matching "${trimmed}"`,
		},
	]
}
