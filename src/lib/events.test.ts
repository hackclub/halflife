import { describe, expect, test } from "bun:test"
import { dayKey, eventColour, eventIsLive, eventIsUpcoming, monthOf, msUntilStart } from "@/lib/events"

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
