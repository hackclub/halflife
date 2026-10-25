import { describe, expect, test } from "bun:test"
import { ENTRY_TIER, getTier, getTierOrThrow, isTierId, TIER_IDS, tierForHours } from "@/lib/config/tiers"

describe("getTier / getTierOrThrow / isTierId", () => {
	test("reads tiers by id", () => {
		expect(getTier(1)?.id).toBe(1)
		expect(getTier(99)).toBeUndefined()
		expect(getTierOrThrow(2).id).toBe(2)
		expect(() => getTierOrThrow(99)).toThrow("Unknown tier: 99")
	})

	test("validates tier ids", () => {
		expect(isTierId(1)).toBe(true)
		expect(isTierId(99)).toBe(false)
		expect(isTierId("1")).toBe(false)
		expect(TIER_IDS).toEqual([1, 2, 3])
	})
})

describe("tierForHours", () => {
	test("picks the highest tier the hours earn", () => {
		expect(tierForHours(0)).toBeNull()
		expect(tierForHours(ENTRY_TIER.fundingHours)).toEqual(ENTRY_TIER)
		expect(tierForHours(100)?.id).toBe(3)
	})
})
