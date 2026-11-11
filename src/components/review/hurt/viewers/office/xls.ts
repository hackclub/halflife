import { openCfb } from '../../core/cfb'
import { formatNumber } from '../../core/format'

export interface Sheet {
  name: string
  rows: string[][]
}

interface BiffRecord {
  type: number
  offset: number
  parts: Uint8Array[]
}

const ROW_LIMIT = 5000
const COLUMN_LIMIT = 256
const STRING_LIMIT = 1 << 20
const BOF = 0x0809
const EOF = 0x000a
const CONTINUE = 0x003c
const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
const ERRORS: Record<number, string> = {
  0: '#NULL!',
  7: '#DIV/0!',
  15: '#VALUE!',
  23: '#REF!',
  29: '#NAME?',
  36: '#NUM!',
  42: '#N/A',
}

function latin1(slice: Uint8Array) {
  let out = ''
  for (const b of slice) out += String.fromCharCode(b)
  return out
}

function rkValue(rk: number) {
  let value: number
  if (rk & 2) value = rk >> 2
  else {
    const scratch = new DataView(new ArrayBuffer(8))
    scratch.setUint32(4, rk & 0xfffffffc, true)
    value = scratch.getFloat64(0, true)
  }
  return rk & 1 ? value / 100 : value
}

function isDateFormat(code: string) {
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim())
}

function formatDate(serial: number, date1904: boolean) {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return formatNumber(serial)
  const days = date1904 ? serial + 1462 : serial < 60 ? serial + 1 : serial
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(days * 86400) * 1000)
  const iso = date.toISOString()
  if (serial < 1) return iso.slice(11, 16)
  return serial % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10)
}

function records(stream: Uint8Array) {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength)
  const list: BiffRecord[] = []
  for (let at = 0; at + 4 <= stream.length; ) {
    const type = view.getUint16(at, true)
    const length = view.getUint16(at + 2, true)
    const data = stream.subarray(at + 4, Math.min(stream.length, at + 4 + length))
    if (type === CONTINUE && list.length) list[list.length - 1].parts.push(data)
    else list.push({ type, offset: at, parts: [data] })
    at += 4 + length
  }
  return list
}

function cursor(parts: Uint8Array[], biff8: boolean, decode: (bytes: Uint8Array) => string) {
  let part = 0
  let pos = 0
  const current = () => parts[part] as Uint8Array | undefined
  const settle = () => {
    while (part < parts.length && pos >= parts[part].length) {
      part++
      pos = 0
    }
  }
  const u8 = () => {
    settle()
    const chunk = current()
    return chunk ? chunk[pos++] : 0
  }
  const u16 = () => u8() | (u8() << 8)
  const u32 = () => (u16() | (u16() << 16)) >>> 0
  const take = (n: number) => {
    settle()
    const chunk = current()
    const out = chunk ? chunk.subarray(pos, pos + n) : new Uint8Array(0)
    pos += n
    return out
  }
  const skip = (n: number) => {
    while (n > 0) {
      settle()
      const chunk = current()
      if (!chunk) return
      const step = Math.min(n, chunk.length - pos)
      pos += step
      n -= step
    }
  }
  const chars = (count: number, wide: boolean) => {
    let out = ''
    while (count > 0) {
      const chunk = current()
      if (!chunk) break
      const width = wide ? 2 : 1
      const n = Math.min(count, Math.floor((chunk.length - pos) / width))
      const slice = chunk.subarray(pos, pos + n * width)
      out += wide ? new TextDecoder('utf-16le').decode(slice) : latin1(slice)
      pos += n * width
      count -= n
      if (count > 0) {
        part++
        pos = 0
        const next = current()
        if (!next || next.length === 0) break
        wide = (next[pos++] & 1) === 1
      }
    }
    return out
  }
  const text = (lengthBytes: 1 | 2 = 2) => {
    const length = lengthBytes === 1 ? u8() : u16()
    if (!biff8) return decode(take(length))
    const flags = u8()
    const rich = flags & 8 ? u16() : 0
    const extended = flags & 4 ? u32() : 0
    const value = chars(length, (flags & 1) === 1)
    skip(rich * 4 + extended)
    return value
  }
  const f64 = () => {
    const b = new Uint8Array(8)
    for (let i = 0; i < 8; i++) b[i] = u8()
    return new DataView(b.buffer).getFloat64(0, true)
  }
  return { u8, u16, u32, f64, take, text }
}

export function readXls(buffer: ArrayBuffer): Sheet[] {
  try {
    return parseXls(buffer)
  } catch (error) {
    if (error instanceof RangeError) throw new Error('This spreadsheet is damaged or cut short.')
    throw error
  }
}

