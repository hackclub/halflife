import { describe, expect, test } from "bun:test"
import { EventColour, Phase, PrinterAwardStatus, Role, ShopItemCategory } from "@/lib/enums"
import {
	creditAdjustSchema,
	disputeMessageSchema,
	grantCardMerchantSchema,
	grantCardMerchantUpdateSchema,
	grantSchema,
	itemRegionPriceSchema,
	orderDecisionSchema,
	orderFulfillmentSchema,
	printerAwardUpdateSchema,
	programEventCreateSchema,
	programEventUpdateSchema,
	programSettingsSchema,
	projectExtensionSchema,
	roleChangeSchema,
	rsvpSchema,
	SHOP_GRANT_CARD_BATCH_MAX,
	shopGrantCardBatchSchema,
	shopItemSchema,
	shopItemUpdateSchema,
	shopRegionSchema,
	shopRegionUpdateSchema,
	subscribeSchema,
	userFlagsSchema,
	weekExtensionSchema,
} from "@/lib/schemas/admin"

const validItem = {
	description: "A starter iron.",
	id: "soldering-kit",
	name: "Soldering kit",
	priceCredits: 40,
}

describe("roleChangeSchema / userFlagsSchema / projectExtensionSchema", () => {
	test("accepts known roles and trims pasted emails", () => {
		expect(roleChangeSchema.safeParse({ role: Role.ADMIN }).success).toBe(true)
		expect(roleChangeSchema.safeParse({ role: "nope" }).success).toBe(false)
		const parsed = userFlagsSchema.safeParse({ email: "  A@Example.com  " })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data.email).toBe("A@Example.com")
		expect(userFlagsSchema.safeParse({ email: "not-an-email" }).success).toBe(false)
	})

	test("extensions need something to change", () => {
		expect(projectExtensionSchema.safeParse({}).success).toBe(false)
		expect(projectExtensionSchema.safeParse({ theme: "PCB" }).success).toBe(true)
		expect(projectExtensionSchema.safeParse({ extra: 1 }).success).toBe(false)
	})

	test("a week extension is a date or an explicit clear", () => {
		expect(weekExtensionSchema.safeParse({ submissionExtensionUntil: "2026-12-01T00:00:00.000Z" }).success).toBe(true)
		expect(weekExtensionSchema.safeParse({ submissionExtensionUntil: null }).success).toBe(true)
		expect(weekExtensionSchema.safeParse({}).success).toBe(false)
	})

	test("dispute replies cannot be blank", () => {
		expect(disputeMessageSchema.safeParse({ body: "Hello" }).success).toBe(true)
		expect(disputeMessageSchema.safeParse({ body: "   " }).success).toBe(false)
	})
})

describe("grantSchema / creditAdjustSchema", () => {
	test("grants only come from the design phase", () => {
		expect(grantSchema.safeParse({ grantUrl: "https://example.com/g", phase: Phase.DESIGN }).success).toBe(true)
		expect(grantSchema.safeParse({ grantUrl: "https://example.com/g", phase: Phase.BUILD }).success).toBe(false)
	})

	test("adjustments stay within bounds and default to spendable", () => {
		const parsed = creditAdjustSchema.safeParse({ amount: 100, reason: "fix", userId: "u1" })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data.bucket).toBe("SPENDABLE")
		expect(creditAdjustSchema.safeParse({ amount: 0, reason: "fix", userId: "u1" }).success).toBe(false)
		expect(creditAdjustSchema.safeParse({ amount: 10_001, reason: "fix", userId: "u1" }).success).toBe(false)
		expect(creditAdjustSchema.safeParse({ amount: -10_001, reason: "fix", userId: "u1" }).success).toBe(false)
		expect(creditAdjustSchema.safeParse({ amount: 100, reason: "", userId: "u1" }).success).toBe(false)
	})
})

describe("printerAwardUpdateSchema", () => {
	test("defaults the note and accepts the statuses", () => {
		const parsed = printerAwardUpdateSchema.safeParse({ status: PrinterAwardStatus.SHIPPED })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data.note).toBe("")
		expect(printerAwardUpdateSchema.safeParse({ status: "nope" }).success).toBe(false)
	})
})

