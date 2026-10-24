import { describe, expect, test } from "bun:test"
import {
	type CalendarEvent,
	dayKey,
	dayLabel,
	daySegment,
	dayShort,
	eventColour,
	eventIsLive,
	eventIsUpcoming,
	eventRangeLabel,
	eventsOnDay,
	minutesInDay,
	monthOf,
	msUntilStart,
	nextEvent,
	shiftWeek,
	weekDays,
	weekLabel,
} from "@/lib/events"

const START = new Date("2026-01-05T12:00:00Z")
const END = new Date("2026-01-05T13:00:00Z")

describe("eventIsLive", () => {
	test("is live between start and end", () => {
		expect(eventIsLive({ endsAt: END, startsAt: START }, new Date("2026-01-05T12:30:00Z"))).toBe(true)
		expect(eventIsLive({ endsAt: END, startsAt: START }, new Date("2026-01-05T11:59:59Z"))).toBe(false)
		expect(eventIsLive({ endsAt: END, startsAt: START }, END)).toBe(false)
	})

	test("an event with no end stays live after its start", () => {
		expect(eventIsLive({ endsAt: null, startsAt: START }, new Date("2026-01-05T12:00:01Z"))).toBe(true)
		expect(eventIsLive({ endsAt: null, startsAt: START }, START)).toBe(true)
	})
})

describe("eventIsUpcoming", () => {
	test("is upcoming until the end, or the start when there is none", () => {
		expect(eventIsUpcoming({ endsAt: END, startsAt: START }, new Date("2026-01-05T12:30:00Z"))).toBe(true)
		expect(eventIsUpcoming({ endsAt: END, startsAt: START }, END)).toBe(false)
		expect(eventIsUpcoming({ endsAt: null, startsAt: START }, new Date("2026-01-05T11:00:00Z"))).toBe(true)
		expect(eventIsUpcoming({ endsAt: null, startsAt: START }, START)).toBe(false)
	})
})

describe("msUntilStart", () => {
	test("counts down floored at zero", () => {
		expect(msUntilStart({ startsAt: START }, new Date("2026-01-05T11:00:00Z"))).toBe(3_600_000)
		expect(msUntilStart({ startsAt: START }, START)).toBe(0)
		expect(msUntilStart({ startsAt: START }, new Date("2026-01-05T13:00:00Z"))).toBe(0)
	})
})

describe("dayKey / monthOf", () => {
	test("zero-pads calendar labels", () => {
		expect(dayKey(2026, 1, 5)).toBe("2026-01-05")
		expect(dayKey(2026, 12, 25)).toBe("2026-12-25")
	})

	test("opens the grid on the day's own month", () => {
		expect(monthOf("2026-01-05")).toEqual({ month: 1, year: 2026 })
	})
})

describe("weekDays / shiftWeek / weekLabel", () => {
	test("weeks run Monday to Sunday around the day", () => {
		expect(weekDays("2026-01-07")).toEqual([
			"2026-01-05",
			"2026-01-06",
			"2026-01-07",
			"2026-01-08",
			"2026-01-09",
			"2026-01-10",
			"2026-01-11",
		])
		expect(weekDays("2026-01-05")).toEqual(weekDays("2026-01-11"))
	})

	test("shifts by whole weeks", () => {
		expect(shiftWeek("2026-01-07", 1)).toBe("2026-01-14")
		expect(shiftWeek("2026-01-07", -1)).toBe("2025-12-31")
	})

	test("labels widen across months and years", () => {
		expect(weekLabel(weekDays("2026-01-07"))).toBe("January 5 – 11, 2026")
		expect(weekLabel(weekDays("2026-02-01"))).toBe("January 26 – February 1, 2026")
		expect(weekLabel(weekDays("2026-12-30"))).toBe("December 28, 2026 – January 3, 2027")
	})
})

