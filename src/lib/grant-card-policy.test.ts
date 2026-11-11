import { describe, expect, test } from "bun:test"
import {
	grantCardAmountCents,
	grantCardCapUsd,
	grantCardFingerprint,
	grantCardInstructions,
	grantCardPurpose,
} from "@/lib/grant-card-policy"

describe("grant card policy", () => {
	test("pays the BOM total, including tax and shipping, when it is under the cap", () => {
		expect(grantCardAmountCents([{ quantity: 2, unitCostUsd: 4.25 }], 1.5, 65)).toBe(1000)
		expect(grantCardAmountCents([{ quantity: 1, unitCostUsd: 0.1 }], 0, 30)).toBe(10)
	})

	test("never pays more than the cap, however large the BOM", () => {
		expect(grantCardAmountCents([{ quantity: 10, unitCostUsd: 20 }], 5, 30)).toBe(3000)
		expect(grantCardAmountCents([{ quantity: 1, unitCostUsd: 500 }], 0, 100)).toBe(10000)
	})

	test("an empty BOM is worth nothing", () => {
		expect(grantCardAmountCents([], 12, 30)).toBe(0)
	})

	test("the cap is the lower of the approved grant and the tier's maximum", () => {
		expect(grantCardCapUsd(30, 1)).toBe(30)
		expect(grantCardCapUsd(65, 1)).toBe(30)
		expect(grantCardCapUsd(30, 2)).toBe(30)
		expect(grantCardCapUsd(null, 2)).toBe(0)
	})

	test("a project with no tier has no cap to hold it to", () => {
		expect(grantCardCapUsd(30, null)).toBeNull()
	})

	test("the purpose is the short constant HCB fits in a row", () => {
		expect(grantCardPurpose()).toBe("Half Life parts")
		expect(grantCardPurpose().length).toBeLessThanOrEqual(30)
	})

	test("the instructions name the project and carry its link when an origin is known", () => {
		expect(grantCardInstructions("Bloom", "prj_1", "https://halflife.hackclub.com")).toBe(
			"Parts for Bloom – https://halflife.hackclub.com/projects/prj_1",
		)
		expect(grantCardInstructions("Bloom", "prj_1", null)).toBe("Parts for Bloom")
	})

	test("the fingerprint ignores order but notices a changed amount or email", () => {
		const a = grantCardFingerprint([
			{ amountCents: 100, email: "a@example.com", projectId: "p1" },
			{ amountCents: 200, email: "b@example.com", projectId: "p2" },
		])
		const b = grantCardFingerprint([
			{ amountCents: 200, email: "B@Example.com", projectId: "p2" },
			{ amountCents: 100, email: "a@example.com", projectId: "p1" },
		])
		expect(a).toBe(b)
		expect(a).not.toBe(
			grantCardFingerprint([
				{ amountCents: 101, email: "a@example.com", projectId: "p1" },
				{ amountCents: 200, email: "b@example.com", projectId: "p2" },
			]),
		)
	})
})
