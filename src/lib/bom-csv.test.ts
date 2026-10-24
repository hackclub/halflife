import { describe, expect, test } from "bun:test"
import { parseBomCsv } from "@/lib/bom-csv"

describe("parseBomCsv", () => {
	test("imports named parts and skips the rest with reasons", () => {
		const out = parseBomCsv("Part,Qty,Price,Vendor\n10k resistor,10,$0.10,DigiKey\n,5,$1.00,\nGrand Total,,,\n")
		expect(out.header).toEqual(["Part", "Qty", "Price", "Vendor"])
		expect(out.lines).toEqual([
			{ link: null, name: "10k resistor", purpose: null, quantity: 10, unitCostUsd: 0.1, vendor: "DigiKey" },
		])
		expect(out.skipped).toEqual([
			{ name: "", reason: "no part name", row: 3 },
			{ name: "Grand Total", reason: "looks like an order total, not a part", row: 4 },
		])
	})

	test("finds no header in prose", () => {
		expect(parseBomCsv("hello world\njust chatting")).toEqual({ header: null, lines: [], skipped: [] })
	})

	test("honours the limit, reporting overflow as skipped", () => {
		const out = parseBomCsv("Part,Qty\nr1,1\nr2,2", { limit: 1 })
		expect(out.lines.map(l => l.name)).toEqual(["r1"])
		expect(out.skipped).toEqual([{ name: "r2", reason: "beyond the parts-list limit", row: 3 }])
	})
})
