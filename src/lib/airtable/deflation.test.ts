import { describe, expect, test } from "bun:test"
import { deflationFor, deflationJustification, numberCell } from "@/lib/airtable/deflation"

describe("deflationFor", () => {
	test("reports the gap when a review approves fewer hours than the row claims", () => {
		expect(deflationFor(6, 20)).toEqual({ approvedHours: 6, claimedHours: 20, removedHours: 14 })
	})

	test("reports nothing when the claim was approved in full", () => {
		expect(deflationFor(20, 20)).toBeNull()
	})

	test("does not treat an approval above the claim as deflation", () => {
		expect(deflationFor(22, 20)).toBeNull()
	})

	test("ignores a difference that rounds away", () => {
		expect(deflationFor(9.999, 10)).toBeNull()
	})

	test("needs both figures", () => {
		expect(deflationFor(null, 20)).toBeNull()
		expect(deflationFor(6, null)).toBeNull()
	})
})

describe("deflationJustification", () => {
	test("states both figures even when the reviewer wrote nothing", () => {
		const deflation = deflationFor(6, 20)
		if (!deflation) throw new Error("expected deflation")
		expect(deflationJustification(deflation, null)).toBe("Deflated from 20h claimed to 6h approved (14h removed).")
	})

	test("appends the reviewer's own reason", () => {
		const deflation = deflationFor(10, 17.5)
		if (!deflation) throw new Error("expected deflation")
		expect(deflationJustification(deflation, "  The Starbie cap is 10h.  ")).toBe(
			"Deflated from 17.5h claimed to 10h approved (7.5h removed). The Starbie cap is 10h.",
		)
	})
})

describe("numberCell", () => {
	test("reads a number column and a formula's text alike", () => {
		expect(numberCell(14)).toBe(14)
		expect(numberCell("14.5")).toBe(14.5)
	})

	test("treats an empty or unreadable cell as no figure", () => {
		expect(numberCell(undefined)).toBeNull()
		expect(numberCell("")).toBeNull()
		expect(numberCell("n/a")).toBeNull()
		expect(numberCell(Number.NaN)).toBeNull()
	})
})
