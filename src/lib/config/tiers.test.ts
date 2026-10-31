import { describe, expect, test } from "bun:test"
import {
	ENTRY_TIER,
	getTier,
	getTierOrThrow,
	isTierId,
	projectTierId,
	TIER_IDS,
	tierForHours,
} from "@/lib/config/tiers"
import { PhaseStatus } from "@/lib/enums"

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

describe("projectTierId", () => {
	const project = (over: { designStatus?: PhaseStatus; requestedTier?: number | null; tier?: number | null }) => ({
		designStatus: over.designStatus ?? PhaseStatus.draft,
		requestedTier: over.requestedTier ?? null,
		tier: over.tier ?? null,
	})

	test("uses the maker's request until the design is approved", () => {
		expect(projectTierId(project({ requestedTier: 2 }))).toBe(2)
		expect(projectTierId(project({ designStatus: PhaseStatus.in_review, requestedTier: 3 }))).toBe(3)
	})

	test("does not let a tier written before a decision shadow the request", () => {
		// What an imported row looks like: the old platform's Tier 1 in `tier`, the maker's Tier 2 request on top.
		expect(projectTierId(project({ requestedTier: 2, tier: 1 }))).toBe(2)
		expect(projectTierId(project({ designStatus: PhaseStatus.update_requested, requestedTier: 3, tier: 1 }))).toBe(3)
	})

	test("uses the reviewer's decision once the design is approved", () => {
		expect(projectTierId(project({ designStatus: PhaseStatus.approved, requestedTier: 3, tier: 1 }))).toBe(1)
	})

	test("falls back to whichever column carries a value, then to the entry tier", () => {
		expect(projectTierId(project({ tier: 2 }))).toBe(2)
		expect(projectTierId(project({ designStatus: PhaseStatus.approved, requestedTier: 3 }))).toBe(3)
		expect(projectTierId(project({}))).toBe(ENTRY_TIER.id)
		expect(projectTierId(project({ requestedTier: 9, tier: 2 }))).toBe(2)
	})
})
