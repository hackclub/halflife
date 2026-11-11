import { useMemo, useState, type ReactNode } from 'react'
import type { ParseResult } from 'papaparse'
import type { ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { formatBytes, formatNumber, plural } from '../core/format'
import { isZip, openZip } from '../core/archive'
import { isCfb } from '../core/cfb'
import { decodeText } from '../core/text'
import { Gate, Toolbar } from '../ui/parts'
import type { Sheet } from './office/xls'

const ROW_LIMIT = 5000
const EXCEL_COLUMNS = 16384
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi

async function readSheets(ext: string, name: string, bytes: ArrayBuffer): Promise<Sheet[]> {
  const head = new Uint8Array(bytes)
  if (name.startsWith('~$') && !isZip(head) && !isCfb(head))
    throw new Error('This is a lock file Excel leaves behind while a workbook is open. It has no content.')
  if (isCfb(head)) return (await import('./office/xls')).readXls(bytes)
  if (ext === 'xlsx' || ext === 'xlsm' || (ext === 'xls' && isZip(head))) return readXlsx(bytes)
  if (ext === 'ods') return readOds(bytes)
  const Papa = (await import('papaparse')).default
  const { text } = decodeText(bytes)
  const parse = (delimiter: string) => Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', delimiter })
  let parsed = parse(ext === 'tsv' ? '\t' : '')
  if (ext !== 'tsv' && quoteErrors(parsed)) {
    parsed =
      [';', '\t', '|', ',']
        .filter((d) => d !== parsed.meta.delimiter)
        .map(parse)
        .find((p) => !quoteErrors(p) && p.data.length > parsed.data.length) ?? parsed
  }
  if (parsed.data.length === 0 && parsed.errors.length > 0) throw new Error(parsed.errors[0].message)
  return [{ name: 'Sheet', rows: parsed.data }]
}

async function readXlsx(bytes: ArrayBuffer): Promise<Sheet[]> {
  const zip = openZip(bytes)
  const xml = async (name: string) => {
    const entry = zip.entries.find((e) => e.name === name)
    return entry
      ? new DOMParser().parseFromString(new TextDecoder().decode(await zip.read(entry)), 'application/xml')
      : null
  }
  const [workbook, rels, shared] = await Promise.all([
    xml('xl/workbook.xml'),
    xml('xl/_rels/workbook.xml.rels'),
    xml('xl/sharedStrings.xml'),
  ])
  if (!workbook) throw new Error('This spreadsheet has no workbook.')
  const strings = shared
    ? [...shared.getElementsByTagName('si')].map((si) =>
        [...si.getElementsByTagName('t')]
          .filter((t) => t.parentElement?.localName !== 'rPh')
          .map((t) => t.textContent)
          .join(''),
      )
    : []
  const targets = new Map(
    [...(rels?.getElementsByTagName('Relationship') ?? [])].map((r) => [
      r.getAttribute('Id'),
      r.getAttribute('Target') ?? '',
    ]),
  )

  const sheets: Sheet[] = []
  for (const sheet of workbook.getElementsByTagName('sheet')) {
    const target = targets.get(
      sheet.getAttribute('r:id') ??
        sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'),
    )
    if (!target) continue
    const doc = await xml(target.startsWith('/') ? target.slice(1) : `xl/${target}`)
    if (!doc) continue
    const rows: string[][] = []
    for (const row of doc.getElementsByTagName('row')) {
      const index = Number(row.getAttribute('r')) - 1
      const at = Number.isInteger(index) && index >= rows.length ? index : rows.length
      if (at >= ROW_LIMIT) break
      const cells: string[] = []
      for (const cell of row.getElementsByTagName('c')) {
        const column = columnIndex(cell.getAttribute('r') ?? '') ?? cells.length
        if (column >= EXCEL_COLUMNS) continue
        const type = cell.getAttribute('t')
        const value = cell.getElementsByTagName('v')[0]?.textContent ?? ''
        cells[column] =
          type === 's'
            ? (strings[Number(value)] ?? '')
            : type === 'inlineStr'
              ? [...cell.getElementsByTagName('t')].map((t) => t.textContent).join('')
              : type === 'b'
                ? value === '1'
                  ? 'TRUE'
                  : 'FALSE'
                : (type === null || type === 'n') && value !== ''
                  ? formatNumber(Number(value))
                  : value
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop()
      if (cells.length) rows[at] = Array.from(cells, (c) => c ?? '')
    }
    sheets.push({
      name: sheet.getAttribute('name') ?? `Sheet ${sheets.length + 1}`,
      rows: Array.from(rows, (r) => r ?? []),
    })
  }
  return sheets
}

function quoteErrors(parsed: ParseResult<string[]>) {
  return parsed.errors.some((e) => e.type === 'Quotes')
}

function columnIndex(ref: string) {
  const letters = ref.match(/^[A-Z]+/)?.[0]
  if (!letters) return null
  let index = 0
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

async function readOds(bytes: ArrayBuffer): Promise<Sheet[]> {
  const zip = openZip(bytes)
  const entry = zip.entries.find((e) => e.name === 'content.xml')
  if (!entry) throw new Error('This spreadsheet has no content.')
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(await zip.read(entry)), 'application/xml')
  const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
  return [...doc.getElementsByTagNameNS(TABLE, 'table')].map((table) => {
    const rows: string[][] = []
    for (const row of table.getElementsByTagNameNS(TABLE, 'table-row')) {
      const cells: string[] = []
      for (const cell of row.children) {
        if (cell.localName !== 'table-cell' && cell.localName !== 'covered-table-cell') continue
        const repeat = Math.min(Number(cell.getAttributeNS(TABLE, 'number-columns-repeated') ?? 1), 64)
        const text = [...cell.children]
          .filter((n) => n.localName === 'p' || n.localName === 'h')
          .map((n) => n.textContent)
          .join('\n')
        for (let i = 0; i < repeat; i++) cells.push(text)
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop()
      const repeatRows = Math.min(
        Number(row.getAttributeNS(TABLE, 'number-rows-repeated') ?? 1),
        cells.length ? 64 : ROW_LIMIT - rows.length,
      )
      for (let i = 0; i < repeatRows; i++) rows.push(cells)
      if (rows.length >= ROW_LIMIT) break
    }
    while (rows.length && rows[rows.length - 1].length === 0) rows.pop()
    return { name: table.getAttributeNS(TABLE, 'name') ?? 'Sheet', rows }
  })
}

const QTY = /^(qty|quantity|count|amount|pcs|units|#)\b/i
const UNIT_PRICE = /(unit\s*(price|cost)|price\s*(\/|per)\s*(unit|pc|piece|each)|^price$|^cost$|each)/i
const AMBIGUOUS_PRICE = /^(price|cost)$/i
const TOTAL = /(total|ext(ended)?\.?\s*price|line\s*(price|cost)|net\s*(price|cost))/i
const NOT_MONEY = /(running|cumulative|\b(qty|quantity|count|pcs|pieces|units)\b)/i
const SUMMARY = /\b(sub\s*)?totals?\b|\bsum\b/i
const THOUSANDS = /^-?\d{1,3}(,\d{3})+$/

function money(cell: string) {
  const cleaned = cell.replace(/[^\d.,-]/g, '')
  if (!cleaned) return null
  const comma = cleaned.lastIndexOf(',')
  const dot = cleaned.lastIndexOf('.')
  const decimalComma = comma > dot && (dot >= 0 || !THOUSANDS.test(cleaned))
  const value = Number(decimalComma ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

function bomTotal(rows: string[][]) {
  const header = rows[0]?.map((h) => h.trim()) ?? []
  const totalCol = header.findIndex((h) => TOTAL.test(h) && !NOT_MONEY.test(h))
  const qtyCol = header.findIndex((h) => QTY.test(h))
  const priceCol = header.findIndex((h, i) => i !== totalCol && UNIT_PRICE.test(h))
  if (totalCol < 0 && (qtyCol < 0 || priceCol < 0)) return null
  const valueCol = totalCol >= 0 ? totalCol : priceCol
  const summary = (row: string[]) => row.some((c, i) => i <= valueCol && c.length <= 40 && SUMMARY.test(c))
  const body = rows.slice(1).filter((r) => !summary(r))
  const symbol = body.map((r) => r[valueCol]?.match(/[$€£¥₹]/)?.[0]).find(Boolean) ?? ''
  let sum = 0
  let columnSum = 0
  let counted = 0
  for (const row of body) {
    const price = money(row[valueCol] ?? '')
    const value = totalCol >= 0 ? price : (money(row[qtyCol] ?? '') ?? 0) * (price ?? NaN)
    if (value === null || !Number.isFinite(value)) continue
    sum += value
    columnSum += price!
    counted++
  }
  if (counted === 0) return null
  const show = (n: number) => `${symbol}${n.toFixed(2)}`
  if (totalCol >= 0) return { text: show(sum), basis: `the ${header[totalCol]} column`, counted }
  const product = `${header[qtyCol]} × ${header[priceCol]}`
  if (!AMBIGUOUS_PRICE.test(header[priceCol])) return { text: show(sum), basis: product, counted }
  const stated = rows
    .slice(1)
    .filter(summary)
    .map((r) => money(r[valueCol] ?? ''))
    .filter((v): v is number => v !== null && v > 0)
    .pop()
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, b * 0.02)
  const column = `the ${header[priceCol]} column`
  if (stated === undefined)
    return { text: show(columnSum), basis: `${column} (${product} gives ${show(sum)})`, counted }
  if (near(columnSum, stated)) return { text: show(columnSum), basis: column, counted }
  if (near(sum, stated)) return { text: show(sum), basis: product, counted }
  return { text: show(stated), basis: "the file's own total row", counted: 0 }
}

export default function TableViewer({ file, source }: ViewerProps) {
  const [sheetIndex, setSheetIndex] = useState(0)
  const state = useLoad(
    async ({ signal }) => readSheets(file.ext, file.name, await source.read(file.path, { signal })),
    [source.id, file.path],
  )
  const sheet = state.status === 'ready' ? (state.value[sheetIndex] ?? state.value[0]) : null
  const total = useMemo(() => (sheet ? bomTotal(sheet.rows) : null), [sheet])
  const width = sheet ? Math.max(0, ...sheet.rows.map((r) => r.length)) : 0
  const hasHeader = !!sheet && sheet.rows.length > 1
  const body = sheet ? (hasHeader ? sheet.rows.slice(1) : sheet.rows) : []

  return (
    <div className="hurt-table">
      <Toolbar
        title={file.name}
        meta={sheet ? `${plural(body.length, 'row')} · ${formatBytes(file.size)}` : formatBytes(file.size)}
      >
        {state.status === 'ready' &&
          state.value.length > 1 &&
          state.value.map((s, i) => (
            <button
              key={s.name + i}
              type="button"
              className={i === sheetIndex ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
              onClick={() => setSheetIndex(i)}
            >
              {s.name}
            </button>
          ))}
      </Toolbar>
      {total && (
        <p className="hurt-table__total">
          Adds up to <strong>{total.text}</strong> from {total.basis}
          {total.counted > 0 && ` across ${plural(total.counted, 'row')}`}.
        </p>
      )}
      <Gate state={state}>
        {() =>
          sheet && sheet.rows.length > 0 ? (
            <div className="hurt-table__scroll">
              <table className="hurt-grid">
                {hasHeader && (
                  <thead>
                    <tr>
                      <th />
                      {Array.from({ length: width }, (_, i) => (
                        <th key={i}>
                          <Cell text={sheet.rows[0][i] ?? ''} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody>
                  {body.map((row, r) => (
                    <tr key={r}>
                      <td className="hurt-grid__n">{r + 1}</td>
                      {Array.from({ length: width }, (_, c) => {
                        const cell = row[c] ?? ''
                        return (
                          <td key={c}>
                            <Cell text={cell} />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {sheet.rows.length >= ROW_LIMIT && (
                <p className="hurt-text__note">Showing the first {ROW_LIMIT.toLocaleString()} rows.</p>
              )}
            </div>
          ) : (
            <p className="hurt-empty">This sheet is empty.</p>
          )
        }
      </Gate>
    </div>
  )
}

function Cell({ text }: { text: string }) {
  if (!text) return null
  const parts: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    const url = match[0]
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(
      <a
        key={match.index}
        href={url.startsWith('www.') ? `https://${url}` : url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {url}
      </a>,
    )
    last = match.index + url.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return (
    <span className="hurt-grid__cell" title={text.length > 40 ? text : undefined}>
      {parts}
    </span>
  )
}
