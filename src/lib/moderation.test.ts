import { describe, expect, it } from "bun:test"
import { isSuspensionActive, penaltyFor } from "@/lib/moderation"
import { formatDbTimestamp } from "@/lib/time"

const inHours = (hours: number) => formatDbTimestamp(new Date(Date.now() + hours * 3_600_000))

describe("suspension timing", () => {
	it("is active until its own end, then stops binding", () => {
		expect(isSuspensionActive(inHours(1))).toBe(true)
		expect(isSuspensionActive(inHours(-1))).toBe(false)
	})

	it("treats a cleared suspension as absent", () => {
		expect(isSuspensionActive(null)).toBe(false)
		expect(isSuspensionActive(undefined)).toBe(false)
	})
})

describe("penaltyFor", () => {
	it("is none without either timestamp", () => {
		expect(penaltyFor(null, null)).toBe("none")
	})

	it("reads a live suspension", () => {
		expect(penaltyFor(null, inHours(3))).toBe("suspended")
	})

	it("lets an expired suspension go quiet rather than never lifting", () => {
		expect(penaltyFor(null, inHours(-3))).toBe("none")
	})

	it("always lets a ban win, even over a live suspension left on the row", () => {
		expect(penaltyFor(inHours(-10), inHours(3))).toBe("banned")
	})
})
