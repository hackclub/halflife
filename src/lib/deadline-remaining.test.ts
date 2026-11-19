import { describe, expect, test } from "bun:test"
import { formatRemaining, remainingTone } from "@/lib/deadline-remaining"

const NOW = new Date("2026-11-18T12:00:00Z")

describe("formatRemaining", () => {
	test("prints days and hours", () => {
		expect(formatRemaining(new Date("2026-11-21T16:00:00Z"), NOW)).toBe("in 3d 4h")
	})

	test("drops a zero hours part", () => {
		expect(formatRemaining(new Date("2026-11-20T12:00:00Z"), NOW)).toBe("in 2d")
	})

	test("prints hours and minutes under a day", () => {
		expect(formatRemaining(new Date("2026-11-18T17:30:00Z"), NOW)).toBe("in 5h 30m")
	})

	test("prints minutes under an hour", () => {
		expect(formatRemaining(new Date("2026-11-18T12:40:00Z"), NOW)).toBe("in 40m")
	})

	test("reads a spent deadline as expired", () => {
		expect(formatRemaining(new Date("2026-11-18T11:00:00Z"), NOW)).toBe("expired")
	})
})

describe("remainingTone", () => {
	test("marks under a day as danger", () => {
		expect(remainingTone(new Date("2026-11-19T11:00:00Z"), NOW)).toBe("danger")
	})

	test("marks under three days as warning", () => {
		expect(remainingTone(new Date("2026-11-20T12:00:00Z"), NOW)).toBe("warning")
	})

	test("leaves longer extensions quiet", () => {
		expect(remainingTone(new Date("2026-11-25T12:00:00Z"), NOW)).toBe("muted")
	})
})
