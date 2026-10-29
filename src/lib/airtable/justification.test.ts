import { describe, expect, test } from "bun:test"
import { alternateTrackingJustification } from "@/lib/airtable/justification"

describe("alternateTrackingJustification", () => {
	test("names the devlogs as the method and the hours they claim", () => {
		expect(alternateTrackingJustification({ claimedHours: 12.5, entryCount: 3, reviewerText: null })).toBe(
			"No Hackatime projects or Lapse timelapses were linked. The time comes from 3 devlog entries (12.5h claimed).",
		)
	})

	test("uses the singular for one entry", () => {
		expect(alternateTrackingJustification({ claimedHours: 2, entryCount: 1, reviewerText: null })).toBe(
			"No Hackatime projects or Lapse timelapses were linked. The time comes from 1 devlog entry (2h claimed).",
		)
	})

	test("says so when there are no devlog entries either", () => {
		expect(alternateTrackingJustification({ claimedHours: null, entryCount: 0, reviewerText: null })).toBe(
			"No Hackatime projects or Lapse timelapses were linked. No devlog entries were recorded either.",
		)
	})

	test("appends the reviewer's reasoning, which is how the entries account for the time", () => {
		expect(
			alternateTrackingJustification({
				claimedHours: 9,
				entryCount: 4,
				reviewerText: "  The entries match the commit history across four days.  ",
			}),
		).toBe(
			"No Hackatime projects or Lapse timelapses were linked. The time comes from 4 devlog entries (9h claimed). Reviewer's justification: The entries match the commit history across four days.",
		)
	})
})
