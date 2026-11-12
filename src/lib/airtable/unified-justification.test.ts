import { describe, expect, test } from "bun:test"
import {
	NO_FEATURES_RECORDED,
	previewUnifiedJustification,
	type UnifiedJustificationColumns,
	unifiedJustification,
} from "@/lib/airtable/unified-justification"

const empty: UnifiedJustificationColumns = Object.freeze({
	additionalJustification: "",
	alternateTracking: "",
	deflationJustification: "",
	hackatimeId: "",
	hackatimeProjects: "",
	lapseLinks: "",
	overrideJustification: "",
	specificTechnicalFeatures: "",
})

describe("unifiedJustification", () => {
	// The shape of a real approved row's formula output, read from the base on 2026-11-11.
	test("matches the base's formula, including the space before the deflation text", () => {
		expect(
			unifiedJustification({
				...empty,
				additionalJustification: "On-topic timelapses.",
				deflationJustification: "Deflated from 7.11h claimed to 7.1h approved (0.01h removed).",
				hackatimeId: "69784",
				hackatimeProjects: "starbie (2026-10-05 to 2026-10-11)",
				lapseLinks: "https://lapse.hackclub.com/timelapse/a, https://lapse.hackclub.com/timelapse/b",
				specificTechnicalFeatures: "Starbie with a buzzer.",
			}),
		).toBe(
			"[HACKATIME]\nHackatime ID: 69784\nHackatime Projects: starbie (2026-10-05 to 2026-10-11)\nLapse Links: https://lapse.hackclub.com/timelapse/a, https://lapse.hackclub.com/timelapse/b\n\n[SPECIFIC TECHNICAL FEATURES]\nStarbie with a buzzer.\n\n[DEFLATION JUSTIFICATION]\n Deflated from 7.11h claimed to 7.1h approved (0.01h removed).\n\n[ADDITIONAL JUSTIFICATION]\nOn-topic timelapses.",
		)
	})

	test("keeps the Hackatime lines when they are empty, and drops the Lapse line", () => {
		expect(
			unifiedJustification({
				...empty,
				alternateTracking: "No Hackatime projects or Lapse timelapses were linked.",
				specificTechnicalFeatures: "A PCB.",
			}),
		).toBe(
			"[HACKATIME]\nHackatime ID: \nHackatime Projects: \n\n[SPECIFIC TECHNICAL FEATURES]\nA PCB.\n\n[ALTERNATE TRACKING METHOD]\nNo Hackatime projects or Lapse timelapses were linked.",
		)
	})

	test("an override justification replaces everything", () => {
		expect(unifiedJustification({ ...empty, hackatimeId: "1", overrideJustification: "Hand-written." })).toBe(
			"Hand-written.",
		)
	})
})

describe("previewUnifiedJustification", () => {
	const row = Object.freeze({
		alternateTracking: "",
		claimedHours: 10,
		hackatimeId: "1",
		hackatimeProjects: "",
		lapseLinks: "",
		overrideJustification: "",
	})

	test("prefers the deflation reason over the internal note for the cut", () => {
		const text = previewUnifiedJustification(row, {
			approvedHours: 8,
			deflationReason: "Capped at 8h.",
			internalNote: "Looks good.",
			technicalFeatures: "",
		})
		expect(text).toContain(
			"[DEFLATION JUSTIFICATION]\n Deflated from 10h claimed to 8h approved (2h removed). Capped at 8h.",
		)
		expect(text).toContain("[ADDITIONAL JUSTIFICATION]\nLooks good.")
		expect(text).toContain(`[SPECIFIC TECHNICAL FEATURES]\n${NO_FEATURES_RECORDED}`)
	})

	test("falls back to the internal note, and writes no deflation when nothing was cut", () => {
		const cut = previewUnifiedJustification(row, {
			approvedHours: 9,
			deflationReason: " ",
			internalNote: "Duplicate entry.",
			technicalFeatures: "x",
		})
		expect(cut).toContain("(1h removed). Duplicate entry.")
		const whole = previewUnifiedJustification(row, {
			approvedHours: 10,
			deflationReason: "ignored",
			internalNote: "",
			technicalFeatures: "x",
		})
		expect(whole).not.toContain("[DEFLATION JUSTIFICATION]")
		expect(whole).not.toContain("[ADDITIONAL JUSTIFICATION]")
	})
})
