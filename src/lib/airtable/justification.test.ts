import { describe, expect, test } from "bun:test"
import {
	additionalJustificationCell,
	alternateTrackingJustification,
	NO_FEATURES_RECORDED,
	reviewerTechnicalFeaturesCell,
} from "@/lib/airtable/justification"
import { RESEARCH_TIME_STATEMENT } from "@/lib/airtable/research-statement"

const url = "https://halflife.hackclub.com/projects/prj_1"

describe("additionalJustificationCell", () => {
	test("puts the statement after the reviewer's note and the link after the statement", () => {
		expect(additionalJustificationCell("Solid PCB work.", url)).toBe(
			`Solid PCB work.\n\n${RESEARCH_TIME_STATEMENT}\n\nProject on Half Life: ${url}`,
		)
	})

	test("trims the note before adding the statement and the link", () => {
		expect(additionalJustificationCell("  Solid PCB work.  \n", url)).toBe(
			`Solid PCB work.\n\n${RESEARCH_TIME_STATEMENT}\n\nProject on Half Life: ${url}`,
		)
	})

	test("a cleared or blank note leaves the statement and the link", () => {
		expect(additionalJustificationCell(null, url)).toBe(`${RESEARCH_TIME_STATEMENT}\n\nProject on Half Life: ${url}`)
		expect(additionalJustificationCell("   ", url)).toBe(`${RESEARCH_TIME_STATEMENT}\n\nProject on Half Life: ${url}`)
	})

	test("with no origin configured the cell ends at the statement", () => {
		expect(additionalJustificationCell("Solid PCB work.", "")).toBe(`Solid PCB work.\n\n${RESEARCH_TIME_STATEMENT}`)
		expect(additionalJustificationCell(null, "")).toBe(RESEARCH_TIME_STATEMENT)
	})

	test("a note that already carries the statement does not get it twice", () => {
		expect(additionalJustificationCell(`Solid PCB work.\n\n${RESEARCH_TIME_STATEMENT}`, url)).toBe(
			`Solid PCB work.\n\n${RESEARCH_TIME_STATEMENT}\n\nProject on Half Life: ${url}`,
		)
	})
})

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
