import { describe, expect, test } from "bun:test"
import { firmwareWaiverCovers, readmeBomTable } from "@/lib/config/repo-checks"
import { Theme } from "@/lib/enums"

const firmware = { key: "firmware" }
const readme = { key: "readme" }

describe("firmwareWaiverCovers", () => {
	test("clears a Displays hand-in whose only missing file is firmware", () => {
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [firmware], true)).toBe(true)
	})

	test("needs the maker's confirmation", () => {
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [firmware], false)).toBe(false)
	})

	test("does not clear another missing file alongside firmware", () => {
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [firmware, readme], true)).toBe(false)
	})

	test("does not waive a file other than firmware", () => {
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [readme], true)).toBe(false)
	})

	test("does not clear a theme that does not require firmware", () => {
		expect(firmwareWaiverCovers(Theme.PCB, [firmware], true)).toBe(false)
		expect(firmwareWaiverCovers(Theme.DISPLAYS, [], true)).toBe(false)
	})
})

describe("readmeBomTable", () => {
	test("finds a table whose separator cells use one or two dashes, as GitHub renders them", () => {
		const md = [
			"## BOM",
			"",
			"| PART | QTY | UNIT | TOTAL | SOURCE |",
			"| --- | --: | ----: | ---------: | -------- |",
			"| PLA filament | 1 | $8.21 | $8.21 | https://example.com/pla |",
			"| Glue gun | 1 | $2.20 | $2.20 | https://example.com/glue |",
		].join("\n")
		expect(readmeBomTable(md)).toEqual({ rows: 2 })
	})

	test("counts the rows below the header and stops at the end of the table", () => {
		const md = [
			"| Part | Price |",
			"| --- | --- |",
			"| Motor | $2 |",
			"| Switch | $1 |",
			"",
			"Prose after the table.",
		].join("\n")
		expect(readmeBomTable(md)).toEqual({ rows: 2 })
	})

	test("needs at least the minimum number of rows", () => {
		const md = ["| Part | Price |", "| --- | --- |", "| Motor | $2 |"].join("\n")
		expect(readmeBomTable(md, 2)).toBeNull()
	})

	test("ignores a table with no part-like or price-like column", () => {
		const md = ["| Pin | GPIO |", "| --- | --- |", "| 1 | 4 |"].join("\n")
		expect(readmeBomTable(md)).toBeNull()
	})

	test("ignores a table pasted inside a fenced code block", () => {
		const md = ["```", "| Part | Price |", "| --- | --- |", "| Motor | $2 |", "```"].join("\n")
		expect(readmeBomTable(md)).toBeNull()
	})

	test("does not read a horizontal rule as a table", () => {
		const md = ["Part | Price", "---", "Motor | $2"].join("\n")
		expect(readmeBomTable(md)).toBeNull()
	})

	test("finds an HTML BOM table", () => {
		const md = [
			"<table>",
			"<tr><th>Part</th><th>Price</th></tr>",
			"<tr><td>Motor</td><td>$2</td></tr>",
			"</table>",
		].join("\n")
		expect(readmeBomTable(md)).toEqual({ rows: 1 })
	})
})
