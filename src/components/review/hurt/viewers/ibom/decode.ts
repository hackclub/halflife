import { decompressFromBase64 } from './lzstring'
import { EASYEDA_MARKER, sniffBomHtml } from './sniff'
import { circlePath, emptyBounds, f, grow, partAt, type Bounds, type Box, type Point, type Side } from './geometry'

export type Raw = Record<string, unknown>

export interface Footprint {
  ref: string
  side: Side
  bbox: Box
  pads: Raw[]
  drawings: { layer: Side; drawing: Raw }[]
  excluded: boolean
}

export interface IbomDocument {
  format: NonNullable<ReturnType<typeof sniffBomHtml>>
  generator: string
  metadata: { title: string; revision: string; company: string; date: string }
  columns: string[]
  rows: { ids: number[]; values: string[] }[]
  footprints: Footprint[]
  excludedLabel: string
  pin1: 'none' | 'all' | 'selected'
  board: {
    bounds: Bounds | null
    edges: Raw[]
    silk: Record<Side, Raw[]>
    fab: Record<Side, Raw[]>
    tracks: Record<Side, Raw[]>
    zones: Record<Side, Raw[]>
    pads: Record<Side, Raw[]>
    fontText: boolean
  }
}

const MIL10 = 0.254

export function decodeBomHtml(text: string): IbomDocument {
  const format = sniffBomHtml(text)
  if (format === 'kicad') return decodeKicad(text)
  if (format === 'easyeda') return decodeEasyEda(text)
  throw new Error('This page has no interactive BOM data.')
}

export function num(value: unknown, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function point(value: unknown): Point {
  return Array.isArray(value) ? [num(value[0]), num(value[1])] : [0, 0]
}

export function list<T = Raw>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function record(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {}
}

function text(value: unknown): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.map(text).join(', ')
  return typeof value === 'object' ? '' : String(value)
}

function sides(value: unknown): Record<Side, Raw[]> {
  const r = record(value)
  return { F: list(r.F), B: list(r.B) }
}

function emptySides(): Record<Side, Raw[]> {
  return { F: [], B: [] }
}

function sliceJson(source: string, from: number) {
  let depth = 0
  let quoted = false
  for (let i = from; i < source.length; i++) {
    const c = source.charCodeAt(i)
    if (quoted) {
      if (c === 92) i++
      else if (c === 34) quoted = false
    } else if (c === 34) quoted = true
    else if (c === 123 || c === 91) depth++
    else if (c === 125 || c === 93) {
      if (--depth === 0) return source.slice(from, i + 1)
    } else if (depth === 0 && c > 32) break
  }
  throw new Error('The BOM data in this page is cut short.')
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    throw new Error('The BOM data in this page is damaged.')
  }
}

function readVar(source: string, name: string): unknown {
  const marker = `var ${name} = `
  const at = source.indexOf(marker)
  if (at < 0) return undefined
  const start = at + marker.length
  const packed = 'JSON.parse(LZString.decompressFromBase64("'
  if (source.startsWith(packed, start)) {
    const open = start + packed.length
    const close = source.indexOf('"', open)
    if (close < 0) throw new Error('The BOM data in this page is cut short.')
    const json = decompressFromBase64(source.slice(open, close))
    if (!json) throw new Error('The BOM data in this page did not decompress.')
    return parseJson(json)
  }
  return parseJson(sliceJson(source, start))
}

function optional<T>(read: () => T) {
  try {
    return read()
  } catch {
    return undefined
  }
}

function readBox(value: unknown): Box {
  const b = record(value)
  return { pos: point(b.pos), relpos: point(b.relpos), size: point(b.size), angle: num(b.angle) }
}

function readBounds(value: unknown): Bounds | null {
  const b = record(value)
  const bounds = { minx: num(b.minx, NaN), miny: num(b.miny, NaN), maxx: num(b.maxx, NaN), maxy: num(b.maxy, NaN) }
  return Object.values(bounds).every(Number.isFinite) && bounds.maxx > bounds.minx && bounds.maxy > bounds.miny
    ? bounds
    : null
}

