export type SqlValue = null | number | string | Uint8Array
export type Row = Record<string, SqlValue>

const HEADER = 'SQLite format 3\0'
const MAX_PAYLOAD = 64 * 1024 * 1024
const INTERIOR_TABLE = 0x05
const LEAF_TABLE = 0x0d
const INT_SIZES = [0, 1, 2, 3, 4, 6, 8]

export function isSqlite(bytes: Uint8Array) {
  return bytes.length >= 100 && new TextDecoder('latin1').decode(bytes.subarray(0, 16)) === HEADER
}

function parseColumns(sql: string) {
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'))
  const defs: string[] = []
  let depth = 0
  let start = 0
  let quote = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '[') quote = ']'
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      defs.push(body.slice(start, i))
      start = i + 1
    }
  }
  defs.push(body.slice(start))
  return defs
    .map((d) => d.trim())
    .filter((d) => d && !/^(constraint|primary|unique|foreign|check)\b/i.test(d))
    .map((d) => {
      const m = /^(?:"([^"]+)"|'([^']+)'|`([^`]+)`|\[([^\]]+)\]|(\S+))\s*([\s\S]*)$/.exec(d)
      const rest = m?.[6] ?? ''
      return {
        name: m?.[1] ?? m?.[2] ?? m?.[3] ?? m?.[4] ?? m?.[5] ?? '',
        rowid: /^integer\b/i.test(rest) && /primary\s+key/i.test(rest),
      }
    })
}

export function openSqlite(bytes: Uint8Array) {
  if (!isSqlite(bytes)) throw new Error('This is not an SQLite database.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const raw = view.getUint16(16)
  const pageSize = raw === 1 ? 65536 : raw
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) throw new Error('This SQLite database is damaged.')
  if (view.getUint32(56) > 1) throw new Error('This SQLite database is not UTF-8, so the viewer cannot read it.')
  const usable = pageSize - bytes[20]
  const pageCount = Math.floor(bytes.length / pageSize)
  const utf8 = new TextDecoder()

  const pageStart = (n: number) => {
    if (!Number.isInteger(n) || n < 1 || n > pageCount) throw new RangeError('SQLite page out of range.')
    return (n - 1) * pageSize
  }

  const varint = (data: Uint8Array, o: number): [number, number] => {
    let v = 0
    for (let i = 0; i < 8; i++) {
      const b = data[o + i] ?? 0
      v = v * 128 + (b & 0x7f)
      if (b < 0x80) return [v, i + 1]
    }
    return [v * 256 + (data[o + 8] ?? 0), 9]
  }

  const payloadOf = (cell: number, total: number) => {
    if (total > Math.min(MAX_PAYLOAD, bytes.length)) throw new RangeError('SQLite record is too large.')
    const maxLocal = usable - 35
    if (total <= maxLocal) return bytes.subarray(cell, cell + total)
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23
    const k = minLocal + ((total - minLocal) % (usable - 4))
    const local = k <= maxLocal ? k : minLocal
    const out = new Uint8Array(total)
    out.set(bytes.subarray(cell, cell + local))
    let pos = local
    let next = view.getUint32(cell + local)
    const seen = new Set<number>()
    while (pos < total && next !== 0 && !seen.has(next)) {
      seen.add(next)
      const start = pageStart(next)
      const n = Math.min(usable - 4, total - pos)
      out.set(bytes.subarray(start + 4, start + 4 + n), pos)
      pos += n
      next = view.getUint32(start)
    }
    if (pos < total) throw new RangeError('SQLite record is cut short.')
    return out
  }

  const decodeRecord = (p: Uint8Array): SqlValue[] => {
    const pv = new DataView(p.buffer, p.byteOffset, p.byteLength)
    const [headerSize, n] = varint(p, 0)
    const types: number[] = []
    for (let o = n; o < Math.min(headerSize, p.length); ) {
      const [t, len] = varint(p, o)
      types.push(t)
      o += len
    }
    const values: SqlValue[] = []
    let o = headerSize
    for (const t of types) {
      if (t >= 12) {
        const len = Math.floor((t - 12) / 2)
        const slice = p.subarray(o, o + len)
        values.push(t % 2 ? utf8.decode(slice) : slice)
        o += len
      } else if (t === 7) {
        values.push(pv.getFloat64(o))
        o += 8
      } else if (t >= 1 && t <= 6) {
        const n = INT_SIZES[t]
        let v = pv.getInt8(o)
        for (let i = 1; i < n; i++) v = v * 256 + pv.getUint8(o + i)
        values.push(v)
        o += n
      } else values.push(t === 8 ? 0 : t === 9 ? 1 : null)
    }
    return values
  }

  function* scan(root: number): Generator<{ rowid: number; values: SqlValue[] }> {
    const stack = [root]
    const visited = new Set<number>()
    while (stack.length) {
      const page = stack.pop()!
      if (visited.has(page)) continue
      visited.add(page)
      const base = pageStart(page)
      const h = page === 1 ? base + 100 : base
      const type = bytes[h]
      const cells = Math.min(view.getUint16(h + 3), pageSize)
      if (type === INTERIOR_TABLE) {
        const children: number[] = []
        for (let i = 0; i < cells; i++) children.push(view.getUint32(base + view.getUint16(h + 12 + i * 2)))
        children.push(view.getUint32(h + 8))
        for (let i = children.length - 1; i >= 0; i--)
          if (children[i] >= 1 && children[i] <= pageCount) stack.push(children[i])
      } else if (type === LEAF_TABLE) {
        for (let i = 0; i < cells; i++) {
          let row: { rowid: number; values: SqlValue[] } | null = null
          try {
            let o = base + view.getUint16(h + 8 + i * 2)
            const [total, a] = varint(bytes, o)
            o += a
            const [rowid, b] = varint(bytes, o)
            row = { rowid, values: decodeRecord(payloadOf(o + b, total)) }
          } catch {
            row = null
          }
          if (row) yield row
        }
      }
    }
  }

  const tables = new Map<string, { root: number; columns: string[]; rowidAlias: number }>()
  for (const { values } of scan(1)) {
    const [type, name, , root, sql] = values
    if (type !== 'table' || typeof name !== 'string' || typeof root !== 'number' || typeof sql !== 'string') continue
    const columns = parseColumns(sql)
    tables.set(name, { root, columns: columns.map((c) => c.name), rowidAlias: columns.findIndex((c) => c.rowid) })
  }

  return {
    *rows(table: string): Generator<Row> {
      const t = tables.get(table)
      if (!t) return
      for (const { rowid, values } of scan(t.root)) {
        const row: Row = {}
        t.columns.forEach((c, i) => (row[c] = i === t.rowidAlias ? rowid : (values[i] ?? null)))
        yield row
      }
    },
  }
}
