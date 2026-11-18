import { describe, expect, test } from "bun:test"
import { bomGapCheck, bomGaps } from "@/lib/bom-gaps"

describe("bomGaps", () => {
	test("counts a part with no price or a zero price as unpriced", () => {
		expect(
			bomGaps([
				{ link: "https://a.example", unitCostUsd: 0 },
				{ link: "https://b.example", unitCostUsd: 2.5 },
				{ link: "https://c.example", unitCostUsd: -1 },
			]),
		).toEqual({ unlinked: 0, unpriced: 2 })
	})

	test("counts a blank or missing link as unlinked", () => {
		expect(
			bomGaps([
				{ link: null, unitCostUsd: 1 },
				{ link: "   ", unitCostUsd: 1 },
				{ link: "https://a.example", unitCostUsd: 1 },
			]),
		).toEqual({ unlinked: 2, unpriced: 0 })
	})

	test("an empty list has no gaps", () => {
		expect(bomGaps([])).toEqual({ unlinked: 0, unpriced: 0 })
	})
})

describe("bomGapCheck", () => {
	test("says nothing when every part is priced and linked", () => {
		expect(bomGapCheck({ unlinked: 0, unpriced: 0 })).toBeNull()
	})

	test("names both problems in one amber row", () => {
		const check = bomGapCheck({ unlinked: 2, unpriced: 1 })
		expect(check?.status).toBe("warn")
		expect(check?.blocking).toBeUndefined()
		expect(check?.detail).toContain("1 part with no price and 2 parts with no buy link")
	})

	test("names only the problem there is", () => {
		expect(bomGapCheck({ unlinked: 0, unpriced: 3 })?.detail).toContain("3 parts with no price.")
	})
})
