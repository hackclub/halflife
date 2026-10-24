import { describe, expect, test } from "bun:test"
import { ParticipantGoal } from "@/lib/enums"
import { setGoalSchema } from "@/lib/schemas/goal"

describe("setGoalSchema", () => {
	test("takes a goal with or without a machine", () => {
		expect(setGoalSchema.safeParse({ goal: ParticipantGoal.PRINTER }).success).toBe(true)
		expect(setGoalSchema.safeParse({ goal: ParticipantGoal.FULL_FUNDING, printerGoalId: "ender-3" }).success).toBe(true)
	})

	test("rejects unknown goals, long ids and stray fields", () => {
		expect(setGoalSchema.safeParse({ goal: "nope" }).success).toBe(false)
		expect(setGoalSchema.safeParse({ goal: ParticipantGoal.PRINTER, printerGoalId: "x".repeat(81) }).success).toBe(
			false,
		)
		expect(setGoalSchema.safeParse({ extra: 1, goal: ParticipantGoal.PRINTER }).success).toBe(false)
		expect(setGoalSchema.safeParse({}).success).toBe(false)
	})
})
