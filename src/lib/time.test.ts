import { describe, expect, test } from "bun:test"
import {
	calendarDay,
	calendarDayNumber,
	eachDayBetween,
	effectiveDateFor,
	formatDbTimestamp,
	parseDbTimestamp,
	utcCalendarDay,
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

describe("eachDayBetween", () => {
	test("lists every day inclusive", () => {
		expect(eachDayBetween("2026-01-01", "2026-01-03")).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"])
	})

	test("returns a single day when first equals last", () => {
		expect(eachDayBetween("2026-01-01", "2026-01-01")).toEqual(["2026-01-01"])
	})
})
