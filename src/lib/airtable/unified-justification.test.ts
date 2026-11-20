import { describe, expect, test } from "bun:test"
import { type UnifiedJustificationColumns, unifiedJustification } from "@/lib/airtable/unified-justification"

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
