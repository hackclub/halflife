import { describe, expect, test } from "bun:test"
import {
	alternateTrackingJustification,
	NO_FEATURES_RECORDED,
	reviewerTechnicalFeaturesCell,
} from "@/lib/airtable/justification"

describe("alternateTrackingJustification", () => {
	test("names the devlogs as the method and the hours they claim", () => {
		expect(alternateTrackingJustification({ claimedHours: 12.5, entryCount: 3 })).toBe(
			"No Hackatime projects or Lapse timelapses were linked. The time comes from 3 devlog entries (12.5h claimed).",
		)
	})

	test("uses the singular for one entry", () => {
		expect(alternateTrackingJustification({ claimedHours: 2, entryCount: 1 })).toBe(
			"No Hackatime projects or Lapse timelapses were linked. The time comes from 1 devlog entry (2h claimed).",
		)
	})

	test("says so when there are no devlog entries either", () => {
		expect(alternateTrackingJustification({ claimedHours: null, entryCount: 0 })).toBe(
			"No Hackatime projects or Lapse timelapses were linked. No devlog entries were recorded either.",
		)
	})
})

describe("reviewerTechnicalFeaturesCell", () => {
	test("writes the reviewer's own account, and nothing else", () => {
		expect(reviewerTechnicalFeaturesCell("KiCad PCB and QMK firmware.")).toBe("KiCad PCB and QMK firmware.")
		expect(reviewerTechnicalFeaturesCell("  KiCad PCB and QMK firmware.  ")).toBe("KiCad PCB and QMK firmware.")
	})

	test("empty or absent reviewer text writes the never-empty marker", () => {
		expect(reviewerTechnicalFeaturesCell("")).toBe(NO_FEATURES_RECORDED)
		expect(reviewerTechnicalFeaturesCell("   ")).toBe(NO_FEATURES_RECORDED)
		expect(reviewerTechnicalFeaturesCell(null)).toBe(NO_FEATURES_RECORDED)
	})
})
