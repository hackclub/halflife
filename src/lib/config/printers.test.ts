import { describe, expect, test } from "bun:test"
import { paceTarget, printerById, printerComesAsGrant, submitFloorFor, weekAsk, weeksToGo } from "@/lib/config/printers"

describe("printer catalogue", () => {
	test("falls back to the default goal for unknown ids", () => {
		expect(printerById("ender-3-v3-se").id).toBe("ender-3-v3-se")
		expect(printerById("nope").id).toBe("ender-3-v3-se")
	})

	test("grants reach the listed countries", () => {
		expect(printerComesAsGrant("Egypt")).toBe(true)
		expect(printerComesAsGrant("USA")).toBe(false)
	})
})

describe("pacing", () => {
	const goal = printerById("ender-3-v3-se")

	test("the ask is the pace plus the tier's extra funded hours", () => {
		expect(weekAsk(10, 6)).toBe(10)
		expect(weekAsk(10, 16)).toBe(20)
	})

	test("targets and floors", () => {
		expect(paceTarget(goal, 1)).toBe(20)
		expect(submitFloorFor(6)).toBe(6)
		expect(weeksToGo(goal, 0)).toBe(5)
		expect(weeksToGo(goal, 1_000_000)).toBe(0)
	})
})
