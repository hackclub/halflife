import { describe, expect, test } from "bun:test"
import { HoursSource, Phase } from "@/lib/enums"
import { journalMinutes, type ReviewShipInput, toAriShipInput } from "@/lib/review-ship"

const input: ReviewShipInput = {
	description: "A board",
	evidence: ["commits", "devlog"],
	external_id: "proj:design",
	maker: { email: "maker@example.com", name: "Maker", slack_id: "U123" },
	meta: {
		bom: [{ name: "RP2040", qty: 1, unit_usd: 1.2 }],
		grant_cap_cents: 10000,
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
})

describe("review phase payload", () => {
	test("design and build use the same external id format as Ari", () => {
		expect(input.meta.phase).toBe("design")
		expect(input.external_id.endsWith(":design")).toBe(true)
		expect(input.meta.phase === "build" ? Phase.BUILD : Phase.DESIGN).toBe(Phase.DESIGN)
	})
})
