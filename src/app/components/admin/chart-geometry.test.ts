import { describe, expect, test } from "bun:test"
import { niceTicks } from "@/app/components/admin/chart-geometry"

/** Every tick is `step` after the one below it, allowing for float dust. */
const gaps = (ticks: number[]) => ticks.slice(1).map((tick, i) => tick - (ticks[i] ?? 0))

describe("niceTicks", () => {
	test("spaces a count axis at a round step and ends on a round top", () => {
		expect(niceTicks(182, { integer: true })).toEqual({
			step: 50,
			ticks: [0, 50, 100, 150, 200],
			top: 200,
		})
	})

	test("uses two-step ticks where a coarser five would leave too few gridlines", () => {
		expect(niceTicks(9, { integer: true })).toEqual({ step: 2, ticks: [0, 2, 4, 6, 8, 10], top: 10 })
	})

	test("keeps a small count axis on whole people", () => {
		expect(niceTicks(4, { integer: true })).toEqual({ step: 1, ticks: [0, 1, 2, 3, 4], top: 4 })
	})

	test("rounds a spiky hours maximum to a readable top", () => {
		expect(niceTicks(574.3)).toEqual({ step: 200, ticks: [0, 200, 400, 600], top: 600 })
	})

	test("allows a fractional step for hours", () => {
		expect(niceTicks(1.2)).toEqual({ step: 0.5, ticks: [0, 0.5, 1, 1.5], top: 1.5 })
	})

	test("never divides a head count into fractions", () => {
		for (let max = 1; max <= 100; max++) {
			const { step, ticks, top } = niceTicks(max, { integer: true })
			expect(Number.isInteger(step)).toBe(true)
			expect(Number.isInteger(top)).toBe(true)
			for (const tick of ticks) expect(Number.isInteger(tick)).toBe(true)
			for (const gap of gaps(ticks)) expect(gap).toBeCloseTo(step, 9)
			expect(top).toBeGreaterThanOrEqual(max)
		}
	})

	test("always starts at zero, ends at the top, and sits above the tallest mark", () => {
		for (const max of [0, 0.3, 1, 7, 28, 100, 182, 574.3, 2800]) {
			const { step, ticks, top } = niceTicks(max)
			expect(ticks[0]).toBe(0)
			expect(ticks.at(-1)).toBe(top)
			expect(top).toBeGreaterThanOrEqual(max)
			for (const gap of gaps(ticks)) expect(gap).toBeCloseTo(step, 9)
		}
	})
})
