import { describe, expect, test } from "bun:test"
import { Phase } from "@/lib/enums"
import { phaseStatusUpdate, statusFor } from "@/lib/phase"

describe("statusFor / phaseStatusUpdate", () => {
	const project = { buildStatus: "draft", designStatus: "approved" } as const

	test("reads one phase off a row carrying both", () => {
		expect(statusFor(project, Phase.DESIGN)).toBe("approved")
		expect(statusFor(project, Phase.BUILD)).toBe("draft")
	})

	test("writes one phase's status", () => {
		expect(phaseStatusUpdate(Phase.DESIGN, "in_review")).toEqual({ designStatus: "in_review" })
		expect(phaseStatusUpdate(Phase.BUILD, "in_review")).toEqual({ buildStatus: "in_review" })
	})
})
