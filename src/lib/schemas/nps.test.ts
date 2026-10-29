import { describe, expect, test } from "bun:test"
import { npsSubmitSchema, npsTextsSubmitSchema } from "@/lib/schemas/nps"

describe("npsSubmitSchema", () => {
	test("accepts a score alone", () => {
		expect(npsSubmitSchema.safeParse({ howLikelyRecommend: 9 }).success).toBe(true)
	})

	test("accepts a zero score – 0 is an answer, not an absence", () => {
		const parsed = npsSubmitSchema.safeParse({ howLikelyRecommend: 0 })
		expect(parsed.success).toBe(true)
	})

	test("accepts a full response", () => {
		const parsed = npsSubmitSchema.safeParse({
			howDoingWell: "The trail",
			howHear: "A friend",
			howImprove: "Nothing",
			howLikelyRecommend: 10,
		})
		expect(parsed.success).toBe(true)
	})

	test("rejects a missing score", () => {
		expect(npsSubmitSchema.safeParse({ howDoingWell: "Great" }).success).toBe(false)
	})

	test("rejects out-of-range scores", () => {
		expect(npsSubmitSchema.safeParse({ howLikelyRecommend: -1 }).success).toBe(false)
		expect(npsSubmitSchema.safeParse({ howLikelyRecommend: 11 }).success).toBe(false)
		expect(npsSubmitSchema.safeParse({ howLikelyRecommend: 7.5 }).success).toBe(false)
	})
})

describe("npsTextsSubmitSchema", () => {
	test("accepts an empty follow-up – nothing to add still counts as sent", () => {
		expect(npsTextsSubmitSchema.safeParse({}).success).toBe(true)
	})

	test("accepts partial answers", () => {
		expect(npsTextsSubmitSchema.safeParse({ howHear: "A friend" }).success).toBe(true)
	})

	test("rejects a score – that belongs to the first step", () => {
		expect(npsTextsSubmitSchema.safeParse({ howLikelyRecommend: 9 }).success).toBe(false)
	})
})
