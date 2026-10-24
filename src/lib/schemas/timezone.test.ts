import { describe, expect, test } from "bun:test"
import { timezonePreferenceSchema } from "@/lib/schemas/timezone"

describe("timezonePreferenceSchema", () => {
	test("takes a non-empty zone string, shape only", () => {
		expect(timezonePreferenceSchema.safeParse({ timezone: "America/New_York" }).success).toBe(true)
		expect(timezonePreferenceSchema.safeParse({ timezone: "" }).success).toBe(false)
		expect(timezonePreferenceSchema.safeParse({}).success).toBe(false)
		expect(timezonePreferenceSchema.safeParse({ extra: 1, timezone: "America/New_York" }).success).toBe(false)
	})
})
