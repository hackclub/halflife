import { describe, expect, test } from "bun:test"
import { Phase } from "@/lib/enums"
import { RESUBMISSIONS_COUNTED_FROM, submissionBudget } from "@/lib/resubmissions"

const DAY = 24 * 60 * 60 * 1000
const sincePolicy = (days: number, phase: Phase = Phase.DESIGN) => ({
	createdAt: new Date(RESUBMISSIONS_COUNTED_FROM + days * DAY),
	phase,
})
const beforePolicy = (days: number, phase: Phase = Phase.DESIGN) => ({
	createdAt: new Date(RESUBMISSIONS_COUNTED_FROM - days * DAY),
	phase,
})

describe("submissionBudget", () => {
	test("a phase that has never been submitted has all three", () => {
		expect(submissionBudget([], Phase.DESIGN)).toEqual({
			limit: 3,
			remaining: 3,
			resubmissions: 0,
			submitted: false,
			used: 0,
		})
	})

	test("the first submission counts as one, then two resubmissions follow it", () => {
		expect(submissionBudget([sincePolicy(1)], Phase.DESIGN)).toMatchObject({ remaining: 2, used: 1 })
		expect(submissionBudget([sincePolicy(1), sincePolicy(2)], Phase.DESIGN)).toMatchObject({
			remaining: 1,
			used: 2,
		})
		expect(submissionBudget([sincePolicy(1), sincePolicy(2), sincePolicy(3)], Phase.DESIGN)).toMatchObject({
			remaining: 0,
			used: 3,
		})
		expect(
			submissionBudget([sincePolicy(1), sincePolicy(2), sincePolicy(3), sincePolicy(4)], Phase.DESIGN),
		).toMatchObject({ remaining: 0, used: 3 })
	})

	test("history before the policy stands as the first submission, with the two resubmissions intact", () => {
		expect(submissionBudget([beforePolicy(2), beforePolicy(1)], Phase.DESIGN)).toMatchObject({
			remaining: 2,
			resubmissions: 0,
			submitted: true,
			used: 1,
		})
		expect(submissionBudget([beforePolicy(2), sincePolicy(1)], Phase.DESIGN)).toMatchObject({
			remaining: 1,
			resubmissions: 1,
			used: 2,
		})
		expect(submissionBudget([beforePolicy(2), sincePolicy(1), sincePolicy(2)], Phase.DESIGN)).toMatchObject({
			remaining: 0,
			resubmissions: 2,
			used: 3,
		})
	})

	test("design and build keep separate budgets", () => {
		const submissions = [sincePolicy(1), sincePolicy(2), sincePolicy(3), sincePolicy(3, Phase.BUILD)]
		expect(submissionBudget(submissions, Phase.DESIGN)).toMatchObject({ remaining: 0, used: 3 })
		expect(submissionBudget(submissions, Phase.BUILD)).toMatchObject({ remaining: 2, used: 1 })
	})

	test("a hand-in at the exact start counts", () => {
		const atStart = { createdAt: new Date(RESUBMISSIONS_COUNTED_FROM), phase: Phase.DESIGN }
		expect(submissionBudget([atStart], Phase.DESIGN).used).toBe(1)
		expect(submissionBudget([atStart, atStart], Phase.DESIGN).used).toBe(2)
	})
})
