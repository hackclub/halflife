import { describe, expect, test } from "bun:test"
import { HttpError } from "@/lib/errors"
import {
	cursorWhere,
	decodeCursor,
	encodeCursor,
	orderByFor,
	pageResult,
	positionWhere,
	readCursor,
} from "@/lib/pagination"

describe("encodeCursor / decodeCursor", () => {
	test("round-trips a dated position", () => {
		const at = new Date("2026-01-01T00:00:00.000Z")
		const cursor = encodeCursor({ at, id: "abc" })
		expect(decodeCursor(cursor)).toEqual({ at, id: "abc" })
	})

	test("round-trips a null leading value", () => {
		const cursor = encodeCursor({ at: null, id: "abc" })
		expect(decodeCursor(cursor)).toEqual({ at: null, id: "abc" })
	})

	test("rejects truncated or foreign cursors as a bad request", () => {
		expect(() => decodeCursor("!!!")).toThrow(HttpError)
		expect(() => decodeCursor("aGVsbG8")).toThrow(HttpError)
		try {
			decodeCursor("!!!")
		} catch (err) {
			expect(err).toBeInstanceOf(HttpError)
			expect((err as HttpError).code).toBe("INVALID_QUERY")
		}
	})
})

describe("readCursor", () => {
	test("returns null for missing or invalid cursors", () => {
		expect(readCursor(undefined)).toBeNull()
		expect(readCursor("")).toBeNull()
		expect(readCursor("!!!")).toBeNull()
		expect(readCursor(encodeCursor({ at: null, id: "" }))).toBeNull()
	})

	test("reads a valid cursor without throwing", () => {
		const at = new Date("2026-01-01T00:00:00.000Z")
		expect(readCursor(encodeCursor({ at, id: "abc" }))).toEqual({ at, id: "abc" })
	})
})

describe("orderByFor", () => {
	test("orders by the leading column then id as tiebreaker", () => {
		expect(orderByFor({ column: "createdAt", direction: "desc" })).toEqual([{ createdAt: "desc" }, { id: "desc" }])
		expect(orderByFor({ column: "createdAt", direction: "asc" })).toEqual([{ createdAt: "asc" }, { id: "asc" }])
	})
})

describe("positionWhere", () => {
	test("returns the base filter when there is no position", () => {
		const base = { userId: "u" }
		expect(positionWhere(null, { column: "createdAt", direction: "desc" }, base)).toEqual(base)
	})

	test("selects rows strictly after a dated position", () => {
		const at = new Date("2026-01-01T00:00:00.000Z")
		expect(positionWhere({ at, id: "a" }, { column: "createdAt", direction: "desc" }, { userId: "u" })).toEqual({
			OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "a" } }],
			userId: "u",
		})
		expect(positionWhere({ at, id: "a" }, { column: "createdAt", direction: "asc" }, {})).toEqual({
			OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: "a" } }],
		})
	})

	test("handles null leading values per direction", () => {
		expect(positionWhere({ at: null, id: "a" }, { column: "createdAt", direction: "desc" }, {})).toEqual({
			OR: [{ createdAt: null, id: { lt: "a" } }, { createdAt: { not: null } }],
		})
		expect(positionWhere({ at: null, id: "a" }, { column: "createdAt", direction: "asc" }, {})).toEqual({
			OR: [{ createdAt: null, id: { gt: "a" } }],
		})
	})
})

describe("cursorWhere", () => {
	test("returns the base filter without a cursor", () => {
		const base = { userId: "u" }
		expect(cursorWhere(undefined, { column: "createdAt", direction: "desc" }, base)).toEqual(base)
	})

	test("decodes a cursor into a position filter", () => {
		const at = new Date("2026-01-01T00:00:00.000Z")
		const cursor = encodeCursor({ at, id: "a" })
		expect(cursorWhere(cursor, { column: "createdAt", direction: "desc" }, {})).toEqual({
			OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "a" } }],
		})
	})
})

describe("pageResult", () => {
	const order = { at: (_row: { id: string }) => null, column: "createdAt", direction: "desc" } as const

	test("returns a cursor to the page after it when there are more rows", () => {
		const rows = [{ id: "1" }, { id: "2" }, { id: "3" }]
		const { items, nextCursor } = pageResult(rows, 2, order)
		expect(items).toEqual([{ id: "1" }, { id: "2" }])
		expect(nextCursor).not.toBeNull()
		expect(decodeCursor(nextCursor ?? "")).toEqual({ at: null, id: "2" })
	})

	test("returns no cursor on the last page", () => {
		const { items, nextCursor } = pageResult([{ id: "1" }, { id: "2" }], 2, order)
		expect(items).toEqual([{ id: "1" }, { id: "2" }])
		expect(nextCursor).toBeNull()
	})

	test("handles an empty page", () => {
		expect(pageResult([], 2, order)).toEqual({ items: [], nextCursor: null })
	})
})
