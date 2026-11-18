import { describe, expect, test } from "bun:test"
import { fundingGivenTargetUsd, paidCentsFromSources } from "@/lib/funding-given"

const none = { bufferCents: 0, cardCents: 0, exportCents: 0, topUpCents: 0 }

describe("paidCentsFromSources", () => {
	test("a project with no payment is worth nothing", () => {
		expect(paidCentsFromSources(none)).toBe(0)
	})

	test("the largest source is the total, so one payment recorded twice counts once", () => {
		expect(paidCentsFromSources({ ...none, cardCents: 6432, exportCents: 6432 })).toBe(6432)
		expect(paidCentsFromSources({ ...none, cardCents: 3000, exportCents: 4171 })).toBe(4171)
	})

	test("a top-up larger than the card is the total", () => {
		expect(paidCentsFromSources({ ...none, bufferCents: 200, cardCents: 3000, topUpCents: 3500 })).toBe(3500)
	})
})

describe("fundingGivenTargetUsd", () => {
	test("a payment becomes the value", () => {
		expect(fundingGivenTargetUsd(0, 6432)).toBe(64.32)
	})

	test("an existing value is never lowered", () => {
		expect(fundingGivenTargetUsd(95, 6432)).toBe(95)
		expect(fundingGivenTargetUsd(10, 0)).toBe(10)
	})

	test("cents round to whole dollars and cents", () => {
		expect(fundingGivenTargetUsd(0, 1235)).toBe(12.35)
	})
})
