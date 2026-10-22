/**
 * CSV, in the RFC 4180 shape every spreadsheet exports: commas, double-quoted fields that may hold commas and line breaks, and `""` for a literal quote.
 *
 * The parser existed three times – the shop import, the Macondo import and the BOM import – and the writer a fourth. The shop and Macondo copies were byte-identical; the BOM copy was the same algorithm without the line bookkeeping. Each import's error messages point at a line, so the line-aware shape is the canonical one.
 */

export interface CsvRecord {
	fields: string[]
	/** 1-based line in the file where this record started, the header being line 1. */
	line: number
}

/** A UTF-8 BOM is invisible and would otherwise become part of the first header cell. */
function stripBom(text: string): string {
	return text.codePointAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Split CSV text into records, carrying the line each one started on.
 *
 * Blank rows are dropped: spreadsheets pad the end with them, and they are never data.
 */
export function parseCsvRecords(input: string): CsvRecord[] {
	const text = stripBom(input)
	const out: CsvRecord[] = []
	let fields: string[] = []
	let field = ""
	let quoted = false
	let line = 1
	let start = 1

	for (let i = 0; i < text.length; i += 1) {
		const c = text[i]
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"'
				i += 1
			} else if (c === '"') quoted = false
			else if (c === "\r" && text[i + 1] === "\n") {
				// A Windows line break inside a cell is still one break; the \n on the next pass is counted.
			} else {
				if (c === "\n") line += 1
				field += c
			}
			continue
		}
		if (c === '"') quoted = true
		else if (c === ",") {
			fields.push(field)
			field = ""
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i += 1
			fields.push(field)
			out.push({ fields, line: start })
			fields = []
			field = ""
			line += 1
			start = line
		} else field += c
	}

	if (field !== "" || fields.length > 0) {
		fields.push(field)
		out.push({ fields, line: start })
	}

	return out.filter(record => record.fields.some(cell => cell.trim() !== ""))
}

/** The same records without the line bookkeeping, for a caller that only walks the cells. */
export function parseCsvRows(input: string): string[][] {
	return parseCsvRecords(input).map(record => record.fields)
}

/**
 * One cell, quoted when it has to be.
 *
 * A parts link is a query string, and those are full of commas – unquoted, a link lets a seventh cell into the row and every spreadsheet mis-parses it.
 */
export function csvCell(value: string | number): string {
	const text = String(value)
	if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
	return text
}

/** One row, cells quoted individually. */
export function csvRow(cells: (string | number)[]): string {
	return cells.map(csvCell).join(",")
}
