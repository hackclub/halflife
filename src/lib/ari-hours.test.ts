import { describe, expect, test } from "bun:test"
import type { AriReview } from "@hackclub/ari"
import { approvedHoursFrom } from "@/lib/ari-hours"

function review(over: Partial<AriReview> = {}): AriReview {
	return { note_to_maker: "", reviewer: null, ...over }
}

describe("approvedHoursFrom", () => {
	test("takes a positive approved_hours figure", () => {
		expect(approvedHoursFrom(review({ approved_hours: 11.234 }))).toBe(11.23)
	})

	test("falls back to minutes when approved_hours is missing", () => {
		expect(approvedHoursFrom(review({ approved_minutes: 90 }))).toBe(1.5)
	})

	test("treats a zero approved_hours as no figure rather than approving nothing", () => {
		expect(approvedHoursFrom(review({ approved_hours: 0 }))).toBeNull()
	})

	test("still uses minutes when approved_hours is zero", () => {
		expect(approvedHoursFrom(review({ approved_hours: 0, approved_minutes: 600 }))).toBe(10)
	})

	test("treats zero minutes as no figure too", () => {
		expect(approvedHoursFrom(review({ approved_minutes: 0 }))).toBeNull()
	})

	test("refuses a figure above the programme ceiling", () => {
		expect(approvedHoursFrom(review({ approved_hours: 169 }))).toBeNull()
		expect(approvedHoursFrom(review({ approved_minutes: 169 * 60 }))).toBeNull()
	})
})
