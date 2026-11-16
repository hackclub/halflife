import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readStored, writeStored } from "./browser-storage"

const fail = () => {
	throw new Error("SecurityError: storage is blocked")
}

/** A Map-backed `localStorage`, or one that throws on every call, as a private window does. */
function fakeStorage(blocked: boolean) {
	const items = new Map<string, string>()
	return {
		getItem: (key: string) => (blocked ? fail() : (items.get(key) ?? null)),
		removeItem: (key: string) => (blocked ? fail() : void items.delete(key)),
		setItem: (key: string, value: string) => (blocked ? fail() : void items.set(key, value)),
	}
}

const g = globalThis as { localStorage?: unknown }
let previous: unknown

beforeEach(() => {
	previous = g.localStorage
})

afterEach(() => {
	g.localStorage = previous
})

describe("browser storage", () => {
	test("reads back what was written, and null once removed", () => {
		g.localStorage = fakeStorage(false)
		writeStored("k", "v")
		expect(readStored("k")).toBe("v")
		writeStored("k", null)
		expect(readStored("k")).toBeNull()
	})

	test("keeps writes in memory when storage is blocked, so they read back for the visit", () => {
		g.localStorage = fakeStorage(true)
		expect(readStored("blocked")).toBeNull()
		writeStored("blocked", "kept")
		expect(readStored("blocked")).toBe("kept")
		writeStored("blocked", null)
		expect(readStored("blocked")).toBeNull()
	})

	test("a write that reaches storage replaces an in-memory value", () => {
		const storage = fakeStorage(false)
		g.localStorage = storage
		writeStored("mixed", "first")
		expect(readStored("mixed")).toBe("first")
		writeStored("mixed", "second")
		expect(readStored("mixed")).toBe("second")
	})
})
