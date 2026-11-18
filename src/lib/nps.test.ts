import { describe, expect, test } from "bun:test"
import { isWithinFirstDay, summariseNps } from "@/lib/nps"

const HOUR_MS = 60 * 60 * 1000

describe("isWithinFirstDay", () => {
	const now = new Date("2026-11-18T12:00:00Z")

	test("holds the prompt back for an account that joined within the day", () => {
		expect(isWithinFirstDay(new Date(now.getTime() - HOUR_MS), now)).toBe(true)
		expect(isWithinFirstDay(new Date(now.getTime() - 23 * HOUR_MS), now)).toBe(true)
	})

	test("asks once a full day has passed", () => {
		expect(isWithinFirstDay(new Date(now.getTime() - 24 * HOUR_MS), now)).toBe(false)
		expect(isWithinFirstDay(new Date(now.getTime() - 30 * 24 * HOUR_MS), now)).toBe(false)
	})
})

describe("summariseNps", () => {
	test("has no score until somebody answers", () => {
		expect(summariseNps([])).toEqual({ detractors: 0, passives: 0, promoters: 0, responses: 0, score: null })
	})

	test("splits answers into promoters, passives and detractors", () => {
		expect(summariseNps([10, 9, 8, 7, 6, 0])).toEqual({
			detractors: 2,
			passives: 2,
			promoters: 2,
			responses: 6,
			score: 0,
		})
	})

	test("subtracts the detractor share from the promoter share and rounds to a point", () => {
		expect(summariseNps([10, 10, 9, 8, 6, 5]).score).toBe(17)
	})

	test("runs from -100 to 100", () => {
		expect(summariseNps([10, 10, 9]).score).toBe(100)
		expect(summariseNps([0, 5, 6]).score).toBe(-100)
		expect(summariseNps([8, 7]).score).toBe(0)
	})

	test("ignores values outside the scale rather than guessing at them", () => {
		expect(summariseNps([11, -1, 7.5, Number.NaN, 10])).toEqual({
			detractors: 0,
			passives: 0,
			promoters: 1,
			responses: 1,
			score: 100,
		})
	})
})
