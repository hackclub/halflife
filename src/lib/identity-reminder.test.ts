import { describe, expect, test } from "bun:test"
import { IDENTITY_REMINDER_SNOOZE_MS, identityReminderDue } from "@/lib/identity-reminder"

describe("identityReminderDue", () => {
	const now = Date.parse("2026-11-18T12:00:00Z")

	test("is due when it has never been dismissed", () => {
		expect(identityReminderDue(null, now)).toBe(true)
	})

	test("stays quiet for a day after it is dismissed", () => {
		expect(identityReminderDue(now - 60 * 60 * 1000, now)).toBe(false)
		expect(identityReminderDue(now - (IDENTITY_REMINDER_SNOOZE_MS - 1), now)).toBe(false)
	})

	test("comes back once the day has passed", () => {
		expect(identityReminderDue(now - IDENTITY_REMINDER_SNOOZE_MS, now)).toBe(true)
	})
})
