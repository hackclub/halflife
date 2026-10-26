import { describe, expect, test } from "bun:test"
import { purchaseSchema, shopRegionPreferenceSchema } from "@/lib/schemas/shop"

describe("purchaseSchema", () => {
	test("defaults to one with an idempotency key", () => {
		const parsed = purchaseSchema.safeParse({ idempotencyKey: "12345678", shopItemId: "kit" })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data.quantity).toBe(1)
	})

	test("keys are bounded and quantities are small", () => {
		expect(purchaseSchema.safeParse({ idempotencyKey: "short", shopItemId: "kit" }).success).toBe(false)
		expect(purchaseSchema.safeParse({ idempotencyKey: "x".repeat(65), shopItemId: "kit" }).success).toBe(false)
		expect(purchaseSchema.safeParse({ idempotencyKey: "12345678", quantity: 6, shopItemId: "kit" }).success).toBe(false)
		expect(purchaseSchema.safeParse({ idempotencyKey: "12345678", quantity: 0, shopItemId: "kit" }).success).toBe(false)
		expect(purchaseSchema.safeParse({ idempotencyKey: "12345678", shopItemId: "kit" }).success).toBe(true)
	})
})

describe("shopRegionPreferenceSchema", () => {
	test("takes a region or base pricing", () => {
		expect(shopRegionPreferenceSchema.safeParse({ regionId: "eu" }).success).toBe(true)
		expect(shopRegionPreferenceSchema.safeParse({ regionId: null }).success).toBe(true)
		expect(shopRegionPreferenceSchema.safeParse({ regionId: "" }).success).toBe(false)
		expect(shopRegionPreferenceSchema.safeParse({}).success).toBe(false)
	})
})
