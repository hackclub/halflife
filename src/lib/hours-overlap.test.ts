import { describe, expect, test } from "bun:test"
import {
	cachedSpansCover,
	capSubtraction,
	mergeIntervals,
	overlapSeconds,
	parseCachedSpans,
	spanWindowFor,
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

describe("overlapSeconds", () => {
	test("measures the shared seconds once", () => {
		const first = [
			{ end: 10, start: 0 },
			{ end: 30, start: 20 },
		]
		const second = [{ end: 25, start: 5 }]
		expect(overlapSeconds(first, second)).toBe(10)
	})

	test("is zero when the sets never touch", () => {
		expect(overlapSeconds([{ end: 5, start: 0 }], [{ end: 10, start: 5 }])).toBe(0)
		expect(overlapSeconds([], [{ end: 10, start: 0 }])).toBe(0)
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

describe("parseCachedSpans / cachedSpansCover", () => {
	test("reads back what was written", () => {
		const cached = { from: 0, spans: [{ end: 10, start: 0 }], to: 100 }
		expect(parseCachedSpans(cached)).toEqual(cached)
	})

	test("rejects foreign shapes and drops bad rows", () => {
		expect(parseCachedSpans(null)).toBeNull()
		expect(parseCachedSpans([])).toBeNull()
		expect(parseCachedSpans({ from: 0, spans: [], to: "x" })).toBeNull()
		expect(
			parseCachedSpans({
				from: 0,
				spans: [
					{ end: 1, start: 5 },
					{ end: 10, start: 0 },
				],
				to: 100,
			}),
		).toEqual({
			from: 0,
			spans: [{ end: 10, start: 0 }],
			to: 100,
		})
	})

	test("checks the window the cache was fetched for", () => {
		const cached = { from: 0, spans: [], to: 100 }
		expect(cachedSpansCover(cached, 10, 90)).toBe(true)
		expect(cachedSpansCover(cached, 10, 101)).toBe(false)
	})
})

describe("windowsForLink / spanWindowFor", () => {
	test("keeps own-phase windows and matching elsewhere recordings", () => {
		const own = [{ end: 10, start: 0 }]
		const matching = { end: 30, start: 20 }
		const elsewhere = [
			{ hackatimeProject: "a", window: matching },
			{ hackatimeProject: "b", window: { end: 50, start: 40 } },
		]
		const [first] = own
		if (!first) throw new Error("fixture is empty")
		expect(windowsForLink(own, elsewhere, "a")).toEqual([first, matching])
	})

	test("spans every window with an hour of slack either side", () => {
		expect(
			spanWindowFor([
				{ end: 10, start: 0 },
				{ end: 30, start: 20 },
			]),
		).toEqual({ fromSeconds: -3600, toSeconds: 3630 })
		expect(spanWindowFor([])).toBeNull()
	})
})
