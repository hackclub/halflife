import { describe, expect, test } from "bun:test"
import { EventColour, Phase, PrinterAwardStatus, Role, ShopItemCategory } from "@/lib/enums"
import {
	creditAdjustSchema,
	disputeMessageSchema,
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
	shopItemSchema,
	shopItemUpdateSchema,
	shopRegionSchema,
	shopRegionUpdateSchema,
	subscribeSchema,
	userFlagsSchema,
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
			expect(parsed.data).toMatchObject({ active: true, category: "PRINTER_UPGRADE", maxPerUser: 1, stock: null })
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
