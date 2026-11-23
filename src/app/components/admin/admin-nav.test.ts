import { describe, expect, test } from "bun:test"
import {
	ADMIN_HOTKEYS,
	type AdminNavGroup,
	exactUser,
	isAdminNavActive,
	isUserIdentifier,
	type PaletteUser,
	paletteEntries,
} from "./admin-nav"

const groups: AdminNavGroup[] = [
	{
		items: [
			{ href: "/admin/users", label: "Users" },
			{ href: "/admin/projects", label: "Projects" },
		],
		label: "People",
	},
	{ items: [{ href: "/admin/deadlines", label: "Deadlines" }], label: "Programme" },
]

describe("admin hotkeys", () => {
	test("every page answers to one lowercase letter, and no two pages agree", () => {
		const keys = Object.values(ADMIN_HOTKEYS)
		expect(new Set(keys).size).toBe(keys.length)
		for (const key of keys) expect(key).toMatch(/^[a-z]$/)
	})

	test("only console pages carry one", () => {
		for (const href of Object.keys(ADMIN_HOTKEYS))
			expect(href === "/reviews" || href === "/admin" || href.startsWith("/admin/")).toBe(true)
	})

	test("the sidebar's own pages are on the map", () => {
		for (const group of groups) for (const item of group.items) expect(ADMIN_HOTKEYS[item.href]).toBeDefined()
	})
})

describe("isAdminNavActive", () => {
	test("the overview matches only itself", () => {
		expect(isAdminNavActive("/admin", "/admin")).toBe(true)
		expect(isAdminNavActive("/admin/users", "/admin")).toBe(false)
	})

	test("a section matches the pages under it", () => {
		expect(isAdminNavActive("/admin/users/abc", "/admin/users")).toBe(true)
		expect(isAdminNavActive("/admin/usersx", "/admin/users")).toBe(false)
	})
})

const pages = <T extends { group: string }>(entries: T[]): T[] => entries.filter(entry => entry.group !== "Search")

describe("paletteEntries", () => {
	test("an empty query lists every page in order", () => {
		expect(paletteEntries(groups, "").map(entry => entry.label)).toEqual(["Users", "Projects", "Deadlines"])
	})

	test("a query matches on the label", () => {
		expect(pages(paletteEntries(groups, "dead")).map(entry => entry.label)).toEqual(["Deadlines"])
	})

	test("a query matches on the heading a page sits under", () => {
		expect(pages(paletteEntries(groups, "programme")).map(entry => entry.label)).toEqual(["Deadlines"])
	})

	test("a longer query also offers a user search", () => {
		const entries = paletteEntries(groups, " ada ")
		expect(entries.at(-1)?.href).toBe("/admin/users?q=ada")
		expect(entries.at(-1)?.group).toBe("Search")
	})

	test("a one-letter query does not offer a user search", () => {
		expect(paletteEntries(groups, "a").some(entry => entry.group === "Search")).toBe(false)
	})

	test("no user search without the users page in the sidebar", () => {
		const withoutUsers = [{ items: [{ href: "/admin/deadlines", label: "Deadlines" }], label: "Programme" }]
		expect(paletteEntries(withoutUsers, "ada").some(entry => entry.group === "Search")).toBe(false)
	})

	test("a person named outright is the top row, opening their profile", () => {
		const ada = { email: "ada@example.com", id: "usr_1", name: "Ada", slackId: "U0BER1GR3GX" }
		const entries = paletteEntries(groups, "U0BER1GR3GX", ada)
		expect(entries[0]).toEqual({ group: "User", href: "/admin/users/usr_1", label: "Open Ada" })
		expect(entries.at(-1)?.group).toBe("Search")
	})

	test("no profile row without a person to open", () => {
		expect(paletteEntries(groups, "U0BER1GR3GX").some(entry => entry.group === "User")).toBe(false)
	})

	test("no profile row without the users page in the sidebar", () => {
		const withoutUsers = [{ items: [{ href: "/admin/deadlines", label: "Deadlines" }], label: "Programme" }]
		const ada = { email: "ada@example.com", id: "usr_1", name: "Ada", slackId: null }
		expect(paletteEntries(withoutUsers, "ada@example.com", ada).some(entry => entry.group === "User")).toBe(false)
	})
})

describe("isUserIdentifier", () => {
	test("an email address or a Slack ID names a user", () => {
		expect(isUserIdentifier("ada@example.com")).toBe(true)
		expect(isUserIdentifier(" U0BER1GR3GX ")).toBe(true)
		expect(isUserIdentifier("u0ber1gr3gx")).toBe(true)
	})

	test("a name or a partial query does not", () => {
		expect(isUserIdentifier("ada")).toBe(false)
		expect(isUserIdentifier("ada@")).toBe(false)
		expect(isUserIdentifier("U12")).toBe(false)
	})
})

describe("exactUser", () => {
	const users: PaletteUser[] = [
		{ email: "ada@example.com", id: "usr_1", name: "Ada", slackId: "U0BER1GR3GX" },
		{ email: "grace@example.com", id: "usr_2", name: null, slackId: null },
	]

	test("matches an email in any case", () => {
		expect(exactUser("ADA@example.com", users)?.id).toBe("usr_1")
	})

	test("matches a Slack ID in any case", () => {
		expect(exactUser("u0ber1gr3gx", users)?.id).toBe("usr_1")
	})

	test("does not match a partial address or a name", () => {
		expect(exactUser("ada", users)).toBeUndefined()
		expect(exactUser("ada@example", users)).toBeUndefined()
	})
})
