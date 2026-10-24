import { describe, expect, test } from "bun:test"
import { Theme } from "@/lib/enums"
import type { OnboardingStateData } from "@/lib/onboarding-view"
import { toOnboardingView } from "@/lib/onboarding-view"

function state(overrides: Partial<OnboardingStateData> = {}): OnboardingStateData {
	return {
		completed: false,
		experience: null,
		project: {
			description: null,
			id: "proj_1",
			requestedTier: null,
			starterProjectId: null,
			tierLocked: false,
			title: "My board",
		},
		reached: 0,
		starterProjects: [],
		stepCount: 5,
		suggestedTier: 1,
		theme: Theme.PCB,
		trackingDismissed: false,
		...overrides,
	}
}

describe("toOnboardingView", () => {
	test("fills the view from state", () => {
		const view = toOnboardingView(state())
		expect(view.projectId).toBe("proj_1")
		expect(view.project.description).toBe("")
		expect(view.suggestedTier).toBe(1)
		expect(view.stepCount).toBe(5)
		expect(view.steps.length).toBeGreaterThan(0)
		expect(view.weekIntro?.painting).toBe(Theme.PCB)
	})

	test("falls back to empty text and no intro for unknown data", () => {
		const view = toOnboardingView(state({ project: { ...state().project, description: "hi" }, theme: "NOPE" as Theme }))
		expect(view.project.description).toBe("hi")
		expect(view.weekIntro).toBeNull()
	})
})
