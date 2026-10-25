import { describe, expect, test } from "bun:test"
import { MAX_APPROVED_HOURS } from "@/lib/config/program"
import { Phase, ReviewResult } from "@/lib/enums"
import { decisionSchema, hoursDecisionSchema, overrideSchema, reviewQueueQuery } from "@/lib/schemas/review"

describe("decisionSchema", () => {
	test("approving needs nothing, returning needs feedback, rejecting needs both", () => {
		const approved = decisionSchema.safeParse({ result: ReviewResult.APPROVED })
		expect(approved.success).toBe(true)
		if (approved.success) expect(approved.data.feedback).toBe("")
		expect(decisionSchema.safeParse({ result: ReviewResult.RETURNED }).success).toBe(false)
		expect(decisionSchema.safeParse({ feedback: "fix this", result: ReviewResult.RETURNED }).success).toBe(true)
		expect(decisionSchema.safeParse({ feedback: "x", result: ReviewResult.REJECTED }).success).toBe(false)
		expect(decisionSchema.safeParse({ feedback: "x", reason: "y", result: ReviewResult.REJECTED }).success).toBe(true)
	})

	test("overrides stay within the ceiling", () => {
		expect(
			decisionSchema.safeParse({ hoursOverride: MAX_APPROVED_HOURS + 1, result: ReviewResult.APPROVED }).success,
		).toBe(false)
		expect(decisionSchema.safeParse({ grantUsdOverride: 501, result: ReviewResult.APPROVED }).success).toBe(false)
		expect(decisionSchema.safeParse({ result: ReviewResult.APPROVED, tier: 2 }).success).toBe(true)
		expect(decisionSchema.safeParse({ result: ReviewResult.APPROVED, tier: 9 }).success).toBe(false)
	})
})

describe("hoursDecisionSchema", () => {
	const session = { hoursApproved: 2, id: "s1", kind: "session" } as const
	const hackatime = { hoursApproved: 3, id: "h1", kind: "hackatime" } as const

	test("batches session and Hackatime approvals", () => {
		expect(hoursDecisionSchema.safeParse({ decisions: [session, hackatime] }).success).toBe(true)
		expect(hoursDecisionSchema.safeParse({ decisions: [] }).success).toBe(false)
		expect(hoursDecisionSchema.safeParse({ decisions: [{ ...session, hoursApproved: 16 }] }).success).toBe(false)
		expect(hoursDecisionSchema.safeParse({ decisions: [{ ...session, kind: "nope" }] }).success).toBe(false)
	})

	test("caps the batch at a hundred", () => {
		const decisions = Array.from({ length: 101 }, (_, i) => ({ ...session, id: `s${i}` }))
		expect(hoursDecisionSchema.safeParse({ decisions }).success).toBe(false)
	})
})

describe("reviewQueueQuery / overrideSchema", () => {
	test("extends the shared pagination shape", () => {
		const parsed = reviewQueueQuery.safeParse({ limit: "10" })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data.limit).toBe(10)
		expect(reviewQueueQuery.safeParse({ cursor: "" }).success).toBe(false)
		expect(reviewQueueQuery.safeParse({ limit: 101 }).success).toBe(false)
	})

	test("overrides name a phase and a reason", () => {
		expect(overrideSchema.safeParse({ phase: Phase.DESIGN, reason: "why" }).success).toBe(true)
		expect(overrideSchema.safeParse({ phase: Phase.DESIGN }).success).toBe(false)
	})
})