function decodeKicad(source: string): IbomDocument {
  const pcb = record(readVar(source, 'pcbdata'))
  const config = record(optional(() => readVar(source, 'config')))
  const rawFootprints = list(pcb.footprints ?? pcb.modules)
  if (rawFootprints.length === 0 && !pcb.bom) throw new Error('This interactive BOM has no parts.')
  const bom = record(pcb.bom)
  const skipped = new Set(list<number>(bom.skipped).map((id) => num(id, -1)))
  const footprints: Footprint[] = rawFootprints.map((raw, id) => {
    const fp = record(raw)
    return {
      ref: text(fp.ref),
      side: fp.layer === 'B' ? 'B' : 'F',
      bbox: readBox(fp.bbox),
      pads: list(fp.pads).map(record),
      drawings: list(fp.drawings).map((d) => {
        const r = record(d)
        return { layer: r.layer === 'B' ? 'B' : 'F', drawing: record(r.drawing) }
      }),
      excluded: skipped.has(id),
    }
  })
  const valid = (id: unknown) => {
    const n = num(id, -1)
    return Number.isInteger(n) && n >= 0 && n < footprints.length ? n : -1
  }
  const groups = list<unknown[]>(bom.both ?? bom.F)
  let columns = list(config.fields).map(text)
  let rows: IbomDocument['rows']
  if (groups.length > 0 && typeof list(groups[0])[0] === 'number') {
    columns = ['Value', 'Footprint', ...list(config.extra_fields).map(text)]
    rows = groups.map((group) => {
      const g = list<unknown>(group)
      const ids = list<unknown[]>(g[3]).map((pair) => valid(list(pair)[1]))
      return { ids: ids.filter((id) => id >= 0), values: [text(g[1]), text(g[2]), ...list(g[4]).map(text)] }
    })
    while (columns.length < Math.max(0, ...rows.map((r) => r.values.length)))
      columns.push(`Field ${columns.length + 1}`)
  } else {
    if (columns.length === 0) columns = ['Value', 'Footprint']
    const values = record(bom.fields)
    rows = groups.map((group) => {
      const ids = list<unknown[]>(group)
        .map((pair) => valid(list(pair)[1]))
        .filter((id) => id >= 0)
      const first = ids.find((id) => Array.isArray(values[id])) ?? ids[0]
      return { ids, values: list(values[first]).map(text) }
    })
  }
  const metadata = record(pcb.metadata)
  const drawings = record(pcb.drawings)
  const highlight = config.highlight_pin1
  return {
    format: 'kicad',
    generator: `InteractiveHtmlBom${pcb.ibom_version ? ` ${text(pcb.ibom_version)}` : ''}`,
    metadata: {
      title: text(metadata.title),
      revision: text(metadata.revision),
      company: text(metadata.company),
      date: text(metadata.date),
    },
    columns,
    rows: rows.filter((r) => r.ids.length > 0),
    footprints,
    excludedLabel: 'Not in BOM',
    pin1: highlight === true || highlight === 'all' ? 'all' : highlight === 'selected' ? 'selected' : 'none',
    board: {
      bounds: readBounds(pcb.edges_bbox),
      edges: list(pcb.edges).map(record),
      silk: sides(drawings.silkscreen),
      fab: sides(drawings.fabrication),
      tracks: sides(pcb.tracks),
      zones: sides(pcb.zones),
      pads: emptySides(),
      fontText: Object.keys(record(pcb.font_data)).length > 0,
    },
  }
}

function parseMaybe(value: unknown): unknown {
  return typeof value === 'string' ? optional(() => JSON.parse(value)) : value
}

const EASY_ROLES: Record<number, [string, Side | null]> = {
  1: ['copper', 'F'],
  2: ['copper', 'B'],
  3: ['silk', 'F'],
  4: ['silk', 'B'],
  5: ['mask', 'F'],
  6: ['mask', 'B'],
  11: ['edge', null],
  12: ['multi', null],
  48: ['fab', null],
  50: ['fab', null],
  51: ['fab', null],
}

