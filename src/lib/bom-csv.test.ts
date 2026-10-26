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

	test("skips title rows to find the header, and reads rich cells", () => {
		const out = parseBomCsv(
			[
				"My cool build",
				"Exported 2026-01-01",
				"Description,Quantity,Unit Price,Supplier,Link,Purpose",
				"100pc resistor,100pc,$0.05,https://lcsc.com/product/1,,for pullups",
				"[LED](http://example.com/led),2,Rs. 1300 (~ $15),,,indicator",
				"Monster cap,1,$999999,,,",
			].join("\n"),
		)
		expect(out.header).toEqual(["Description", "Quantity", "Unit Price", "Supplier", "Link", "Purpose"])
		expect(out.lines).toEqual([
			{
				link: null,
				name: "100pc resistor",
				purpose: "for pullups",
				quantity: 100,
				unitCostUsd: 0.05,
				vendor: "https://lcsc.com/product/1",
			},
			{ link: null, name: "LED", purpose: "indicator", quantity: 2, unitCostUsd: 15, vendor: null },
		])
		expect(out.skipped).toEqual([{ name: "Monster cap", reason: "unit price is above $10000", row: 6 }])
	})

	test("reads a cost-each column from a spreadsheet export", () => {
		const out = parseBomCsv(
			[
				"Item, amount, cost (ea.), Link",
				"XIAO ESP32 C3, 1, 5.00, https://www.seeedstudio.com/x",
				"MX Switches, 4, 0.18, https://www.amazon.com/dp/B0",
				"Total (each kit), 1, 24.95,",
			].join("\n"),
		)
		expect(out.lines.map(l => l.unitCostUsd)).toEqual([5, 0.18])
		expect(out.lines.map(l => l.quantity)).toEqual([1, 4])
		expect(out.skipped).toEqual([{ name: "Total (each kit)", reason: "looks like an order total, not a part", row: 4 }])
	})

	test("reads the sync's own BOM.csv, whose price column is Cost/item", () => {
		const out = parseBomCsv(
			["Item,Qty,Supplier,Cost/item,Total Cost,link", "10k resistor,2,DigiKey,0.05,0.10,"].join("\n"),
		)
		expect(out.lines[0]).toMatchObject({
			name: "10k resistor",
			quantity: 2,
			unitCostUsd: 0.05,
			vendor: "DigiKey",
		})
	})

	test("a lone name column still imports, and the header itself is skipped", () => {
		const out = parseBomCsv("Part\nresistor\nPart\n")
		expect(out.header).toEqual(["Part"])
		expect(out.lines.map(l => l.name)).toEqual(["resistor"])
		expect(out.skipped).toEqual([{ name: "Part", reason: "repeats the header", row: 3 }])
	})

	test("reads bare, missing and oddly-signed prices", () => {
		const out = parseBomCsv("Part,Price\nr1,1.50\nr2,abc\nr3,-$5\n")
		expect(out.lines.map(l => l.unitCostUsd)).toEqual([1.5, 0, 5])
	})

	test("keeps only real links, naming vendors off the host", () => {
		const out = parseBomCsv(
			["Part,Link", "r1,[doc](https://example.com/x)", "r2,ftp://example.com/x", "r3,notaurl"].join("\n"),
		)
		expect(out.lines[0]).toMatchObject({ link: "https://example.com/x", vendor: "Example" })
		expect(out.lines.slice(1).map(l => l.link)).toEqual([null, null])
	})

	test("drops links past the length cap", () => {
		const out = parseBomCsv(`Part,Link\nr4,https://example.com/${"y".repeat(1000)}`)
		expect(out.lines[0]?.link).toBeNull()
	})

	test("drops links that will not parse", () => {
		const out = parseBomCsv("Part,Link\nr5,https://exa mple.com/x")
		expect(out.lines[0]?.link).toBeNull()
	})
})
