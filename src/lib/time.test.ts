import { describe, expect, test } from "bun:test"
import {
	addWeeksInZone,
	calendarDay,
	calendarDayNumber,
	DAY_MS,
	eachDayBetween,
	effectiveDateFor,
	formatDbTimestamp,
	parseDbTimestamp,
	parseTimestampFields,
	utcCalendarDay,
	zonedWallTime,
} from "@/lib/time"

describe("parseDbTimestamp / formatDbTimestamp", () => {
	test("round-trips a timestamp through the DB text form", () => {
		const at = new Date("2026-10-22T14:25:05.757Z")
		expect(formatDbTimestamp(at)).toBe("2026-10-22 14:25:05.757")
		expect(parseDbTimestamp("2026-10-22 14:25:05.757").toISOString()).toBe("2026-10-22T14:25:05.757Z")
	})

	test("reads DB text as UTC rather than local time", () => {
		expect(parseDbTimestamp("2026-01-01 00:00:00.000").toISOString()).toBe("2026-01-01T00:00:00.000Z")
	})
})

describe("calendarDay", () => {
	test("formats the YYYY-MM-DD in the given timezone", () => {
		expect(calendarDay(new Date("2026-01-01T04:00:00Z"), "America/New_York")).toBe("2025-12-31")
		expect(calendarDay(new Date("2026-01-01T05:00:00Z"), "America/New_York")).toBe("2026-01-01")
	})

	test("effectiveDateFor is the same reading", () => {
		const at = new Date("2026-06-15T12:00:00Z")
		expect(effectiveDateFor(at, "UTC")).toBe(calendarDay(at, "UTC"))
	})
})

describe("calendarDayNumber / utcCalendarDay", () => {
	test("consecutive UTC days differ by one", () => {
		const first = utcCalendarDay(new Date("2026-01-01T12:00:00Z"))
		const second = utcCalendarDay(new Date("2026-01-02T12:00:00Z"))
		expect(second - first).toBe(1)
	})

	test("agrees with the timezone-aware form for UTC", () => {
		const at = new Date("2026-01-02T00:00:00Z")
		expect(calendarDayNumber(at, "UTC")).toBe(utcCalendarDay(at))
	})
})

describe("parseTimestampFields", () => {
	test("parses the listed columns to Dates", () => {
		const row = parseTimestampFields({ createdAt: "2026-01-01 00:00:00.000", name: "hi" }, ["createdAt"] as const)
		expect(row.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z")
		expect(row.name).toBe("hi")
	})

	test("maps non-string values to null, keeping nullability", () => {
		const row = parseTimestampFields({ at: null as string | null }, ["at"] as const)
		expect(row.at).toBeNull()
	})
})

describe("zonedWallTime", () => {
	test("resolves a wall-clock midnight through the zone's offset", () => {
		// New York is UTC-5 in January and UTC-4 in July.
		expect(zonedWallTime(Date.UTC(2026, 0, 15), "America/New_York").toISOString()).toBe("2026-01-15T05:00:00.000Z")
		expect(zonedWallTime(Date.UTC(2026, 6, 15), "America/New_York").toISOString()).toBe("2026-07-15T04:00:00.000Z")
	})

	test("reads the offset at the target side of a daylight-saving change", () => {
		// US clocks spring forward on 2026-03-08, so its midnight is still EST.
		expect(zonedWallTime(Date.UTC(2026, 2, 8), "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z")
	})
})

describe("addWeeksInZone", () => {
	test("keeps the wall-clock time across a daylight-saving change", () => {
		// 7pm on 2026-10-25 in New York is EDT; a week later the clocks are back on EST.
		const before = new Date("2026-10-25T23:00:00Z")
		const after = addWeeksInZone(before, 1, "America/New_York")
		expect(after.toISOString()).toBe("2026-11-02T00:00:00.000Z")
		expect(after.getTime() - before.getTime()).toBe(7 * DAY_MS + 60 * 60 * 1000)
	})

	test("leaves the moment alone for a zero-week shift", () => {
		const at = new Date("2026-01-01T12:00:00Z")
		expect(addWeeksInZone(at, 0, "Asia/Tokyo")).toBe(at)
	})
})

describe("eachDayBetween", () => {
	test("lists every day inclusive", () => {
		expect(eachDayBetween("2026-01-01", "2026-01-03")).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"])
	})

	test("returns a single day when first equals last", () => {
		expect(eachDayBetween("2026-01-01", "2026-01-01")).toEqual(["2026-01-01"])
	})
})
