import { describe, expect, it } from "bun:test"
import { ADDRESS_REMINDER_SNOOZE_MS, addressReminderDue, parseDismissedAt } from "@/lib/address-reminder"

const NOW = 1_800_000_000_000

describe("parseDismissedAt", () => {
	it("reads a stored timestamp", () => {
		expect(parseDismissedAt(String(NOW))).toBe(NOW)
	})

	it("treats a missing, empty or nonsense value as never dismissed", () => {
		expect(parseDismissedAt(null)).toBeNull()
		expect(parseDismissedAt("")).toBeNull()
		expect(parseDismissedAt("soon")).toBeNull()
		expect(parseDismissedAt("-1")).toBeNull()
		expect(parseDismissedAt("0")).toBeNull()
		expect(parseDismissedAt("Infinity")).toBeNull()
	})
})

describe("addressReminderDue", () => {
	it("is due when it was never dismissed", () => {
		expect(addressReminderDue(null, NOW)).toBe(true)
	})

	it("stays quiet inside the snooze window", () => {
		expect(addressReminderDue(NOW, NOW)).toBe(false)
		expect(addressReminderDue(NOW - ADDRESS_REMINDER_SNOOZE_MS + 1, NOW)).toBe(false)
	})

	it("is due again once the window has passed", () => {
		expect(addressReminderDue(NOW - ADDRESS_REMINDER_SNOOZE_MS, NOW)).toBe(true)
		expect(addressReminderDue(NOW - ADDRESS_REMINDER_SNOOZE_MS * 2, NOW)).toBe(true)
	})

	it("does not reopen early when the stored time is in the future", () => {
		expect(addressReminderDue(NOW + 60_000, NOW)).toBe(false)
	})
})
