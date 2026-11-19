import { describe, expect, test } from "bun:test"
import { fundingChipTone, fundingState } from "@/lib/funding-state"

describe("fundingState", () => {
	test("an issued card is funded, whatever the unified check says", () => {
		expect(fundingState({ cardIssued: true, inUnified: true })).toBe("funded")
		expect(fundingState({ cardIssued: true, inUnified: false })).toBe("funded")
		expect(fundingState({ cardIssued: true, inUnified: null })).toBe("funded")
	})

	test("in the unified database but no card yet is awaiting funding", () => {
		expect(fundingState({ cardIssued: false, inUnified: true })).toBe("awaiting_funding")
	})

	test("not yet in the unified database is queued", () => {
		expect(fundingState({ cardIssued: false, inUnified: false })).toBe("queued")
	})

	test("claims no stage when the unified check could not run", () => {
		expect(fundingState({ cardIssued: false, inUnified: null })).toBeNull()
	})
})

describe("fundingChipTone", () => {
	test("queued is quiet, waiting is gold, funded is teal", () => {
		expect(fundingChipTone("queued")).toBe("muted")
		expect(fundingChipTone("awaiting_funding")).toBe("gold")
		expect(fundingChipTone("funded")).toBe("teal")
	})
})
