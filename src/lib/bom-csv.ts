/**
 * A BOM CSV from a maker's own repo, read into the platform's parts list.
 *
 * These files come from whatever tool the maker used – KiCad's BOM export, EasyEDA, a hand-kept spreadsheet – so there is no one shape to parse. What this does instead is find the header row, map the columns whose names it recognises, and take what it can from each row. Nothing is required to be present: a file with only a part name and a price imports, and the fields the platform insists on (what it's for, the vendor) are left blank for the maker to fill in on the page.
 *
 * Kept pure and dependency-free so the contract tests can drive it directly.
 */

/** One line read out of a CSV, in the shape the parts table stores. */
export interface ImportedBomLine {
	name: string
	/** Never mapped from a CSV unless the file names a purpose column. */
	purpose: string | null
	quantity: number
	/** Zero when the file carried no price the parser could read. */
	unitCostUsd: number
	vendor: string | null
	link: string | null
}

/** A data row the parser chose not to import, and why. */
export interface SkippedRow {
	/** 1-based line in the file, header included, so the maker can find it. */
	row: number
	/** The part name as the file spelled it, for saying it back. */
	name: string
	reason: string
}

export interface ParsedBom {
	/** The header cells, or null when no header row could be found. */
	header: string[] | null
	lines: ImportedBomLine[]
	skipped: SkippedRow[]
}

/** The platform's own caps, mirrored here so a file cannot exceed them. */
export const MAX_IMPORT_NAME = 120
export const MAX_IMPORT_VENDOR = 80
export const MAX_IMPORT_PRICE = 10_000
export const MAX_IMPORT_QTY = 10_000

/** How many leading rows are searched for the header, before giving up. */
const HEADER_SEARCH_ROWS = 20

type Field = "name" | "purpose" | "quantity" | "unitCostUsd" | "vendor" | "link"

/** Normalised header names, tried in this order when a field is ambiguous. */
const ALIASES: Record<Field, readonly string[]> = {
	name: [
		"item",
		"name",
		"part",
		"part name",
		"part number",
		"component",
		"component name",
		"device",
		"comment",
		"value",
		"description",
		"title",
		"mpn",
		"manufacturer part number",
	],
	purpose: ["purpose", "what its for", "what it is for", "function", "description", "notes", "note"],
	quantity: ["qty", "quantity", "count", "number", "amount", "pcs", "pieces"],
	unitCostUsd: [
		"unit price",
		"unit cost",
		"unit price usd",
		"unit cost usd",
		"price",
		"price usd",
		"cost",
		"unit dollar",
		"each",
		"unit price each",
	],
	vendor: ["vendor", "supplier", "manufacturer", "distributor", "mfr", "seller", "store", "source"],
	link: [
		"link",
		"url",
		"product link",
		"product url",
		"supplier link",
		"supplier part url",
		"buy link",
		"purchase link",
	],
}

const FIELD_ORDER: readonly Field[] = ["name", "purpose", "quantity", "unitCostUsd", "vendor", "link"]

/**
 * A row that names an order total rather than a part. A BOM exported from a spreadsheet often ends with one of these, and importing "Shipping" as a ceramic capacitor's sibling would be worse than dropping it and saying so.
 */
const NOT_A_PART = /^(shipping|postage|delivery|handling|tax|vat|gst|discount|subtotal|sub total|grand total|total)\b/i

/** `Unit Price (USD)` -> `unit price usd`, so aliases compare cleanly. */
function normalize(cell: string): string {
	return cell
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
}

/**
 * Split CSV text into rows and cells, honouring quotes.
 *
 * The RFC's shape, not its every clause: quoted fields may contain commas and newlines, a doubled quote is a literal quote, and a bare CR is ignored. That covers what the exporters emit – the one thing worth noting is that a BOM with a part description containing a comma is exactly the case that breaks a naive `split(",")`.
 */
