import { describe, expect, test } from "bun:test"
import {
	getThemeDef,
	MAX_WARMUP_PROJECTS,
	projectDisplayTitle,
	scheduledWeekFor,
	scheduleForWeek,
	themeForDesignWeek,
} from "@/lib/config/program"
import { Phase, Theme } from "@/lib/enums"

describe("getThemeDef", () => {
	test("reads a theme and rejects the unknown", () => {
		expect(getThemeDef(Theme.PCB).label).toBe("PCBs")
		expect(() => getThemeDef("NOPE" as Theme)).toThrow("Unknown theme: NOPE")
	})

	test("warm-up projects are capped", () => {
		expect(MAX_WARMUP_PROJECTS).toBe(3)
	})
})

describe("projectDisplayTitle", () => {
	test("falls back to the week's label for a blank title", () => {
		expect(projectDisplayTitle({ theme: Theme.PCB, title: "" })).toBe("PCBs")
		expect(projectDisplayTitle({ theme: Theme.PCB, title: "  Mine  " })).toBe("Mine")
	})
})

describe("schedule", () => {
	test("maps weeks to theme and phase", () => {
		expect(scheduleForWeek(1)?.theme.id).toBe(Theme.PCB)
		expect(scheduleForWeek(1)?.phase).toBe(Phase.DESIGN)
		expect(scheduleForWeek(6)?.phase).toBe(Phase.BUILD)
		expect(scheduleForWeek(99)).toBeNull()
	})

	test("inverts the schedule both ways", () => {
		expect(scheduledWeekFor(Theme.PCB, Phase.DESIGN)).toBe(1)
		expect(scheduledWeekFor(Theme.PCB, Phase.BUILD)).toBe(6)
		expect(themeForDesignWeek(1)).toBe(Theme.PCB)
		expect(themeForDesignWeek(6)).toBeNull()
	})
})