function decodeEasyEda(source: string): IbomDocument {
  const start = source.indexOf(EASYEDA_MARKER) + EASYEDA_MARKER.length
  const files = record(parseJson(sliceJson(source, start)))
  const merged = record(parseMaybe(files.bom_merge))
  const bom = record(parseMaybe(merged.data))
  const placement = record(list(bom.designator_info)[0])
  const info = record(bom.comp_info)
  const footprints: Footprint[] = []
  const lines = new Map<string, { code: string; name: string; footprint: string; ids: number[] }>()
  for (const [key, side] of [
    ['top', 'F'],
    ['bottom', 'B'],
  ] as const) {
    for (const raw of list(placement[key])) {
      const c = record(raw)
      const ec = record(c.ec)
      const dx = num(ec.dx)
      const dy = num(ec.dy)
      const id = footprints.length
      const excluded = c.is_mount === false
      footprints.push({
        ref: text(c.des),
        side,
        bbox: {
          pos: [num(ec.x), -num(ec.y)],
          relpos: [-dx / 2 + num(ec.cx), -dy / 2 - num(ec.cy)],
          size: [dx, dy],
          angle: -num(ec.ang),
        },
        pads: [],
        drawings: [],
        excluded,
      })
      if (excluded) continue
      const code = text(c.lc_code)
      const name = text(c.cm)
      const footprint = text(c.ft_name)
      const key = JSON.stringify([code, name, footprint])
      const line = lines.get(key) ?? { code, name, footprint, ids: [] }
      line.ids.push(id)
      lines.set(key, line)
    }
  }
  if (footprints.length === 0) throw new Error('This interactive BOM has no parts.')

  const byRef = (a: number, b: number) =>
    footprints[a].ref.localeCompare(footprints[b].ref, undefined, { numeric: true })
  const rows = [...lines.values()].map(({ code, name, footprint, ids }) => {
    const shared = record(info[code])
    const own = !text(shared.Name) || text(shared.Name) === name
    const label = name || text(shared.Name)
    const value = own ? text(shared.value) : ''
    return {
      ids: ids.sort(byRef),
      values: [
        value === label ? '' : value,
        label,
        footprint || text(shared['Supplier Footprint'] ?? shared.lc_pkg),
        own ? text(shared['Manufacturer Part']) : '',
        text(shared['Supplier Part']),
      ],
    }
  })
  rows.sort((a, b) => byRef(a.ids[0], b.ids[0]))
  const columns = ['Value', 'Name', 'Footprint', 'Manufacturer Part', 'Supplier Part']
  const used = columns.map((_, i) => rows.some((r) => r.values[i] && r.values[i] !== '-'))

  const fileInfo = record(bom.file_info)
  const created = num(fileInfo.create_time, NaN)
  return {
    format: 'easyeda',
    generator: 'EasyEDA Pro interactive BOM',
    metadata: {
      title: text(fileInfo.board || fileInfo.pcb_name),
      revision: '',
      company: '',
      date: Number.isFinite(created) ? new Date(created).toISOString().slice(0, 10) : '',
    },
    columns: columns.filter((_, i) => used[i]),
    rows: rows.map((r) => ({ ids: r.ids, values: r.values.filter((_, i) => used[i]) })),
    footprints,
    excludedLabel: 'Not assembled',
    pin1: 'none',
    board: readEasyEdaBoard(typeof files.web === 'string' ? files.web : '', footprints),
  }
}

interface EasyShape {
  svgpath: string
  width: number
  filled: boolean
  bounds: Bounds
}