function parseXls(buffer: ArrayBuffer): Sheet[] {
  const cfb = openCfb(buffer)
  const stream = cfb.read('Workbook') ?? cfb.read('Book')
  if (!stream) throw new Error('This file has no Excel workbook in it.')
  const list = records(stream)

  let biff8 = true
  let codepage = 1252
  const decode = (bytes: Uint8Array) => {
    try {
      return new TextDecoder(codepage === 1200 ? 'utf-16le' : `windows-${codepage}`).decode(bytes)
    } catch {
      return new TextDecoder('windows-1252').decode(bytes)
    }
  }
  const sheets: { offset: number; kind: number; name: string }[] = []
  let strings: string[] = []
  let date1904 = false
  const formats = new Map<number, string>()
  const styles: number[] = []

  for (const record of list) {
    const c = cursor(record.parts, biff8, decode)
    if (record.type === BOF && record.offset === 0) biff8 = c.u16() === 0x0600
    else if (record.type === 0x002f) throw new Error('This spreadsheet is password protected.')
    else if (record.type === 0x0042) codepage = c.u16()
    else if (record.type === 0x0022) date1904 = c.u16() === 1
    else if (record.type === 0x041e) {
      const index = c.u16()
      formats.set(index, biff8 ? c.text() : decode(c.take(c.u8())))
    } else if (record.type === 0x00e0 && styles.length < 65536) {
      c.u16()
      styles.push(c.u16())
    } else if (record.type === 0x0085) {
      const offset = c.u32()
      c.u8()
      const kind = c.u8()
      const name = biff8 ? c.text(1) : decode(c.take(c.u8()))
      sheets.push({ offset, kind, name })
    } else if (record.type === 0x00fc) {
      c.u32()
      const unique = Math.min(c.u32(), STRING_LIMIT)
      const size = record.parts.reduce((sum, p) => sum + p.length, 0)
      strings = []
      for (let i = 0; i < unique && i < size; i++) strings.push(c.text())
    } else if (record.type === EOF) break
  }

  const dateStyles = new Map<number, boolean>()
  const dateStyle = (index: number) => {
    let known = dateStyles.get(index)
    if (known === undefined) {
      const format = styles[index] ?? 0
      known = BUILTIN_DATES.has(format) || isDateFormat(formats.get(format) ?? '')
      dateStyles.set(index, known)
    }
    return known
  }

  const byOffset = new Map(list.map((r, i) => [r.offset, i]))
  const result: Sheet[] = []
  for (const meta of sheets) {
    if (meta.kind !== 0) continue
    let i = byOffset.get(meta.offset)
    if (i === undefined) continue
    const rows: string[][] = []
    const set = (row: number, column: number, value: string) => {
      if (row < ROW_LIMIT && column < COLUMN_LIMIT) (rows[row] ??= [])[column] = value
    }
    let pending: { row: number; column: number } | null = null
    for (i++; i < list.length; i++) {
      const record = list[i]
      if (record.type === EOF) break
      if (record.type === BOF) {
        for (let depth = 1; depth > 0 && ++i < list.length; ) {
          if (list[i].type === BOF) depth++
          else if (list[i].type === EOF) depth--
        }
        continue
      }
      const c = cursor(record.parts, biff8, decode)
      let style = 0
      const cell = () => {
        const row = c.u16()
        const column = c.u16()
        style = c.u16()
        return [row, column] as const
      }
      const number = (value: number) => (dateStyle(style) ? formatDate(value, date1904) : formatNumber(value))
      switch (record.type) {
        case 0x00fd: {
          const [row, column] = cell()
          set(row, column, strings[c.u32()] ?? '')
          break
        }
        case 0x0203: {
          const [row, column] = cell()
          set(row, column, number(c.f64()))
          break
        }
        case 0x027e: {
          const [row, column] = cell()
          set(row, column, number(rkValue(c.u32() | 0)))
          break
        }
        case 0x00bd: {
          const row = c.u16()
          const first = c.u16()
          const count = Math.max(0, Math.floor((record.parts[0].length - 6) / 6))
          for (let k = 0; k < count; k++) {
            style = c.u16()
            set(row, first + k, number(rkValue(c.u32() | 0)))
          }
          break
        }
        case 0x0204:
        case 0x00d6: {
          const [row, column] = cell()
          set(row, column, c.text())
          break
        }
        case 0x0205: {
          const [row, column] = cell()
          const value = c.u8()
          set(row, column, c.u8() ? (ERRORS[value] ?? '#ERR') : value ? 'TRUE' : 'FALSE')
          break
        }
        case 0x0006: {
          const [row, column] = cell()
          const raw = c.take(8)
          if (raw.length < 8) break
          if (raw[6] === 0xff && raw[7] === 0xff) {
            if (raw[0] === 0) pending = { row, column }
            else if (raw[0] === 1) set(row, column, raw[2] ? 'TRUE' : 'FALSE')
            else if (raw[0] === 2) set(row, column, ERRORS[raw[2]] ?? '#ERR')
          } else {
            set(row, column, number(new DataView(raw.buffer, raw.byteOffset, 8).getFloat64(0, true)))
          }
          break
        }
        case 0x0207: {
          if (pending) set(pending.row, pending.column, c.text())
          pending = null
          break
        }
      }
    }
    result.push({
      name: meta.name || `Sheet ${result.length + 1}`,
      rows: Array.from(rows, (row) => Array.from(row ?? [], (value) => value ?? '')),
    })
  }
  if (result.length === 0) throw new Error('This workbook has no worksheets.')
  return result
}
