import { describe, expect, test } from "bun:test"
import {
	composeJustification,
	editBeforeTail,
	type JustificationInput,
	mergeEdits,
	signedJustification,
} from "@/lib/review-platform/justification"
import type { ReviewEntry } from "@/lib/review-platform/types"

const entry = (overrides: Partial<ReviewEntry>): ReviewEntry => ({
	approvedSeconds: null,
	bodyHtml: "",
	countsHours: true,
	date: "2026-11-02",
	id: "e1",
	imageUrls: [],
	reviewerNote: null,
	secondsSpent: 3600,
	timelapseSeconds: 0,
	timelapseUrls: [],
	title: "",
	...overrides,
})

const input = (overrides: Partial<JustificationInput>): JustificationInput => ({
	approvedAt: new Date("2026-11-20T19:05:00Z"),
	approvedHours: 3,
	claimedHours: 3,
	context: {
		hackatimeId: null,
		hackatimeProjects: [],
		intro: "This is the design submission of Clock for Half Life (PCB). Submitted November 3, 2026 at 10:00 EST.",
		journalingUrl: "https://halflife.test/docs/journalling",
		projectUrl: "https://halflife.test/projects/p1",
		repoLink: "https://github.com/maker/clock",
		signOff: "",
		submittingUrl: "https://halflife.test/docs/submitting",
		timeZone: "America/New_York",
	},
	entries: [],
	hackatimeHours: 0,
	reviewer: "sam",
	technicalFeatures: "",
	...overrides,
})

describe("composeJustification", () => {
	test("lists every entry the reviewer cut, with the note they gave", () => {
		const text = composeJustification(
			input({
				approvedHours: 2,
				claimedHours: 4,
				entries: [
					entry({
						approvedSeconds: 1800,
						id: "a",
						reviewerNote: "Mostly  research,\nnot design.",
						secondsSpent: 7200,
						title: "Routing",
					}),
					entry({ approvedSeconds: null, date: "2026-11-04", id: "b", secondsSpent: 3600 }),
					entry({ approvedSeconds: 1800, date: "2026-11-05", id: "c", secondsSpent: 3600 }),
				],
			}),
		)
		expect(text).toContain(
			"2.0 hours of deflation was applied:\n- Nov 2, 2026 Routing: 2.0h to 0.5h. Mostly research, not design.\n- Nov 5, 2026: 1.0h to 0.5h",
		)
		expect(text).toContain("Hours claimed: 4.0. Hours approved: 2.0.")
		expect(text).toContain(
			"- https://halflife.test/projects/p1#entry-a - Nov 2, 2026: Routing (claimed 2.0h, approved 0.5h)",
		)
		expect(text).toContain(
			"Time evidence: 3 journal entries from Nov 2, 2026 to Nov 5, 2026, 4.0h claimed, 2.0h counted after review.",
		)
		expect(text).not.toContain("set to")
	})

	test("says when nothing was cut", () => {
		expect(composeJustification(input({ entries: [entry({ secondsSpent: 3 * 3600 })] }))).toContain(
			"Hours claimed: 3.0. Hours approved: 3.0.\nNo deflation was applied.",
		)
	})

	test("says outright when the total was set by hand", () => {
		const text = composeJustification(input({ approvedHours: 1.5, entries: [entry({ secondsSpent: 3 * 3600 })] }))
		expect(text).toContain(
			"The approved total was set to 1.5h by the reviewer; the entries and Hackatime come to 3.0h.",
		)
	})

	test("counts Hackatime toward the totals and names the projects", () => {
		const text = composeJustification(
			input({
				approvedHours: 5,
				claimedHours: 5,
				context: { ...input({}).context, hackatimeId: "42", hackatimeProjects: ["clock-fw"] },
				entries: [entry({ countsHours: false, id: "h", secondsSpent: 0 }), entry({ id: "m", secondsSpent: 3600 })],
				hackatimeHours: 4,
			}),
		)
		expect(text).toContain("Hackatime: 4.0h tracked in clock-fw (Hackatime ID 42).")
		expect(text).toContain("#entry-h - Nov 2, 2026 (time counted through Hackatime)")
		expect(text).toContain("No deflation was applied.")
		expect(text).not.toContain("set to")
	})

	test("stamps the approval in the program's time zone", () => {
		expect(composeJustification(input({}))).toContain("This project was approved at November 20, 2026 at 14:05 EST")
	})
})

describe("signedJustification", () => {
	test("puts the sign-off after the reviewer's text", () => {
		expect(signedJustification("  Body.  ", "sam")).toMatch(
			/^Body\.\n\nThis project was reviewed and approved by @sam\./,
		)
	})
})

describe("mergeEdits", () => {
	test("keeps the reviewer's edit and picks up a line generated since", () => {
		const base = "Intro\nNo deflation was applied."
		const edited = "Intro, edited\nNo deflation was applied."
		const generated = "Intro\n1.0 hours of deflation was applied:\n- Nov 2, 2026: 2.0h to 1.0h"
		expect(mergeEdits(base, edited, generated)).toBe(
			"Intro, edited\n1.0 hours of deflation was applied:\n- Nov 2, 2026: 2.0h to 1.0h",
		)
	})

	test("is the generated text when nothing was edited", () => {
		expect(mergeEdits("a", "a", "b")).toBe("b")
	})
})

describe("editBeforeTail", () => {
	test("typing at the end of the body stays before the sign-off", () => {
		const tail = "\n\nSigned"
		const shown = `Body${tail}`
		expect(editBeforeTail(shown, `Body!${tail}`, 5, tail)).toEqual({ body: "Body!", caret: 5 })
	})

	test("typing inside the sign-off lands at the end of the body, leaving the sign-off as it was", () => {
		const tail = "\n\nSigned"
		const shown = `Body${tail}`
		expect(editBeforeTail(shown, "Body\n\nSXigned", 8, tail)).toEqual({ body: "BodyX", caret: 5 })
	})
})
