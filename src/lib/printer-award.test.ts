import { describe, expect, test } from "bun:test"
import { canMovePrinterAward, PRINTER_AWARD_LABELS, PRINTER_AWARD_NEXT } from "@/lib/printer-award"

describe("canMovePrinterAward", () => {
	test("allows the next steps and nothing else", () => {
		expect(canMovePrinterAward("QUALIFIED", "ADDRESS_LOCKED")).toBe(true)
		expect(canMovePrinterAward("QUALIFIED", "REVOKED")).toBe(true)
		expect(canMovePrinterAward("QUALIFIED", "SHIPPED")).toBe(false)
		expect(canMovePrinterAward("DELIVERED", "REVOKED")).toBe(false)
		expect(canMovePrinterAward("SHIPPED", "DELIVERED")).toBe(true)
	})

	test("agrees with the transition table", () => {
		for (const [from, next] of Object.entries(PRINTER_AWARD_NEXT))
			for (const to of next) expect(canMovePrinterAward(from as "QUALIFIED", to)).toBe(true)
		expect(PRINTER_AWARD_LABELS.QUALIFIED).toBe("qualified")
	})
})
