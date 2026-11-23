import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { applyAdminTheme, getAdminTheme, getServerAdminTheme, setAdminTheme, toggleAdminTheme } from "./admin-theme"

const g = globalThis as { localStorage?: unknown; document?: unknown }

let previousStorage: unknown
let previousDocument: unknown
let dataset: { [_: string]: string | undefined }

beforeEach(() => {
	previousStorage = g.localStorage
	previousDocument = g.document
	const items = new Map<string, string>()
	g.localStorage = {
		getItem: (key: string) => items.get(key) ?? null,
		removeItem: (key: string): void => void items.delete(key),
		setItem: (key: string, value: string): void => void items.set(key, value),
	}
	dataset = {}
	g.document = { documentElement: { dataset } }
})

afterEach(() => {
	g.localStorage = previousStorage
	g.document = previousDocument
})

describe("admin theme", () => {
	test("starts light on the server and in a browser with nothing stored", () => {
		expect(getServerAdminTheme()).toBe("light")
		expect(getAdminTheme()).toBe("light")
	})

	test("a stored mode reads back and is put on the html element", () => {
		setAdminTheme("dark")
		expect(getAdminTheme()).toBe("dark")
		applyAdminTheme("dark")
		expect(dataset.theme).toBe("dark")
	})

	test("toggling returns the new mode and applies it", () => {
		expect(toggleAdminTheme()).toBe("dark")
		expect(dataset.theme).toBe("dark")
		expect(toggleAdminTheme()).toBe("light")
		expect(dataset.theme).toBe("light")
	})

	test("an unknown stored value falls back to light", () => {
		const storage = g.localStorage as { setItem: (key: string, value: string) => void }
		storage.setItem("half-life:admin:theme", "midnight")
		expect(getAdminTheme()).toBe("light")
	})
})
