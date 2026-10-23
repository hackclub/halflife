import type { z } from "zod"
import { ShopItemCategory } from "@/app/generated/prisma/enums"
import { parseCsvRecords } from "@/lib/csv"
import { shopItemSchema } from "@/lib/schemas/admin"

/**
 * Shop items from a spreadsheet, for staff adding a catalogue in one go.
 *
 * Every row goes through `shopItemSchema`, the same check the single-item form answers to, so a CSV can never create an item the form would have refused. The columns are the form's: per-person limit, stock and shelf order are left to their defaults here as they are there.
 */

/** Header, in the order the template lists it. */
const SHOP_CSV_COLUMNS = ["slug", "name", "description", "price", "category", "cost", "image", "gated"] as const

const SHOP_CSV_TEMPLATE = `${SHOP_CSV_COLUMNS.join(",")}\nsoldering-kit,Soldering kit,"A starter iron, stand and solder.",40,consumable,18.50,,no\n`

/** A row cap, so one paste cannot become one enormous transaction. */
const SHOP_CSV_MAX_ROWS = 500

type Column = (typeof SHOP_CSV_COLUMNS)[number]

/** Spreadsheet headings people actually type, folded onto the columns. */
const HEADER_ALIASES: { [_: string]: Column } = {
	category: "category",
	coins: "price",
	cost: "cost",
	costusd: "cost",
	description: "description",
	gated: "gated",
	id: "slug",
	image: "image",
	imageurl: "image",
	name: "name",
	price: "price",
	pricecredits: "price",
	requiresprinterqualified: "gated",
	slug: "slug",
}

const REQUIRED: Column[] = ["slug", "name", "description", "price"]

const CATEGORY_ALIASES: { [_: string]: ShopItemCategory } = {
	CONSUMABLE: ShopItemCategory.CONSUMABLE,
	EVERYTHING_ELSE: ShopItemCategory.MISC,
	MISC: ShopItemCategory.MISC,
	PRINTER: ShopItemCategory.PRINTER,
	PRINTER_UPGRADE: ShopItemCategory.PRINTER_UPGRADE,
	UPGRADE: ShopItemCategory.PRINTER_UPGRADE,
}

type ShopCsvItem = z.output<typeof shopItemSchema>

interface ShopCsvProblem {
	/** 1-based line in the file, the header being line 1. 0 for the file as a whole. */
	line: number
	message: string
}

function bool(raw: string): boolean | undefined | "bad" {
	const v = raw.trim().toLowerCase()
	if (v === "") return undefined
	if (["yes", "y", "true", "1"].includes(v)) return true
	if (["no", "n", "false", "0"].includes(v)) return false
	return "bad"
}

/** A number as a spreadsheet writes it: `$1,250.00` is 1250. */
function num(raw: string): number {
	return Number(raw.trim().replaceAll(/[$,\s]/g, ""))
}

/**
 * Parse and validate a whole file. Either every row is good and `items` holds them all, or `problems` says what to fix, line by line. Nothing in between: a half-imported catalogue is harder to fix than a refused one.
 */
export function parseShopCsv(text: string): { items: ShopCsvItem[]; problems: ShopCsvProblem[] } {
	const rows = parseCsvRecords(text)
	const head = rows.shift()
	if (!head) return { items: [], problems: [{ line: 0, message: "The file is empty." }] }

	const problems: ShopCsvProblem[] = []
	const columns = head.fields.map(
		h =>
			HEADER_ALIASES[
				h
					.trim()
					.toLowerCase()
					.replaceAll(/[^a-z]/g, "")
			],
	)
	for (const [i, h] of head.fields.entries())
		if (!columns[i] && h.trim() !== "")
			problems.push({ line: 1, message: `Unknown column "${h.trim()}". Columns are: ${SHOP_CSV_COLUMNS.join(", ")}.` })

	const missing = REQUIRED.filter(c => !columns.includes(c))
	if (missing.length > 0)
		problems.push({ line: 1, message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.` })
	if (problems.length > 0) return { items: [], problems }

	if (rows.length === 0) return { items: [], problems: [{ line: 0, message: "The file has a header but no items." }] }
	if (rows.length > SHOP_CSV_MAX_ROWS)
		return {
			items: [],
			problems: [{ line: 0, message: `At most ${SHOP_CSV_MAX_ROWS} items per import; this file has ${rows.length}.` }],
		}

	const items: ShopCsvItem[] = []
	const seen = new Map<string, number>()

	for (const row of rows) {
		const cell = (c: Column) => {
			const i = columns.indexOf(c)
			return i === -1 ? "" : (row.fields[i] ?? "")
		}
		const say = (message: string) => problems.push({ line: row.line, message })

		// Every cell after a stray comma is in the wrong column, so anything else said about this row would be noise.
		if (row.fields.length > head.fields.length) {
			say(`Has ${row.fields.length} cells but the header has ${head.fields.length}. Quote any cell that holds a comma.`)
			continue
		}

		const category = cell("category").trim()
		const categoryValue =
			category === "" ? undefined : CATEGORY_ALIASES[category.toUpperCase().replaceAll(/[\s-]+/g, "_")]
		if (category !== "" && !categoryValue)
			say(`Category "${category}" is not one of: upgrade, consumable, misc, printer.`)

		const gated = bool(cell("gated"))
		if (gated === "bad") say(`Gated "${cell("gated").trim()}" should be yes or no.`)

		// Number("") is 0, so a blank cell would import a free item; it is refused like any other bad value.
		if (cell("price").trim() === "") {
			say("price: Price is required.")
			continue
		}

		const cost = cell("cost").trim()
		const image = cell("image").trim()
		const parsed = shopItemSchema.safeParse({
			description: cell("description").trim(),
			id: cell("slug").trim(),
			name: cell("name").trim(),
			priceCredits: num(cell("price")),
			...(categoryValue ? { category: categoryValue } : {}),
			costUsd: cost === "" ? null : num(cost),
			imageUrl: image === "" ? null : image,
			...(gated === true || gated === false ? { requiresPrinterQualified: gated } : {}),
		})

		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				const field =
					{ costUsd: "cost", id: "slug", imageUrl: "image", priceCredits: "price" }[String(issue.path[0])]
					?? String(issue.path[0] ?? "row")
				say(`${field}: ${issue.message}`)
			}
			continue
		}

		const first = seen.get(parsed.data.id)
		if (first !== undefined) {
			say(`Slug "${parsed.data.id}" is already used on line ${first}.`)
			continue
		}
		seen.set(parsed.data.id, row.line)
		items.push(parsed.data)
	}

	return problems.length > 0 ? { items: [], problems } : { items, problems }
}

export type { ShopCsvItem, ShopCsvProblem }
export { SHOP_CSV_COLUMNS, SHOP_CSV_MAX_ROWS, SHOP_CSV_TEMPLATE }
