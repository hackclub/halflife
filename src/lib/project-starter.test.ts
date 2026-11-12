import { describe, expect, test } from "bun:test"
import { PhaseStatus, Theme } from "@/lib/enums"
import { type StarterTarget, starterProblem } from "@/lib/project-starter"

const starbie = "starbie"

function target(overrides: Partial<StarterTarget> = {}): StarterTarget {
	return {
		designStatus: PhaseStatus.approved,
		requestedTier: 1,
		theme: Theme.PCB,
		tier: 1,
		...overrides,
	}
}

describe("starter project admin changes", () => {
	test("a Tier 1 PCB project can take the Starbie starter", () => {
		expect(starterProblem(target(), starbie)).toBeNull()
	})

	test("clearing a starter is always allowed", () => {
		expect(starterProblem(target({ requestedTier: 2, tier: 2 }), null)).toBeNull()
	})

	test("a starter from another week is refused", () => {
		expect(starterProblem(target({ theme: Theme.CAD }), starbie)).toBe(
			"That starter is not offered on this project's week",
		)
	})

	test("an unknown starter is refused", () => {
		expect(starterProblem(target(), "nope")).toBe("That starter is not offered on this project's week")
	})

	test("an approved project is judged by its approved tier, not its request", () => {
		expect(starterProblem(target({ requestedTier: 1, tier: 2 }), starbie)).toBe("A starter project has to be Tier 1")
		expect(starterProblem(target({ requestedTier: 3, tier: 1 }), starbie)).toBeNull()
	})

	test("an unapproved project is judged by its requested tier", () => {
		const draft = { designStatus: PhaseStatus.in_review }
		expect(starterProblem(target({ ...draft, requestedTier: 2, tier: null }), starbie)).toBe(
			"A starter project has to be Tier 1",
		)
		expect(starterProblem(target({ ...draft, requestedTier: 1, tier: 3 }), starbie)).toBeNull()
	})

	test("a project with no tier at all is refused", () => {
		expect(starterProblem(target({ requestedTier: null, tier: null }), starbie)).toBe(
			"A starter project has to be Tier 1",
		)
	})
})
