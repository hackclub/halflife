import { describe, expect, test } from "bun:test"
import {
	alternateTrackingJustification,
	REVIEWER_FEATURES_SECTION,
	stripReviewerTechnicalFeatures,
	withReviewerTechnicalFeatures,
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

describe("withReviewerTechnicalFeatures", () => {
	test("keeps the maker's account and adds the reviewer's under its own heading", () => {
		expect(withReviewerTechnicalFeatures("A macropad with 8 keys.", "KiCad PCB and QMK firmware.")).toBe(
			`A macropad with 8 keys.\n\n${REVIEWER_FEATURES_SECTION}\nKiCad PCB and QMK firmware.`,
		)
	})

	test("replaces an earlier reviewer section instead of duplicating it", () => {
		const first = withReviewerTechnicalFeatures("Built from a kit.", "First account.")
		expect(withReviewerTechnicalFeatures(first, "Second account.")).toBe(
			`Built from a kit.\n\n${REVIEWER_FEATURES_SECTION}\nSecond account.`,
		)
	})

	test("removes the reviewer section when a decision no longer stands", () => {
		const withSection = withReviewerTechnicalFeatures("Built from a kit.", "Reviewer account.")
		expect(withReviewerTechnicalFeatures(withSection, null)).toBe("Built from a kit.")
	})

	test("adds the reviewer section to an empty maker account", () => {
		expect(withReviewerTechnicalFeatures("", "Reviewer account.")).toBe(
			`${REVIEWER_FEATURES_SECTION}\nReviewer account.`,
		)
	})
})

describe("stripReviewerTechnicalFeatures", () => {
	test("leaves a maker's text alone when it has no reviewer section", () => {
		expect(stripReviewerTechnicalFeatures("A maker's account.")).toBe("A maker's account.")
	})

	test("removes a reviewer section from the start of the cell", () => {
		expect(stripReviewerTechnicalFeatures(`${REVIEWER_FEATURES_SECTION}\nReviewer account.`)).toBe("")
	})
})
