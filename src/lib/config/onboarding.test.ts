import { describe, expect, test } from "bun:test"
import {
	EXPERIENCE_OPTIONS,
	getStarterProject,
	isBeginner,
	seesStarterProjects,
	starterProjectsFor,
	stepAt,
	stepIndexOf,
	suggestedTierFor,
	usesStarterDefaultDescription,
	weekIntroFor,
} from "@/lib/config/onboarding"
import { HardwareExperience, Theme } from "@/lib/enums"

describe("suggestedTierFor / isBeginner / seesStarterProjects", () => {
	test("suggests down for newcomers and up for veterans", () => {
		expect(suggestedTierFor(HardwareExperience.ITS_LIFE)).toBe(3)
		expect(suggestedTierFor(HardwareExperience.A_GOOD_AMOUNT)).toBe(2)
		expect(suggestedTierFor(HardwareExperience.A_LITTLE)).toBe(1)
		expect(suggestedTierFor(HardwareExperience.FIRST_TIME)).toBe(1)
		expect(suggestedTierFor(null)).toBe(1)
	})

	test("beginners include the unanswered", () => {
		expect(isBeginner(HardwareExperience.FIRST_TIME)).toBe(true)
		expect(isBeginner(HardwareExperience.A_LITTLE)).toBe(true)
		expect(isBeginner(null)).toBe(true)
		expect(isBeginner(HardwareExperience.ITS_LIFE)).toBe(false)
	})

	test("starter projects show only for the two new answers", () => {
		expect(seesStarterProjects(HardwareExperience.FIRST_TIME)).toBe(true)
		expect(seesStarterProjects(HardwareExperience.A_LITTLE)).toBe(true)
		expect(seesStarterProjects(HardwareExperience.ITS_LIFE)).toBe(false)
		expect(seesStarterProjects(null)).toBe(false)
	})

	test("every experience has an option", () => {
		expect(EXPERIENCE_OPTIONS.map(o => o.value).toSorted()).toEqual(
			[
				HardwareExperience.A_GOOD_AMOUNT,
				HardwareExperience.A_LITTLE,
				HardwareExperience.FIRST_TIME,
				HardwareExperience.ITS_LIFE,
			].toSorted(),
		)
	})
})

describe("starter projects", () => {
	test("filters by theme and reads back by id", () => {
		const [first] = starterProjectsFor(Theme.PCB)
		expect(first?.id).toBeDefined()
		expect(getStarterProject(first?.id ?? "")?.id).toBe(first?.id)
		expect(getStarterProject("nope")).toBeUndefined()
	})

	test("spots the untouched guide description", () => {
		const [first] = starterProjectsFor(Theme.PCB)
		const id = first?.id ?? ""
		expect(usesStarterDefaultDescription(id, first?.description ?? null)).toBe(true)
		expect(usesStarterDefaultDescription(id, `${first?.description ?? ""} extra`)).toBe(false)
		expect(usesStarterDefaultDescription(null, "x")).toBe(false)
		expect(usesStarterDefaultDescription("nope", "x")).toBe(false)
	})
})

describe("steps / week intros", () => {
	test("steps index by position and id", () => {
		expect(stepAt(0)?.id).toBe("experience")
		expect(stepIndexOf("tier")).toBe(4)
		expect(stepAt(99)).toBeUndefined()
	})

	test("reads week intros by theme", () => {
		expect(weekIntroFor(Theme.PCB)).toBeDefined()
		expect(weekIntroFor("NOPE" as Theme)).toBeUndefined()
	})
})
