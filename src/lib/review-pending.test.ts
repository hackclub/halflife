import { describe, expect, test } from "bun:test"
import { Phase, PhaseStatus } from "@/lib/enums"
import { type PendingReviewProject, type PendingReviewShip, selectPendingReviewShips } from "@/lib/review-pending"

const project: PendingReviewProject = {
	buildStatus: PhaseStatus.draft,
	designStatus: PhaseStatus.in_review,
	id: "p1",
}

const submission = {
	createdAt: new Date("2026-11-01T10:00:00Z"),
	id: "s1",
	phase: Phase.DESIGN,
	themeProjectId: "p1",
}

function ship(over: Partial<PendingReviewShip> = {}): PendingReviewShip {
	return {
		closedAt: null,
		decision: null,
		lastError: null,
		lastSubmissionId: "s1",
		phase: Phase.DESIGN,
		remoteId: "sub_1",
		themeProjectId: "p1",
		...over,
	}
}

describe("selectPendingReviewShips", () => {
	test("a hand-in with no ship is pending", () => {
		expect(selectPendingReviewShips([project], [submission], [])).toEqual([
			{ phase: Phase.DESIGN, reason: null, themeProjectId: "p1" },
		])
	})

	test("a healthy current ship is not pending", () => {
		expect(selectPendingReviewShips([project], [submission], [ship()])).toEqual([])
	})

	test("a ship for an older hand-in is pending so the send path can replace it", () => {
		expect(selectPendingReviewShips([project], [submission], [ship({ lastSubmissionId: "s0" })])).toHaveLength(1)
	})

	test("a missing remote id is pending and keeps the recorded reason", () => {
		expect(
			selectPendingReviewShips([project], [submission], [ship({ lastError: "bad signature", remoteId: null })]),
		).toEqual([{ phase: Phase.DESIGN, reason: "bad signature", themeProjectId: "p1" }])
	})

	test("a closed ship is pending again while its phase is in review", () => {
		expect(selectPendingReviewShips([project], [submission], [ship({ closedAt: new Date() })])).toHaveLength(1)
	})

	test("a ship Review has already decided is never resent", () => {
		expect(
			selectPendingReviewShips([project], [submission], [ship({ closedAt: new Date(), decision: "approved" })]),
		).toEqual([])
	})

	test("a phase that has left review is not pending", () => {
		expect(
			selectPendingReviewShips(
				[{ ...project, designStatus: PhaseStatus.approved }],
				[submission],
				[ship({ remoteId: null })],
			),
		).toEqual([])
	})

	test("the newest open submission is the one that decides whether the phase is sent", () => {
		expect(
			selectPendingReviewShips(
				[project],
				[submission, { ...submission, createdAt: new Date("2026-11-02T10:00:00Z"), id: "s2" }],
				[ship({ lastSubmissionId: "s2" })],
			),
		).toEqual([])
	})
})