describe("shopItemSchema / shopItemUpdateSchema", () => {
	test("accepts a full item with defaults filled", () => {
		const parsed = shopItemSchema.safeParse(validItem)
		expect(parsed.success).toBe(true)
		if (parsed.success)
			expect(parsed.data).toMatchObject({
				active: true,
				category: "PRINTER_UPGRADE",
				grantCardMerchants: [],
				maxPerUser: 1,
				stock: null,
			})
	})

	test("refuses bad slugs, negative prices and unknown keys", () => {
		expect(shopItemSchema.safeParse({ ...validItem, id: "Bad_Slug!" }).success).toBe(false)
		expect(shopItemSchema.safeParse({ ...validItem, priceCredits: -1 }).success).toBe(false)
		expect(shopItemSchema.safeParse({ ...validItem, imageUrl: "http://example.com/x.png" }).success).toBe(false)
		expect(shopItemSchema.safeParse({ ...validItem, extra: 1 }).success).toBe(false)
	})

	test("updates omit the id and stay strict", () => {
		expect(shopItemUpdateSchema.safeParse({ name: "New name" }).success).toBe(true)
		expect(shopItemUpdateSchema.safeParse({ id: "x" }).success).toBe(false)
		expect(shopItemUpdateSchema.safeParse({}).success).toBe(true)
	})

	test("an item links to merchants by ID, optionally, without any free-text IDs", () => {
		expect(shopItemSchema.safeParse({ ...validItem, grantCardMerchants: ["merchant-1"] }).success).toBe(true)
		expect(shopItemUpdateSchema.safeParse({ grantCardMerchants: ["merchant-1"] }).success).toBe(true)
		expect(shopItemUpdateSchema.safeParse({ grantCardMerchants: [""] }).success).toBe(false)
		expect(shopItemUpdateSchema.safeParse({ grantCardMerchantIds: ["AAAPLASTIC"] }).success).toBe(false)
	})

	test("a merchant takes a name, a source note and any number of IDs", () => {
		const merchant = { merchantIds: Array.from({ length: 1517 }, (_, i) => `M${i}`), name: "Amazon" }
		expect(grantCardMerchantSchema.safeParse(merchant).success).toBe(true)
		expect(grantCardMerchantSchema.safeParse({ name: "" }).success).toBe(false)
		expect(grantCardMerchantSchema.safeParse({ ...merchant, merchantIds: [""] }).success).toBe(false)
		expect(grantCardMerchantUpdateSchema.safeParse({ sourceNote: "yellow_pages" }).success).toBe(true)
	})

	test("an update carries only the fields it was sent, never the create defaults", () => {
		// A price-only edit once came back with requiresPrinterQualified: true and category: PRINTER_UPGRADE, which locked every edited item behind the printer qualification.
		const parsed = shopItemUpdateSchema.safeParse({ priceCredits: 19 })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data).toEqual({ priceCredits: 19 })
	})
})

describe("shop regions and pricing", () => {
	test("regions need slug-shaped ids", () => {
		expect(shopRegionSchema.safeParse({ id: "eu", name: "Europe" }).success).toBe(true)
		expect(shopRegionSchema.safeParse({ id: "EU!", name: "Europe" }).success).toBe(false)
		expect(shopRegionUpdateSchema.safeParse({}).success).toBe(false)
		expect(shopRegionUpdateSchema.safeParse({ name: "Europe" }).success).toBe(true)
	})

	test("region prices accept null to clear", () => {
		expect(itemRegionPriceSchema.safeParse({ priceCredits: null, regionId: "eu" }).success).toBe(true)
		expect(itemRegionPriceSchema.safeParse({ priceCredits: -1, regionId: "eu" }).success).toBe(false)
	})
})

describe("orderDecisionSchema / orderFulfillmentSchema", () => {
	test("routes on the action", () => {
		expect(orderDecisionSchema.safeParse({ action: "FULFILL" }).success).toBe(true)
		expect(orderDecisionSchema.safeParse({ action: "FULFILL", trackingNumber: "1Z2" }).success).toBe(true)
		expect(orderDecisionSchema.safeParse({ action: "REJECT" }).success).toBe(false)
		expect(orderDecisionSchema.safeParse({ action: "REJECT", reason: "broken" }).success).toBe(true)
		expect(orderDecisionSchema.safeParse({ action: "HOLD", reason: "" }).success).toBe(false)
		expect(orderDecisionSchema.safeParse({ action: "SHIP" }).success).toBe(false)
	})

	test("fulfilment updates need something to change", () => {
		expect(orderFulfillmentSchema.safeParse({}).success).toBe(false)
		expect(orderFulfillmentSchema.safeParse({ method: null }).success).toBe(true)
		expect(orderFulfillmentSchema.safeParse({ method: "nope" }).success).toBe(false)
	})
})

