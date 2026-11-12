import { describe, expect, test } from "bun:test"
import { purchaseSchema, shopRegionPreferenceSchema } from "@/lib/schemas/shop"

describe("purchaseSchema", () => {
	const key = { deliveryPreference: "SHIP", idempotencyKey: "12345678", shopItemId: "kit" } as const

	test("defaults to one with an idempotency key", () => {
		const parsed = purchaseSchema.safeParse(key)
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data.quantity).toBe(1)
	})

	test("keys are bounded and quantities are small", () => {
		expect(purchaseSchema.safeParse({ ...key, idempotencyKey: "short" }).success).toBe(false)
		expect(purchaseSchema.safeParse({ ...key, idempotencyKey: "x".repeat(65) }).success).toBe(false)
		expect(purchaseSchema.safeParse({ ...key, quantity: 6 }).success).toBe(false)
		expect(purchaseSchema.safeParse({ ...key, quantity: 0 }).success).toBe(false)
		expect(purchaseSchema.safeParse(key).success).toBe(true)
	})

	test("asks how the item should reach the buyer", () => {
		expect(purchaseSchema.safeParse({ idempotencyKey: "12345678", shopItemId: "kit" }).success).toBe(false)
		expect(purchaseSchema.safeParse({ ...key, deliveryPreference: "GRANT_CARD" }).success).toBe(true)
		expect(purchaseSchema.safeParse({ ...key, deliveryPreference: "TELEPORT" }).success).toBe(false)
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
