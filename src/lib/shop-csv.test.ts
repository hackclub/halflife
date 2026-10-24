import { describe, expect, test } from "bun:test"
import { parseShopCsv, SHOP_CSV_MAX_ROWS, SHOP_CSV_TEMPLATE } from "@/lib/shop-csv"

describe("parseShopCsv", () => {
	test("accepts the template", () => {
		const { items, problems } = parseShopCsv(SHOP_CSV_TEMPLATE)
		expect(problems).toEqual([])
		expect(items).toHaveLength(1)
		expect(items[0]).toMatchObject({ id: "soldering-kit", priceCredits: 40 })
	})

	test("refuses empty and headerless files", () => {
		expect(parseShopCsv("").problems).toEqual([{ line: 0, message: "The file is empty." }])
		expect(parseShopCsv("slug,name,description,price\n").problems).toEqual([
			{ line: 0, message: "The file has a header but no items." },
		])
	})

	test("names unknown and missing columns", () => {
		const { items, problems } = parseShopCsv("a,b\n1,2")
		expect(items).toEqual([])
		expect(problems.map(p => p.message)).toContain("Missing columns: slug, name, description, price.")
	})

	test("rejects stray commas, bad categories and duplicate slugs", () => {
		const header = "slug,name,description,price,category,cost,image,gated"
		const { problems } = parseShopCsv(
			[header, "k,Kit,Desc,40,consumable,1.5,,yes,EXTRA", "k2,Kit2,Desc,40,bogus,,,no", "k,Kit3,Desc,5,,,,no"].join("\n"),
		)
		expect(problems.map(p => p.message)).toContain(
			"Has 9 cells but the header has 8. Quote any cell that holds a comma.",
		)
		expect(problems.map(p => p.message)).toContain('Category "bogus" is not one of: upgrade, consumable, misc, printer.')
	})

	test("duplicate slugs are reported against the first use", () => {
		const header = "slug,name,description,price"
		const { problems } = parseShopCsv([header, "k,Kit,Desc,40", "k,Kit again,Desc,5"].join("\n"))
		expect(problems).toEqual([{ line: 3, message: 'Slug "k" is already used on line 2.' }])
	})

	test("caps the rows per import", () => {
		const header = "slug,name,description,price"
		const rows = Array.from({ length: SHOP_CSV_MAX_ROWS + 1 }, (_, i) => `k${i},Kit,Desc,40`)
		const { items, problems } = parseShopCsv([header, ...rows].join("\n"))
		expect(items).toEqual([])
		expect(problems).toEqual([
			{ line: 0, message: `At most ${SHOP_CSV_MAX_ROWS} items per import; this file has ${SHOP_CSV_MAX_ROWS + 1}.` },
		])
	})
})
