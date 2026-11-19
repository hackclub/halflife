import { describe, expect, test } from "bun:test"
import { type AdminNavGroup, isAdminNavActive, paletteEntries } from "./admin-nav"

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
})
