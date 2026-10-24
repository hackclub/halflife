import { describe, expect, test } from "bun:test"
import { formatDeadline, formatShortDate, formatUtcDateTime, toLocalInput } from "@/lib/deadline"

describe("formatDeadline", () => {
	test("reads the deadline in the program timezone", () => {
		expect(formatDeadline(new Date("2026-10-05T23:59:00Z"), "America/New_York")).toBe(
			"Monday, October 5 at 7:59 PM",
		)
	})

	test("short style drops the weekday and full month", () => {
		expect(formatDeadline(new Date("2026-10-05T23:59:00Z"), "America/New_York", "short")).toBe(
			"Mon, Oct 5 at 7:59 PM",
		)
	})

	test("accepts epoch millis", () => {
		expect(formatDeadline(Date.UTC(2026, 0, 5, 5), "UTC")).toBe("Monday, January 5 at 5:00 AM")
	})
})

describe("formatShortDate / formatUtcDateTime", () => {
	test("prints incidental dates the short way", () => {
		expect(formatShortDate("2026-10-05T12:00:00Z")).toBe("Oct 5")
	})

	test("pins audit timestamps to UTC", () => {
		expect(formatUtcDateTime(new Date("2026-10-05T23:59:00Z"))).toBe("Oct 5, 2026, 11:59 PM")
	})
})

describe("toLocalInput", () => {
	test("produces a datetime-local value whatever the machine zone", () => {
		expect(toLocalInput(new Date("2026-10-05T23:59:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
	})
})
