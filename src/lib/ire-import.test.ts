import { describe, expect, test } from "bun:test"
import { ReviewResult } from "@/lib/enums"
import { fallbackReviewerEmail, mapReview } from "@/lib/ire-import"

const base = {
	createdAt: "2026-10-22 14:25:05.757",
	feedback: "Lovely board.",
	frozenApprovedHours: null as number | null,
	hoursOverride: null as number | null,
	invalidated: false,
	reason: null as string | null,
	result: ReviewResult.APPROVED,
	reviewerEmail: "ada@example.com" as string | null,
	reviewerName: "Ada" as string | null,
}

describe("mapReview", () => {
	test("maps an approved review with its frozen hours and UTC decision time", () => {
		const review = mapReview({ ...base, frozenApprovedHours: 12.5, reason: "Clear evidence." })

		expect(review).toEqual({
			decided_at: "2026-10-22T14:25:05.757Z",
			decision: "approved",
			hours_approved_seconds: 45000,
			internal_note: "Clear evidence.",
			note_to_maker: "Lovely board.",
			reviewer_email: "ada@example.com",
			reviewer_name: "Ada",
			stage: 1,
		})
	})

	test("falls back to the override hours when nothing was frozen", () => {
		const review = mapReview({ ...base, hoursOverride: 3 })

		expect(review?.hours_approved_seconds).toBe(10800)
	})

	test("maps returned and rejected decisions", () => {
		expect(mapReview({ ...base, result: ReviewResult.RETURNED })?.decision).toBe("changes")
		expect(mapReview({ ...base, result: ReviewResult.REJECTED })?.decision).toBe("rejected")
	})

	test("attributes an unattributed review to the Ari fallback", () => {
		const review = mapReview({ ...base, reviewerEmail: null, reviewerName: null })

		expect(review?.reviewer_email).toBe(fallbackReviewerEmail)
		expect(review?.reviewer_name).toBe("Ari")
	})

	test("drops an invalidated review", () => {
		expect(mapReview({ ...base, invalidated: true })).toBeNull()
	})
})
