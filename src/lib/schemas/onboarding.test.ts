import { describe, expect, test } from "bun:test"
import { HardwareExperience } from "@/lib/enums"
import { onboardingStepSchema } from "@/lib/schemas/onboarding"

describe("onboardingStepSchema", () => {
	test("each step carries only its own fields", () => {
		expect(
			onboardingStepSchema.safeParse({ experience: HardwareExperience.FIRST_TIME, step: "experience" }).success,
		).toBe(true)
		expect(onboardingStepSchema.safeParse({ step: "week" }).success).toBe(true)
		expect(onboardingStepSchema.safeParse({ description: "My board", step: "project", title: "Board" }).success).toBe(
			true,
		)
		expect(onboardingStepSchema.safeParse({ starterProjectId: null, step: "idea" }).success).toBe(true)
		expect(onboardingStepSchema.safeParse({ requestedTier: 2, step: "tier" }).success).toBe(true)
		expect(onboardingStepSchema.safeParse({ dismissed: true, step: "tracking" }).success).toBe(true)
		expect(onboardingStepSchema.safeParse({ enabled: false, step: "repo" }).success).toBe(true)
	})

	test("mixed-step payloads and out-of-range values fail", () => {
		expect(
			onboardingStepSchema.safeParse({ experience: HardwareExperience.FIRST_TIME, requestedTier: 1, step: "tier" })
				.success,
		).toBe(false)
		expect(onboardingStepSchema.safeParse({ requestedTier: 5, step: "tier" }).success).toBe(false)
		expect(onboardingStepSchema.safeParse({ requestedTier: 1.5, step: "tier" }).success).toBe(false)
		expect(onboardingStepSchema.safeParse({ enabled: true, repo: "not a repo", step: "repo" }).success).toBe(false)
		expect(onboardingStepSchema.safeParse({ enabled: true, repo: "github.com/me/repo", step: "repo" }).success).toBe(
			true,
		)
		expect(onboardingStepSchema.safeParse({ step: "nope" }).success).toBe(false)
	})
})