function parseRows(input: string): string[][] {
	// A UTF-8 BOM is invisible and would otherwise become part of the first header cell, so the name column is never found.
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
	const rows: string[][] = []
	let row: string[] = []
	let field = ""
	let quoted = false

	const push = () => {
		row.push(field)
		field = ""
	}
	const endRow = () => {
		push()
		rows.push(row)
		row = []
	}

	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"'
					i++
				} else quoted = false
			} else field += ch
			continue
		}
		if (ch === '"') quoted = true
		else if (ch === ",") push()
		else if (ch === "\n") endRow()
		else if (ch !== "\r") field += ch
	}
	if (field !== "" || row.length > 0) endRow()

	return rows
}

/** Which column each field lives in, by the names its cells carry. */
function mapHeader(row: readonly string[]): Partial<Record<Field, number>> {
	const map: Partial<Record<Field, number>> = {}
	row.forEach((cell, index) => {
		const key = normalize(cell)
		if (!key) return
		for (const field of FIELD_ORDER) {
			if (map[field] !== undefined) continue
			if (ALIASES[field].includes(key)) {
				map[field] = index
				break
			}
		}
	})
	return map
}

/**
 * The header row, preferring the first one that names enough columns to be recognisable. A file may open with a title or an export date; those rows map to nothing and are passed over.
 */
function findHeader(rows: readonly string[][]): { index: number; map: Partial<Record<Field, number>> } | null {
	const limit = Math.min(rows.length, HEADER_SEARCH_ROWS)
	let fallback: { index: number; map: Partial<Record<Field, number>> } | null = null
	for (let i = 0; i < limit; i++) {
		const map = mapHeader(rows[i] ?? [])
		if (map.name === undefined) continue
		if (Object.keys(map).length >= 2) return { index: i, map }
		fallback ??= { index: i, map }
	}
	return fallback
}

/** Markdown links keep their label; other markup is stripped by the route. */
function cleanName(value: string): string {
	return value
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_IMPORT_NAME)
}

/** `"100pc"`, `"1 set"`, `"2"` -> a whole number of parts. */
function parseQuantity(value: string | undefined): number {
	const match = (value ?? "").replace(/,/g, "").match(/\d+/)
	if (!match) return 1
	const n = Number(match[0])
	if (!Number.isFinite(n) || n < 1) return 1
	return Math.min(n, MAX_IMPORT_QTY)
}

/**
 * A dollar figure from a price cell, whatever currency it leads with.
 *
 * Hand-kept BOMs carry things like `Rs. 1300 (~ $15)` and `$0.60 (~ Rs. 60)`; the dollar amount is the one the platform prices in, so it is read wherever it appears. A cell that is a bare number is taken too. Null means the file gave no price at all.
 */
function parseUsd(value: string | undefined): number | null {
	const v = (value ?? "").trim()
	if (!v) return null
	const raw = v.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/)?.[1] ?? v.match(/^\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/)?.[1]
	if (!raw) return null
	const n = Number(raw.replace(/,/g, ""))
	if (!Number.isFinite(n) || n < 0) return null
	return n
}

/**
 * A usable product URL, or null.
 *
 * `JLCPCB` and `0` sit in link columns about as often as URLs do, so a value is only kept when it parses with a real host. A bare domain gains its scheme so `lcsc.com/product/1` survives.
 */
function parseLink(value: string | undefined): string | null {
	let v = (value ?? "").trim()
	if (!v || /^[-––]+$/.test(v) || /^(n\/?a|none)$/i.test(v)) return null
	const markdown = v.match(/\]\(\s*([^)]+?)\s*\)/)
	if (markdown) v = markdown[1] ?? v
	if (!/^https?:\/\//i.test(v)) v = `https://${v}`
	if (v.length > 1000) return null
	try {
		const url = new URL(v)
		if (url.protocol !== "http:" && url.protocol !== "https:") return null
		if (!url.hostname.includes(".")) return null
		return v
	} catch {
		return null
	}
}

/**
 * Common suppliers, so `lcsc.com` reads as LCSC rather than Lcsc. Anything not here still gets the registrable label, title-cased, which is close enough to edit and better than a blank next to a link the maker already has.
 */