describe("minutesInDay / daySegment", () => {
	test("counts minutes from local midnight", () => {
		expect(minutesInDay(new Date("2026-01-05T19:00:00Z"), "America/New_York")).toBe(840)
		expect(minutesInDay(new Date("2026-01-05T05:00:00Z"), "UTC")).toBe(300)
	})

	test("clips an event to the day", () => {
		const at = (s: string, e: string | null) => ({ endsAt: e ? new Date(e) : null, startsAt: new Date(s) })
		expect(daySegment(at("2026-03-05T19:00:00Z", "2026-03-05T20:30:00Z"), "2026-03-05", "UTC")).toEqual({
			endMin: 1230,
			startMin: 1140,
		})
		expect(daySegment(at("2026-03-05T22:00:00Z", "2026-03-06T01:00:00Z"), "2026-03-05", "UTC")).toEqual({
			endMin: 1440,
			startMin: 1320,
		})
		expect(daySegment(at("2026-03-05T22:00:00Z", "2026-03-06T01:00:00Z"), "2026-03-06", "UTC")).toEqual({
			endMin: 60,
			startMin: 0,
		})
	})

	test("gives open-ended events a half-hour block and ends midnight runs at 1440", () => {
		const at = (s: string, e: string | null) => ({ endsAt: e ? new Date(e) : null, startsAt: new Date(s) })
		expect(daySegment(at("2026-03-05T19:00:00Z", null), "2026-03-05", "UTC")).toEqual({
			endMin: 1170,
			startMin: 1140,
		})
		expect(daySegment(at("2026-03-05T19:00:00Z", "2026-03-06T00:00:00Z"), "2026-03-05", "UTC")).toEqual({
			endMin: 1440,
			startMin: 1140,
		})
	})

	test("is null when the event never touches the day", () => {
		const at = (s: string, e: string | null) => ({ endsAt: e ? new Date(e) : null, startsAt: new Date(s) })
		expect(daySegment(at("2026-03-04T19:00:00Z", "2026-03-04T20:00:00Z"), "2026-03-05", "UTC")).toBeNull()
		expect(daySegment(at("2026-03-06T19:00:00Z", "2026-03-06T20:00:00Z"), "2026-03-05", "UTC")).toBeNull()
		expect(daySegment(at("2026-03-05T19:00:00Z", "2026-03-05T19:00:00Z"), "2026-03-05", "UTC")).toBeNull()
	})
})

describe("dayLabel / dayShort / eventRangeLabel", () => {
	test("heads a day long and short", () => {
		expect(dayLabel("2026-03-05")).toBe("Thursday, March 5")
		expect(dayShort("2026-03-05")).toBe("Thu, Mar 5")
	})

	test("collapses a shared meridiem", () => {
		expect(eventRangeLabel(new Date("2026-03-05T19:00:00Z"), new Date("2026-03-05T20:00:00Z"), "UTC")).toBe(
			"7:00 – 8:00 PM",
		)
		expect(eventRangeLabel(new Date("2026-03-05T11:00:00Z"), new Date("2026-03-05T13:00:00Z"), "UTC")).toBe(
			"11:00 AM – 1:00 PM",
		)
		expect(eventRangeLabel(new Date("2026-03-05T19:00:00Z"), null, "UTC")).toBe("7:00 PM")
	})
})

describe("eventsOnDay / nextEvent", () => {
	const make = (id: string, start: string, end: string): CalendarEvent => ({
		colour: "CORAL",
		description: null,
		endsAt: new Date(end),
		id,
		published: true,
		seriesId: null,
		startsAt: new Date(start),
		title: id,
	})

	test("belongs to the day it started", () => {
		const events = [
			make("b", "2026-03-06T10:00:00Z", "2026-03-06T11:00:00Z"),
			make("a", "2026-03-05T10:00:00Z", "2026-03-05T11:00:00Z"),
		]
		expect(eventsOnDay(events, "2026-03-05", "UTC").map(e => e.id)).toEqual(["a"])
	})

	test("finds the soonest unfinished event", () => {
		const events = [
			make("b", "2026-03-06T10:00:00Z", "2026-03-06T11:00:00Z"),
			make("a", "2026-03-05T10:00:00Z", "2026-03-05T11:00:00Z"),
		]
		expect(nextEvent(events, new Date("2026-03-05T09:00:00Z"))?.id).toBe("a")
		expect(nextEvent(events, new Date("2027-01-01T00:00:00Z"))).toBeNull()
	})
})

describe("eventColour", () => {
	test("returns the colour's own entry", () => {
		expect(eventColour("CORAL").label).toBe("Coral")
	})

	test("falls back to slate for an unknown colour", () => {
		expect(eventColour("BOGUS" as "CORAL")).toEqual({
			accent: "var(--color-navy-faint)",
			id: "SLATE",
			label: "Slate",
		})
	})
})
