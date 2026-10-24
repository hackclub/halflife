import { describe, expect, test } from "bun:test"
import { csvCell, csvRow, parseCsvRecords, parseCsvRows } from "@/lib/csv"

describe("parseCsvRecords", () => {
	test("parses a simple sheet with 1-based line numbers", () => {
		expect(parseCsvRecords("a,b\nc,d")).toEqual([
			{ fields: ["a", "b"], line: 1 },
			{ fields: ["c", "d"], line: 2 },
		])
	})

	test("handles quoted commas, quotes and line breaks", () => {
		expect(parseCsvRecords('"a,b","c""d"\n"e\nf",g')).toEqual([
			{ fields: ["a,b", 'c"d'], line: 1 },
			{ fields: ["e\nf", "g"], line: 2 },
		])
	})

	test("handles Windows line breaks inside and outside cells", () => {
		expect(parseCsvRecords("a,b\r\nc,d")).toEqual([
			{ fields: ["a", "b"], line: 1 },
			{ fields: ["c", "d"], line: 2 },
		])
	})

	test("strips a BOM and drops blank rows", () => {
		expect(parseCsvRecords("﻿a,b\n\n   \nc,d\n")).toEqual([
			{ fields: ["a", "b"], line: 1 },
			{ fields: ["c", "d"], line: 4 },
		])
	})
})

describe("parseCsvRows", () => {
	test("returns fields without line bookkeeping", () => {
		expect(parseCsvRows("a,b\nc,d")).toEqual([
			["a", "b"],
			["c", "d"],
		])
	})
})

describe("csvCell / csvRow", () => {
	test("leaves plain cells alone", () => {
		expect(csvCell("abc")).toBe("abc")
		expect(csvCell(40)).toBe("40")
	})

	test("quotes cells with commas, quotes or line breaks", () => {
		expect(csvCell("a,b")).toBe('"a,b"')
		expect(csvCell('say "hi"')).toBe('"say ""hi"""')
		expect(csvRow(["a", "b,c", 3])).toBe('a,"b,c",3')
	})
})
