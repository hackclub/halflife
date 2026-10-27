import { describe, expect, test } from "bun:test"
import { Phase } from "@/lib/enums"
import { RESUBMISSIONS_COUNTED_FROM, resubmissionBudget } from "@/lib/resubmissions"

const DAY = 24 * 60 * 60 * 1000
const sincePolicy = (days: number, phase: Phase = Phase.DESIGN) => ({
	createdAt: new Date(RESUBMISSIONS_COUNTED_FROM + days * DAY),
	phase,
})
const beforePolicy = (days: number, phase: Phase = Phase.DESIGN) => ({
	createdAt: new Date(RESUBMISSIONS_COUNTED_FROM - days * DAY),
	phase,
})

describe("resubmissionBudget", () => {
	test("a phase with no hand-ins has both", () => {
		const budget = resubmissionBudget([], Phase.DESIGN)
		expect(budget).toEqual({ limit: 2, remaining: 2, used: 0 })
	})

	test("the first hand-in is free, and two resubmissions follow it", () => {
		expect(resubmissionBudget([sincePolicy(1)], Phase.DESIGN).used).toBe(0)
		expect(resubmissionBudget([sincePolicy(1), sincePolicy(2)], Phase.DESIGN).used).toBe(1)
		expect(resubmissionBudget([sincePolicy(1), sincePolicy(2), sincePolicy(3)], Phase.DESIGN).used).toBe(2)
		expect(
			resubmissionBudget([sincePolicy(1), sincePolicy(2), sincePolicy(3), sincePolicy(4)], Phase.DESIGN).remaining,
		).toBe(0)
	})

	test("history before the policy is grandfathered, but every hand-in after it is a resubmission", () => {
		expect(resubmissionBudget([beforePolicy(2), beforePolicy(1)], Phase.DESIGN).used).toBe(0)
		expect(resubmissionBudget([beforePolicy(2), sincePolicy(1)], Phase.DESIGN).used).toBe(1)
		expect(resubmissionBudget([beforePolicy(2), sincePolicy(1), sincePolicy(2)], Phase.DESIGN).used).toBe(2)
		expect(
			resubmissionBudget([beforePolicy(2), sincePolicy(1), sincePolicy(2), sincePolicy(3)], Phase.DESIGN).remaining,
		).toBe(0)
	})

	test("design and build keep separate budgets", () => {
		const submissions = [sincePolicy(1), sincePolicy(2), sincePolicy(3), sincePolicy(3, Phase.BUILD)]
		expect(resubmissionBudget(submissions, Phase.DESIGN).used).toBe(2)
		expect(resubmissionBudget(submissions, Phase.BUILD).used).toBe(0)
	})

	test("a hand-in at the exact start counts", () => {
		const atStart = { createdAt: new Date(RESUBMISSIONS_COUNTED_FROM), phase: Phase.DESIGN }
		expect(resubmissionBudget([atStart], Phase.DESIGN).used).toBe(0)
		expect(resubmissionBudget([atStart, atStart], Phase.DESIGN).used).toBe(1)
	})
})
