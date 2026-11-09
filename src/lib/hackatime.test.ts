import { describe, expect, test } from "bun:test"
import { Phase, Theme } from "@/lib/enums"
import { phaseWeekWindowSeconds, projectSecondsFrom, projectsByName } from "@/lib/hackatime"

describe("projectSecondsFrom", () => {
	test("adds every entry Hackatime lists under one name", () => {
		const body = {
			data: {
				projects: [
					{ name: "Other", total_seconds: 1260 },
					{ name: "stasis", total_seconds: 3600 },
					{ name: "Other", total_seconds: 540 },
				],
			},
		}
		expect(projectSecondsFrom(body, "Other")).toEqual({ seconds: 1800, stale: false })
	})

	test("a name missing from the list is not a fresh zero", () => {
		const body = { data: { projects: [{ name: "stasis", total_seconds: 3600 }] } }
		expect(projectSecondsFrom(body, "Other")).toMatchObject({ notFound: true, seconds: 0, stale: true })
	})
})

describe("projectsByName", () => {
	test("keeps one entry per project name, adding the time under it", () => {
		expect(
			projectsByName([
				{ name: "Other", total_seconds: 1260 },
				{ name: "stasis", total_seconds: 3600 },
				{ name: "Other", total_seconds: 0 },
			]),
		).toEqual([
			{ name: "Other", totalSeconds: 1260 },
			{ name: "stasis", totalSeconds: 3600 },
		])
	})

	test("leaves an already-unique list in order", () => {
		expect(
			projectsByName([
				{ name: "b", total_seconds: 2 },
				{ name: "a", total_seconds: 1 },
			]),
		).toEqual([
			{ name: "b", totalSeconds: 2 },
			{ name: "a", totalSeconds: 1 },
		])
	})
})

describe("phaseWeekWindowSeconds", () => {
	const monday = new Date("2026-09-14T00:00:00Z")
	const settings = { eventStartDate: monday, programTimezone: "UTC" }

	test("the start is the Monday the week opens on, and the end is Sunday 11:59PM", () => {
		expect(phaseWeekWindowSeconds(settings, Theme.PCB, Phase.DESIGN, {})).toEqual({
			fromSeconds: 1789344000,
			toSeconds: 1789948740,
		})
	})

	test("a phase with no week in the calendar has no window", () => {
		expect(phaseWeekWindowSeconds(settings, Theme.WARMUP, Phase.DESIGN, {})).toBeNull()
	})

	test("an extension past the scheduled Sunday widens the window", () => {
		expect(
			phaseWeekWindowSeconds(settings, Theme.PCB, Phase.DESIGN, {
				userUntil: new Date("2026-09-24T23:59:00Z"),
			}),
		).toEqual({ fromSeconds: 1789344000, toSeconds: 1790294340 })
	})

	test("an extension that is shorter than the scheduled close does not shrink it", () => {
		expect(
			phaseWeekWindowSeconds(settings, Theme.PCB, Phase.DESIGN, {
				projectUntil: new Date("2026-09-15T23:59:00Z"),
			}),
		).toEqual({ fromSeconds: 1789344000, toSeconds: 1789948740 })
	})

	test("the latest of the three extensions wins", () => {
		expect(
			phaseWeekWindowSeconds(settings, Theme.PCB, Phase.DESIGN, {
				projectUntil: new Date("2026-09-24T23:59:00Z"),
				userUntil: new Date("2026-09-22T23:59:00Z"),
				weekUntil: new Date("2026-09-21T23:59:00Z"),
			}),
		).toEqual({ fromSeconds: 1789344000, toSeconds: 1790294340 })
	})
})
