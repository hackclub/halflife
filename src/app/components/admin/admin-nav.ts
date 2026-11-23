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
 * The key each console page answers to while Alt is held.
 *
 * Most are the page's own initial. Where two pages want the same letter the one people reach more often keeps it: Reports takes R and Referrals E from rEferrals; the rest of the clashes take the next free letter of their name (progrAm, eVents, audIt, fulfillMent, reViews). Uploads has every letter taken, so it takes the first free letter left. The chips put the key on show while Alt is held, so the odd one out is discoverable rather than memorised.
 */
export const ADMIN_HOTKEYS: { [_: string]: string } = {
	"/admin": "o",
	"/admin/audit": "i",
	"/admin/deadlines": "d",
	"/admin/events": "v",
	"/admin/feed": "f",
	"/admin/fulfillment": "m",
	"/admin/grants": "g",
	"/admin/ledger": "l",
	"/admin/program": "a",
	"/admin/projects": "p",
	"/admin/referrals": "e",
	"/admin/reports": "r",
	"/admin/shop": "s",
	"/admin/uploads": "h",
	"/admin/users": "u",
	"/reviews": "w",
}

/** The key a page answers to, or undefined for a page that has none. */
export const adminHotkey = (href: string): string | undefined => ADMIN_HOTKEYS[href]

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