function readEasyEdaBoard(web: string, footprints: Footprint[]): IbomDocument['board'] {
  const board: IbomDocument['board'] = {
    bounds: null,
    edges: [],
    silk: emptySides(),
    fab: emptySides(),
    tracks: emptySides(),
    zones: emptySides(),
    pads: emptySides(),
    fontText: false,
  }
  const outline = emptyBounds()
  const masks: Record<Side, Bounds[]> = { F: [], B: [] }
  const loose: { role: string; layer: Side | null; shape: EasyShape }[] = []
  let at = 0
  while (at < web.length) {
    let end = web.indexOf('\n', at)
    if (end < 0) end = web.length
    const line = web.slice(at, end)
    at = end + 1
    if (!line.startsWith('["POLY"') && !line.startsWith('["FILL"')) continue
    let r: unknown[]
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    const role = EASY_ROLES[num(r[4], -1)]
    if (!role) continue
    const poly = r[0] === 'POLY'
    const bounds = emptyBounds()
    const svgpath = (poly ? [r[6]] : list(r[7])).map((ring) => easyPath(ring, bounds)).join('')
    if (!svgpath || !Number.isFinite(bounds.minx)) continue
    const shape = { svgpath, width: num(poly ? r[5] : r[6]) * MIL10, filled: !poly, bounds }
    const [kind, side] = role
    if (kind === 'edge') {
      board.edges.push({ type: 'svgpath', ...shape, filled: false })
      grow(outline, bounds.minx, bounds.miny, bounds.maxx, bounds.maxy)
    } else if (kind === 'mask' && side) masks[side].push(bounds)
    else if (side && (kind !== 'copper' || poly))
      board[kind === 'copper' ? 'tracks' : 'silk'][side].push({ type: 'svgpath', ...shape })
    else loose.push({ role: kind, layer: side, shape })
  }

  for (const { role, layer, shape } of loose) {
    const b = shape.bounds
    const cx = (b.minx + b.maxx) / 2
    const cy = (b.miny + b.maxy) / 2
    const owner = partAt(footprints, layer, cx, cy)
    const large = owner < 0 && Math.max(b.maxx - b.minx, b.maxy - b.miny) > 8
    const drawing = { type: 'svgpath', svgpath: shape.svgpath, width: shape.width, filled: shape.filled }
    if (role === 'multi') {
      if (large) board.edges.push({ ...drawing, filled: false })
    } else if (role === 'copper' && layer) {
      if (large) board.zones[layer].push({ svgpath: shape.svgpath })
      else {
        board.pads[layer].push(drawing)
        if (owner >= 0) footprints[owner].pads.push(drawing)
      }
    } else {
      const inMask = (s: Side) => masks[s].some((m) => cx >= m.minx && cx <= m.maxx && cy >= m.miny && cy <= m.maxy)
      board.fab[owner >= 0 ? footprints[owner].side : inMask('B') && !inMask('F') ? 'B' : 'F'].push(drawing)
    }
  }
  board.bounds = Number.isFinite(outline.minx) ? outline : null
  return board
}

function easyPath(ring: unknown, bounds: Bounds) {
  if (!Array.isArray(ring) || ring.length === 0) return ''
  const at = (x: unknown, y: unknown): Point => {
    const p: Point = [num(x) * MIL10, -num(y) * MIL10]
    grow(bounds, p[0], p[1])
    return p
  }
  if (ring[0] === 'CIRCLE') {
    const [cx, cy] = at(ring[1], ring[2])
    const r = Math.abs(num(ring[3])) * MIL10
    grow(bounds, cx - r, cy - r, cx + r, cy + r)
    return circlePath(cx, cy, r)
  }
  if (ring[0] === 'R') {
    const x = num(ring[1])
    const y = num(ring[2])
    const w = num(ring[3])
    const h = num(ring[4])
    const a = (num(ring[5]) * Math.PI) / 180
    const corners = [
      [0, 0],
      [w, 0],
      [w, -h],
      [0, -h],
    ].map(([dx, dy]) => at(x + dx * Math.cos(a) - dy * Math.sin(a), y + dx * Math.sin(a) + dy * Math.cos(a)))
    return `M${corners.map(([px, py]) => `${f(px)} ${f(py)}`).join('L')}Z`
  }
  let d = ''
  let arc = false
  let current: Point | null = null
  for (let i = 0; i < ring.length; ) {
    const t = ring[i]
    if (t === 'L') {
      arc = false
      i++
    } else if (t === 'ARC' || t === 'CARC') {
      arc = true
      i++
    } else if (arc && typeof ring[i + 2] === 'number') {
      const sweep = num(t)
      const [x, y] = at(ring[i + 1], ring[i + 2])
      i += 3
      if (!current) d += `M${f(x)} ${f(y)}`
      else {
        const chord = Math.hypot(x - current[0], y - current[1])
        const theta = (Math.abs(sweep) * Math.PI) / 180
        const r = theta > 1e-9 ? chord / (2 * Math.sin(theta / 2)) : 0
        d +=
          r > 0 && Number.isFinite(r)
            ? `A${f(r)} ${f(r)} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep > 0 ? 0 : 1} ${f(x)} ${f(y)}`
            : `L${f(x)} ${f(y)}`
      }
      current = [x, y]
    } else if (typeof t === 'number' && typeof ring[i + 1] === 'number') {
      const [x, y] = at(t, ring[i + 1])
      d += `${current ? 'L' : 'M'}${f(x)} ${f(y)}`
      current = [x, y]
      i += 2
    } else i++
  }
  return d
}