describe("programEventCreateSchema / programEventUpdateSchema", () => {
	const valid = { startsAt: "2026-03-05T19:00:00Z", title: "Show and tell" }

	test("creates with defaults and coerced dates", () => {
		const parsed = programEventCreateSchema.safeParse(valid)
		expect(parsed.success).toBe(true)
		if (parsed.success) {
			expect(parsed.data.startsAt).toBeInstanceOf(Date)
			expect(parsed.data.repeatWeeks).toBe(1)
			expect(parsed.data.colour).toBe(EventColour.SLATE)
		}
	})

	test("a cleared start is missing, not 1970", () => {
		expect(programEventCreateSchema.safeParse({ ...valid, startsAt: null }).success).toBe(false)
	})

	test("rejects backwards events and absurd repeats", () => {
		expect(programEventCreateSchema.safeParse({ ...valid, endsAt: "2026-03-05T18:00:00Z" }).success).toBe(false)
		expect(programEventCreateSchema.safeParse({ ...valid, repeatWeeks: 53 }).success).toBe(false)
		expect(programEventCreateSchema.safeParse({ ...valid, repeatWeeks: 0 }).success).toBe(false)
	})

	test("updates need at least one field", () => {
		expect(programEventUpdateSchema.safeParse({}).success).toBe(false)
		expect(programEventUpdateSchema.safeParse({ title: "New title" }).success).toBe(true)
	})
})

describe("programSettingsSchema", () => {
	test("checks the timezone where it is typed", () => {
		expect(programSettingsSchema.safeParse({ programTimezone: "America/New_York" }).success).toBe(true)
		expect(programSettingsSchema.safeParse({ programTimezone: "Mars/Olympus" }).success).toBe(false)
		expect(programSettingsSchema.safeParse({ reviewClaimTtlMinutes: 4 }).success).toBe(false)
		expect(programSettingsSchema.safeParse({ reviewClaimTtlMinutes: 30 }).success).toBe(true)
		expect(programSettingsSchema.safeParse({ unknown: true }).success).toBe(false)
	})
})

describe("shopGrantCardBatchSchema", () => {
	const body = {
		grantCardMerchantIds: ["ZIEMZSLZHABHDPK"],
		orderIds: ["order-1"],
		shopItemId: "soldering-kit",
	}

	test("accepts one item's orders with an allowlist", () => {
		expect(shopGrantCardBatchSchema.safeParse(body).success).toBe(true)
	})

	test("refuses a send with no merchant lock", () => {
		expect(shopGrantCardBatchSchema.safeParse({ ...body, grantCardMerchantIds: [] }).success).toBe(false)
		expect(shopGrantCardBatchSchema.safeParse({ ...body, grantCardMerchantIds: [""] }).success).toBe(false)
	})

	test("refuses an empty or oversized batch, and unknown keys", () => {
		expect(shopGrantCardBatchSchema.safeParse({ ...body, orderIds: [] }).success).toBe(false)
		expect(
			shopGrantCardBatchSchema.safeParse({
				...body,
				orderIds: Array.from({ length: SHOP_GRANT_CARD_BATCH_MAX + 1 }, (_, i) => `order-${i}`),
			}).success,
		).toBe(false)
		expect(shopGrantCardBatchSchema.safeParse({ ...body, extra: 1 }).success).toBe(false)
	})
})

describe("rsvpSchema / subscribeSchema", () => {
	test("requires a real email", () => {
		expect(rsvpSchema.safeParse({ email: "a@b.com" }).success).toBe(true)
		expect(rsvpSchema.safeParse({ email: "nope" }).success).toBe(false)
		expect(subscribeSchema.safeParse({ email: "a@b.com", utmSource: "x" }).success).toBe(true)
		expect(subscribeSchema.safeParse({ email: "a@b.com", extra: 1 }).success).toBe(false)
	})

	test("shop categories default sanely", () => {
		expect(shopItemSchema.safeParse({ ...validItem, category: ShopItemCategory.PRINTER }).success).toBe(true)
	})
})

describe("grantCardMerchantUpdateSchema", () => {
	test("archiving alone sends nothing else, so the IDs and note are left as they are", () => {
		const parsed = grantCardMerchantUpdateSchema.safeParse({ archived: true })
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data).toEqual({ archived: true })
	})
})
