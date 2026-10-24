import { describe, expect, test } from "bun:test"
import {
	projectReviewState,
	REVIEW_STATUS_DOT,
	REVIEW_STATUS_TEXT,
	reviewChipTone,
	reviewTone,
} from "@/lib/review-state"

describe("projectReviewState", () => {
	test("attention wins: rejected, then changes, then pending", () => {
		expect(projectReviewState("rejected", "approved")).toBe("rejected")
		expect(projectReviewState("approved", "update_requested")).toBe("changes")
		expect(projectReviewState("draft", "in_review")).toBe("pending")
	})

	test("otherwise follows the current phase", () => {
		expect(projectReviewState("approved", "draft")).toBe("approved")
		expect(projectReviewState("approved", "approved")).toBe("approved")
		expect(projectReviewState("draft", "draft")).toBe("not_started")
		expect(projectReviewState("in_review", "approved")).toBe("pending")
	})
})

describe("reviewTone / reviewChipTone / labels", () => {
	test("colours each state once", () => {
		expect(reviewTone("rejected", "draft")).toBe("coral")
		expect(reviewTone("update_requested", "draft")).toBe("orange")
		expect(reviewTone("draft", "in_review")).toBe("sky")
		expect(reviewTone("approved", "approved")).toBe("teal")
		expect(reviewTone("draft", "draft")).toBe("line")
	})

	test("maps every status to a chip tone", () => {
		expect(reviewChipTone("approved")).toBe("teal")
		expect(reviewChipTone("in_review")).toBe("sky")
		expect(reviewChipTone("update_requested")).toBe("gold")
		expect(reviewChipTone("rejected")).toBe("coral")
		expect(reviewChipTone("draft")).toBe("muted")
	})

	test("says each status in plain words", () => {
		expect(REVIEW_STATUS_TEXT.draft).toBe("not started")
		expect(REVIEW_STATUS_TEXT.update_requested).toBe("needs changes")
		expect(REVIEW_STATUS_DOT.approved).toBe("bg-teal")
	})
})