const KNOWN_VENDORS: Record<string, string> = {
	"lcsc.com": "LCSC",
	"jlcpcb.com": "JLCPCB",
	"mouser.com": "Mouser",
	"digikey.com": "DigiKey",
	"amazon.com": "Amazon",
	"amazon.in": "Amazon",
	"aliexpress.com": "AliExpress",
	"adafruit.com": "Adafruit",
	"sparkfun.com": "SparkFun",
	"robu.in": "Robu",
	"stackskb.com": "StacksKB",
	"thecosmicbyte.com": "Cosmic Byte",
}

function vendorFromLink(link: string | null): string | null {
	if (!link) return null
	try {
		const host = new URL(link).hostname.replace(/^www\./, "").toLowerCase()
		const known = KNOWN_VENDORS[host]
		if (known) return known.slice(0, MAX_IMPORT_VENDOR)
		const labels = host.split(".")
		const label = labels.length >= 2 ? labels[labels.length - 2] : labels[0]
		if (!label) return null
		const named = label.length <= 4 ? label.toUpperCase() : label.charAt(0).toUpperCase() + label.slice(1)
		return named.slice(0, MAX_IMPORT_VENDOR)
	} catch {
		return null
	}
}

/** Trim, collapse whitespace, cap – the same treatment every other maker text gets. */
function clean(value: string | undefined, max: number): string | null {
	const v = (value ?? "").replace(/\s+/g, " ").trim()
	return v ? v.slice(0, max) : null
}

/**
 * A whole CSV file's rows, as parts to import.
 *
 * `limit` bounds what a single import may add – the route passes what is left of the parts-list cap, and the overflow is reported as skipped rather than silently dropped.
 */
export function parseBomCsv(text: string, opts: { limit?: number } = {}): ParsedBom {
	const limit = opts.limit ?? Number.POSITIVE_INFINITY
	const rows = parseRows(text)
	const head = findHeader(rows)
	if (!head) return { header: null, lines: [], skipped: [] }

	const { index, map } = head
	const nameCol = map.name
	// `findHeader` only returns a row whose name column it found, so this cannot happen; the guard is for the type, which cannot know that.
	if (nameCol === undefined) return { header: null, lines: [], skipped: [] }
	// A single `Description` column is the name; it is only also a purpose when the file has a separate column for it.
	const purposeCol = map.purpose !== undefined && map.purpose !== nameCol ? map.purpose : undefined
	const lines: ImportedBomLine[] = []
	const skipped: SkippedRow[] = []

	for (let i = index + 1; i < rows.length; i++) {
		const cells = rows[i] ?? []
		if (cells.every((c) => c.trim() === "")) continue

		// 1-based, counting the header as line 1 of the file as a person sees it.
		const rowNumber = i + 1
		const name = cleanName(cells[nameCol] ?? "")
		if (!name) {
			skipped.push({ row: rowNumber, name: "", reason: "no part name" })
			continue
		}
		if (ALIASES.name.includes(normalize(name))) {
			skipped.push({ row: rowNumber, name, reason: "repeats the header" })
			continue
		}
		if (NOT_A_PART.test(name)) {
			skipped.push({ row: rowNumber, name, reason: "looks like an order total, not a part" })
			continue
		}

		const price = parseUsd(map.unitCostUsd !== undefined ? cells[map.unitCostUsd] : undefined)
		if (price !== null && price > MAX_IMPORT_PRICE) {
			skipped.push({ row: rowNumber, name, reason: `unit price is above $${MAX_IMPORT_PRICE}` })
			continue
		}
		if (lines.length >= limit) {
			skipped.push({ row: rowNumber, name, reason: "beyond the parts-list limit" })
			continue
		}

		const link = parseLink(map.link !== undefined ? cells[map.link] : undefined)
		const vendor =
			clean(map.vendor !== undefined ? cells[map.vendor] : undefined, MAX_IMPORT_VENDOR) ?? vendorFromLink(link)

		lines.push({
			name,
			purpose: purposeCol !== undefined ? clean(cells[purposeCol], 200) : null,
			quantity: parseQuantity(map.quantity !== undefined ? cells[map.quantity] : undefined),
			unitCostUsd: price ?? 0,
			vendor,
			link,
		})
	}

	return { header: rows[index] ?? null, lines, skipped }
}
