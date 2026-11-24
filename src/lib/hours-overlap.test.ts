import { describe, expect, test } from "bun:test"
import {
	capSubtraction,
	clipWindow,
	mergeIntervals,
	overlapFromCache,
	overlapWindowsFor,
	parseCachedOverlap,
	timelapseWindow,
	windowsForLink,
} from "@/lib/hours-overlap"

describe("mergeIntervals", () => {
	test("collapses overlapping and touching intervals", () => {
		expect(
			mergeIntervals([
				{ end: 5, start: 0 },
				{ end: 10, start: 3 },
				{ end: 12, start: 10 },
				{ end: 20, start: 15 },
			]),
		).toEqual([
			{ end: 12, start: 0 },
			{ end: 20, start: 15 },
		])
	})

	test("drops zero-length, backwards and non-finite intervals", () => {
		expect(
			mergeIntervals([
				{ end: 5, start: 5 },
				{ end: 3, start: 7 },
				{ end: Number.NaN, start: 0 },
				{ end: 9, start: 1 },
			]),
		).toEqual([{ end: 9, start: 1 }])
		expect(mergeIntervals([])).toEqual([])
	})
})

describe("capSubtraction", () => {
	test("caps the overlap at what is available", () => {
		expect(capSubtraction(100, 30)).toBe(30)
		expect(capSubtraction(10, 30)).toBe(10)
	})

	test("treats negatives and non-finite input as zero", () => {
		expect(capSubtraction(-5, 10)).toBe(0)
		expect(capSubtraction(10, -5)).toBe(0)
		expect(capSubtraction(Number.NaN, 10)).toBe(0)
		expect(capSubtraction(10, Number.POSITIVE_INFINITY)).toBe(0)
	})
})

describe("timelapseWindow", () => {
	test("converts a recording start and duration into a window", () => {
		expect(timelapseWindow(1_000_000, 60)).toEqual({ end: 1060, start: 1000 })
		expect(timelapseWindow(new Date(2_000_000), 60)).toEqual({ end: 2060, start: 2000 })
	})

	test("returns null without a usable start or duration", () => {
		expect(timelapseWindow(null, 60)).toBeNull()
		expect(timelapseWindow(-1, 60)).toBeNull()
		expect(timelapseWindow(1_000_000, 0)).toBeNull()
		expect(timelapseWindow(1_000_000, null)).toBeNull()
	})
})

describe("windowsForLink", () => {
	test("keeps only the recordings that name the link's project", () => {
		const matching = { end: 30, start: 20 }
		const recordings = [
			{ hackatimeProject: "a", window: matching },
			{ hackatimeProject: "b", window: { end: 50, start: 40 } },
			{ hackatimeProject: null, window: { end: 10, start: 0 } },
		]
		expect(windowsForLink(recordings, "a")).toEqual([matching])
	})

	test("a recording with no project name is never a window for a link", () => {
		const unnamed = [{ hackatimeProject: null, window: { end: 10, start: 0 } }]
		expect(windowsForLink(unnamed, "a")).toEqual([])
		expect(windowsForLink(unnamed, "")).toEqual([])
	})

	test("overlapWindowsFor merges the named windows", () => {
		const recordings = [
			{ hackatimeProject: "a", window: { end: 30, start: 0 } },
			{ hackatimeProject: "a", window: { end: 50, start: 20 } },
		]
		expect(overlapWindowsFor(recordings, "a")).toEqual([{ end: 50, start: 0 }])
	})
})

describe("clipWindow", () => {
	test("keeps only the part of a window inside the week", () => {
		expect(clipWindow({ end: 100, start: 50 }, { fromSeconds: 80, toSeconds: 200 })).toEqual({ end: 100, start: 80 })
	})

	test("is null when the window misses the week", () => {
		expect(clipWindow({ end: 100, start: 50 }, { fromSeconds: 100, toSeconds: 200 })).toBeNull()
	})

	test("leaves the window alone without a week", () => {
		expect(clipWindow({ end: 100, start: 50 }, null)).toEqual({ end: 100, start: 50 })
	})
})

describe("parseCachedOverlap / overlapFromCache", () => {
	const measured = { windows: [{ end: 100, seconds: 40, start: 0 }] }

	test("reads back what was written", () => {
		expect(parseCachedOverlap(measured)).toEqual([{ end: 100, seconds: 40, start: 0 }])
	})

	test("a value this did not write is no measurement", () => {
		expect(parseCachedOverlap(null)).toBeNull()
		expect(parseCachedOverlap([])).toBeNull()
		expect(parseCachedOverlap({ spans: [], to: 1 })).toBeNull()
	})

	test("drops malformed rows rather than trusting them", () => {
		expect(
			parseCachedOverlap({
				windows: [{ end: 100, seconds: 40, start: 0 }, { end: 5, seconds: 1, start: 9 }, { seconds: 1 }],
			}),
		).toEqual([{ end: 100, seconds: 40, start: 0 }])
	})

	test("sums the measured seconds for exactly the windows asked about", () => {
		const cache = parseCachedOverlap({
			windows: [
				{ end: 100, seconds: 40, start: 0 },
				{ end: 300, seconds: 25, start: 200 },
			],
		})
		expect(
			overlapFromCache(
				[
					{ end: 100, start: 0 },
					{ end: 300, start: 200 },
				],
				cache,
			),
		).toBe(65)
		expect(overlapFromCache([], cache)).toBe(0)
	})

	test("a window that was never measured is unchecked, not zero", () => {
		const cache = parseCachedOverlap(measured)
		expect(
			overlapFromCache(
				[
					{ end: 100, start: 0 },
					{ end: 300, start: 200 },
				],
				cache,
			),
		).toBeNull()
		expect(overlapFromCache([{ end: 100, start: 0 }], null)).toBeNull()
		// A window that only shares an end with a measured one is a different window.
		expect(overlapFromCache([{ end: 100, start: 10 }], cache)).toBeNull()
	})
})
