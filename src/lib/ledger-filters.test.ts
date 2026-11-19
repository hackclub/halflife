import { describe, expect, test } from "bun:test"
import { LedgerKind } from "@/lib/enums"
import { ledgerKindFrom, ledgerKindLabel, ledgerKindTone, utcDay } from "@/lib/ledger-filters"

describe("ledger filters", () => {
	test("reads a date input as midnight UTC", () => {
		expect(utcDay("2026-11-01")?.toISOString()).toBe("2026-11-01T00:00:00.000Z")
	})

	test("drops a date that is not shaped like an input's value", () => {
		expect(utcDay(undefined)).toBeUndefined()
		expect(utcDay("")).toBeUndefined()
		expect(utcDay("2026-11-1")).toBeUndefined()
		expect(utcDay("yesterday")).toBeUndefined()
	})

	test("accepts only the kinds the ledger records", () => {
		expect(ledgerKindFrom("SHOP_PURCHASE")).toBe("SHOP_PURCHASE")
		expect(ledgerKindFrom("shop_purchase")).toBeUndefined()
		expect(ledgerKindFrom("NOT_A_KIND")).toBeUndefined()
		expect(ledgerKindFrom(undefined)).toBeUndefined()
	})

	test("reads a kind as words", () => {
		expect(ledgerKindLabel("DESIGN_BANKED_HOURS")).toBe("Design banked hours")
		expect(ledgerKindLabel("ADMIN_ADJUSTMENT")).toBe("Admin adjustment")
	})
})

describe("ledger kind tones", () => {
	test("the common kinds do not share a colour", () => {
		const common = [
			LedgerKind.DESIGN_EXCESS_HOURS,
			LedgerKind.BUILD_HOURS,
			LedgerKind.THEME_COMPLETION_BONUS,
			LedgerKind.SHOP_PURCHASE,
			LedgerKind.SHOP_REFUND,
			LedgerKind.ADMIN_ADJUSTMENT,
		]
		const tones = common.map(ledgerKindTone)
		expect(new Set(tones).size).toBe(tones.length)
	})
})
