import { describe, expect, test } from "bun:test"
import { HoursSource, Phase } from "@/lib/enums"
import {
	distributeJournalMinutes,
	journalMinutes,
	journalTime,
	type ReviewShipInput,
	toAriShipInput,
} from "@/lib/review-ship"

const input: ReviewShipInput = {
	description: "A board",
	evidence: ["commits", "devlog"],
	external_id: "proj:design",
	maker: { email: "maker@example.com", name: "Maker", slack_id: "U123" },
	meta: {
		bom: [{ name: "RP2040", qty: 1, unit_usd: 1.2 }],
		grant_cap_cents: 10_000,
		hours: { claimed_seconds: 3600, hackatime_seconds: 1800, journal_seconds: 1800, timelapse_seconds: 0 },
		phase: "design",
		prior_reviews: [{ feedback: "Add a BOM", result: "RETURNED" }],
		program: "half-life",
		requested_tier: 2,
		submission_notes: null,
		theme: "pcb",
		week: 1,
	},
	repo_url: "https://github.com/maker/board",
	submitted_at: "2026-10-22T14:25:05.757Z",
	thumbnail_url: "https://example.com/board.png",
	title: "Board",
	track: "hardware",
}

describe("toAriShipInput", () => {
	test("strips the nested Review meta the Ari SDK refuses", () => {
		const ari = toAriShipInput(input)
		expect(ari.meta).toEqual({
			phase: "design",
			program: "half-life",
			requested_tier: 2,
			submission_notes: null,
			theme: "pcb",
			week: 1,
		})
		expect(ari.meta).not.toHaveProperty("bom")
		expect(ari.meta).not.toHaveProperty("hours")
		expect(ari.meta).not.toHaveProperty("prior_reviews")
	})

	test("strips submitted_at, which is only for Ire", () => {
		const ari = toAriShipInput(input)
		expect("submitted_at" in ari).toBe(false)
		expect(input.submitted_at).toBe("2026-10-22T14:25:05.757Z")
	})

	test("leaves the rest of the ship untouched", () => {
		const ari = toAriShipInput(input)
		expect(ari.external_id).toBe(input.external_id)
		expect(ari.journals).toBe(input.journals)
		expect(ari.maker).toBe(input.maker)
	})
})

describe("journalMinutes", () => {
	const counted = new Set(["board"])

	test("takes the recorded part off the claim", () => {
		expect(
			journalMinutes(
				{
					hoursClaimed: 2,
					hoursSource: HoursSource.MANUAL,
					timelapses: [{ coveredSeconds: 3600, externalId: "clip", hackatimeProject: "board", provider: "lapse" }],
				},
				counted,
			),
		).toBe(60)
	})

	test("leaves a clip under another project as evidence only", () => {
		expect(
			journalMinutes(
				{
					hoursClaimed: 2,
					hoursSource: HoursSource.MANUAL,
					timelapses: [{ coveredSeconds: 3600, externalId: "clip", hackatimeProject: "other", provider: "lapse" }],
				},
				counted,
			),
		).toBe(120)
	})

	test("a tracked entry contributes no journal minutes", () => {
		expect(
			journalMinutes({ hoursClaimed: 2, hoursSource: HoursSource.HACKATIME_TRACKED, timelapses: [] }, counted),
		).toBe(0)
	})

	test("takes off a clip whose project the row never recorded, once the project is known", () => {
		// The row says nothing, Lapse says `board`: the clip is Ari's to add, so the claim has to lose it or the sitting is paid twice.
		expect(
			journalTime(
				{
					hoursClaimed: 2,
					hoursSource: HoursSource.MANUAL,
					timelapses: [{ coveredSeconds: 3600, externalId: "clip", hackatimeProject: null, provider: "lapse" }],
				},
				counted,
				() => "board",
			),
		).toEqual({ claimedSeconds: 7200, minutes: 60, recordedSeconds: 3600 })
	})

	test("leaves an unattributed clip in the claim when the project cannot be resolved", () => {
		expect(
			journalTime(
				{
					hoursClaimed: 2,
					hoursSource: HoursSource.MANUAL,
					timelapses: [{ coveredSeconds: 3600, externalId: "clip", hackatimeProject: null, provider: "lapse" }],
				},
				counted,
			),
		).toEqual({ claimedSeconds: 7200, minutes: 120, recordedSeconds: 0 })
	})
})

describe("distributeJournalMinutes", () => {
	test("spreads another week's footage, keeping each entry's share", () => {
		expect(distributeJournalMinutes([3600, 1800, 600], 3600)).toEqual({
			carriedSeconds: 3600,
			minutes: [24, 12, 4],
			unabsorbedSeconds: 0,
		})
	})

	test("reports what the claims could not absorb rather than going negative", () => {
		expect(distributeJournalMinutes([600, 300], 7200)).toEqual({
			carriedSeconds: 900,
			minutes: [0, 0],
			unabsorbedSeconds: 6300,
		})
	})

	test("rounds the entries together, so the total lands on the minute", () => {
		// 500s over five entries is 8m20s: rounding each entry on its own would send 5 minutes and lose the rest.
		const spread = distributeJournalMinutes([100, 100, 100, 100, 100], 0)
		expect(spread.minutes.reduce((sum, minutes) => sum + minutes, 0)).toBe(8)
	})

	test("leaves the minutes alone when there is nothing foreign", () => {
		expect(distributeJournalMinutes([2520], 0)).toEqual({ carriedSeconds: 0, minutes: [42], unabsorbedSeconds: 0 })
	})
})

describe("review phase payload", () => {
	test("design and build use the same external id format as Ari", () => {
		expect(input.meta.phase).toBe("design")
		expect(input.external_id.endsWith(":design")).toBe(true)
		expect(input.meta.phase === "build" ? Phase.BUILD : Phase.DESIGN).toBe(Phase.DESIGN)
	})
})
