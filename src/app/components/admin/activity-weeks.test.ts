import { describe, expect, test } from "bun:test"
import { weeklyAverages } from "@/app/components/admin/activity-weeks"
import { DAY_MS } from "@/lib/time"

/** A gap-filled run of days from `first`, one value each. */
function series(first: string, users: number[]) {
	const start = Date.parse(`${first}T00:00:00Z`)
	return users.map((value, i) => ({ day: new Date(start + i * DAY_MS).toISOString().slice(0, 10), users: value }))
}

describe("weeklyAverages", () => {
	test("averages a full week in two spans of seven days", () => {
		const days = series("2026-10-05", [0, 2, 4, 6, 8, 10, 12, 1, 1, 1, 1, 1, 1, 1])
		expect(weeklyAverages(days, "2026-10-05")).toEqual([
			{ average: 6, end: 6, start: 0, week: 0 },
			{ average: 1, end: 13, start: 7, week: 1 },
		])
	})

	test("averages the first week over the days the series starts with, not two unplotted zeros", () => {
		const days = series("2026-10-07", [2, 4, 6, 8, 10])
		expect(weeklyAverages(days, "2026-10-05")).toEqual([{ average: 6, end: 4, start: 0, week: 0 }])
	})

	test("averages the current week over the days so far", () => {
		const days = series("2026-10-05", [3, 6, 9])
		expect(weeklyAverages(days, "2026-10-05")).toEqual([{ average: 6, end: 2, start: 0, week: 0 }])
	})

	test("keeps warm-up days in their own week before the programme", () => {
		const days = series("2026-10-01", [1, 2, 3, 4, 5, 6, 7, 8])
		expect(weeklyAverages(days, "2026-10-05")).toEqual([
			{ average: 2.5, end: 3, start: 0, week: -1 },
			{ average: 6.5, end: 7, start: 4, week: 0 },
		])
	})

	test("has nothing to average for an empty series", () => {
		expect(weeklyAverages([], "2026-10-05")).toEqual([])
	})
})
