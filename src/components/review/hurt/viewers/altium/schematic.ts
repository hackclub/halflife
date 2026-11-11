import type { EasyEdaVisualDocument } from '../easyeda/visual'
import {
  bool,
  boundsOf,
  coord,
  num,
  openAltium,
  readLengthPrefixed,
  type Point,
  type Primitive,
  type Props,
} from './records'

const R = {
  COMPONENT: 1,
  PIN: 2,
  LABEL: 4,
  BEZIER: 5,
  POLYLINE: 6,
  POLYGON: 7,
  ELLIPSE: 8,
  PIE: 9,
  ROUND_RECT: 10,
  ELLIPTICAL_ARC: 11,
  ARC: 12,
  LINE: 13,
  RECTANGLE: 14,
  SHEET_SYMBOL: 15,
  SHEET_ENTRY: 16,
  POWER_PORT: 17,
  PORT: 18,
  NO_ERC: 22,
  NET_LABEL: 25,
  BUS: 26,
  WIRE: 27,
  TEXT_FRAME: 28,
  JUNCTION: 29,
  IMAGE: 30,
  SHEET: 31,
  SHEET_NAME: 32,
  FILE_NAME: 33,
  DESIGNATOR: 34,
  BUS_ENTRY: 37,
  PARAMETER: 41,
  IMPLEMENTATION_LIST: 44,
  NOTE: 209,
} as const

const POINT_LIMIT = 2_000_000
const INK = {
  body: '#d4a23c',
  bodyFill: 'rgba(212,162,60,0.10)',
  wire: '#5fc16e',
  bus: '#7d97f7',
  text: '#edf7f6',
  label: '#a0b6e8',
  power: '#cf8a94',
  muted: '#949e9d',
}

const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
]

export interface SchComponent {
  designator: string
  libReference: string
  description: string
  footprint: string
  parameters: Record<string, string>
}

export interface SchResult {
  kind: 'schematic'
  document: EasyEdaVisualDocument | null
  components: SchComponent[]
  nets: string[]
}

function readRecords(bytes: Uint8Array) {
  const container = openAltium(bytes)
  if (container.kind === 'ascii') return container.records
  const stream = container.file.read('FileHeader')
  if (!stream) throw new Error('This schematic has no FileHeader stream, so there is nothing to draw.')
  return readLengthPrefixed(stream)
}

function isRecord(r: Props, id: number) {
  return r.get('RECORD') === String(id)
}

export function buildSchematic(bytes: Uint8Array, title: string): SchResult {
  const records = readRecords(bytes).filter((r) => !r.has('HEADER') || r.has('RECORD'))
  const prims: Primitive[] = []
  const extra: Point[] = []

  const sheet = records.find((r) => isRecord(r, R.SHEET))
  const fontSizes = new Map<string, number>()
  if (sheet) {
    const count = Math.min(num(sheet, 'FONTIDCOUNT'), 1000)
    for (let i = 1; i <= count; i++) fontSizes.set(String(i), num(sheet, `SIZE${i}`, 10))
  }
  const fontSize = (r: Props) => Math.max(4, (fontSizes.get(r.get('FONTID') ?? '1') ?? 10) * 0.9)

  const P = (x: number, y: number): Point => ({ x, y: -y })
  const loc = (r: Props, k = 'LOCATION') => P(coord(r, `${k}.X`), coord(r, `${k}.Y`))
  let pointBudget = POINT_LIMIT
  const points = (r: Props) => {
    const n = Math.max(0, Math.min(num(r, 'LOCATIONCOUNT'), 10000, pointBudget))
    pointBudget -= n
    const out: Point[] = []
    for (let i = 1; i <= n; i++) out.push(P(coord(r, `X${i}`), coord(r, `Y${i}`)))
    return out
  }
  const width = (r: Props) => [0.5, 1, 3, 5][num(r, 'LINEWIDTH', 1)] ?? 1
  const line = (pts: Point[], stroke: string, strokeWidth: number, closed = false, fill: string | null = null) => {
    if (pts.length >= 2) prims.push({ kind: 'polyline', points: pts, closed, stroke, strokeWidth, fill, opacity: 1 })
  }
  const path = (d: string, strokeWidth: number, fill: string | null = null) =>
    prims.push({ kind: 'path', path: d, stroke: INK.body, strokeWidth, fill, opacity: 1 })
  const text = (at: Point, value: string, size: number, fill: string, orientation = 0, justification = 0) => {
    if (!value || value === '*') return
    const h = justification % 3
    const v = Math.floor(justification / 3)
    const dy = v === 0 ? -size / 2 : v === 2 ? size / 2 : 0
    const rotation = -90 * (orientation % 4)
    const rad = (rotation * Math.PI) / 180
    const flipped = orientation % 4 === 2
    prims.push({
      kind: 'text',
      x: at.x - dy * Math.sin(rad),
      y: at.y + dy * Math.cos(rad),
      text: value,
      size,
      rotation: flipped ? 0 : rotation,
      fill,
      opacity: 1,
      anchor: (['start', 'middle', 'end'] as const)[flipped ? 2 - h : h],
    })
    extra.push(at)
  }
  const ellipse = (c: Point, rx: number, ry: number) =>
    `M ${c.x - rx} ${c.y} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0`

  const components = new Map<number, Props>()
  const children = new Map<number, Props[]>()
  const indexOf = new Map<Props, number>()
  records.forEach((r, i) => {
    indexOf.set(r, i)
    if (isRecord(r, R.COMPONENT)) components.set(i, r)
    const owner = r.get('OWNERINDEX')
    if (owner == null) return
    const list = children.get(Number(owner)) ?? []
    list.push(r)
    children.set(Number(owner), list)
  })
  const visible = (r: Props) => {
    const comp = components.get(Number(r.get('OWNERINDEX')))
    if (!comp) return true
    const part = num(r, 'OWNERPARTID', -1)
    if (part !== -1 && part !== num(comp, 'CURRENTPARTID', 1)) return false
    return num(r, 'OWNERPARTDISPLAYMODE') === num(comp, 'DISPLAYMODE')
  }
  const resolveParameter = (owner: number, value: string) => {
    if (!value.startsWith('=')) return value
    const name = value.slice(1).toUpperCase()
    return (
      children
        .get(owner)
        ?.find((c) => c.get('NAME')?.toUpperCase() === name)
        ?.get('TEXT') ?? value
    )
  }

  const nets = new Set<string>()

  records.forEach((r, index) => {
    if (!visible(r)) return
    const id = Number(r.get('RECORD'))
    switch (id) {
      case R.WIRE:
        line(points(r), INK.wire, width(r))
        break
      case R.BUS:
        line(points(r), INK.bus, Math.max(2, width(r) * 2))
        break
      case R.POLYLINE:
        line(points(r), INK.body, width(r))
        break
      case R.POLYGON:
        line(points(r), INK.body, width(r), true, bool(r, 'ISSOLID') ? INK.bodyFill : null)
        break
      case R.BEZIER: {
        const pts = points(r)
        if (pts.length < 4) break
        let d = `M ${pts[0].x} ${pts[0].y}`
        for (let i = 1; i + 2 < pts.length; i += 3)
          d += ` C ${pts[i].x} ${pts[i].y} ${pts[i + 1].x} ${pts[i + 1].y} ${pts[i + 2].x} ${pts[i + 2].y}`
        path(d, width(r))
        extra.push(...pts)
        break
      }
      case R.LINE:
      case R.BUS_ENTRY:
        line([loc(r), loc(r, 'CORNER')], id === R.BUS_ENTRY ? INK.bus : INK.body, width(r))
        break
      case R.RECTANGLE:
      case R.ROUND_RECT:
      case R.TEXT_FRAME:
      case R.NOTE:
      case R.IMAGE: {
        const a = loc(r)
        const b = loc(r, 'CORNER')
        const x = Math.min(a.x, b.x)
        const y = Math.min(a.y, b.y)
        prims.push({
          kind: 'rect',
          x,
          y,
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
          rx: id === R.ROUND_RECT ? coord(r, 'CORNERXRADIUS') : 0,
          ry: id === R.ROUND_RECT ? coord(r, 'CORNERYRADIUS') : 0,
          rotation: 0,
          stroke: id === R.IMAGE ? INK.muted : INK.body,
          strokeWidth: width(r),
          fill: bool(r, 'ISSOLID') && !bool(r, 'TRANSPARENT') ? INK.bodyFill : null,
          opacity: 1,
        })
        extra.push(a, b)
        if (id === R.TEXT_FRAME || id === R.NOTE) {
          const size = fontSize(r)
          ;(r.get('TEXT') ?? '')
            .split('~1')
            .slice(0, 200)
            .forEach((t, i) => text({ x: x + 2, y: y + (i + 1) * size }, t, size, INK.text))
        }
        if (id === R.IMAGE) text({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 'Image', 8, INK.muted, 0, 4)
        break
      }
      case R.ELLIPSE:
      case R.ARC:
      case R.ELLIPTICAL_ARC:
      case R.PIE: {
        const c = loc(r)
        const rx = coord(r, 'RADIUS')
        const ry = id === R.ELLIPSE || id === R.ELLIPTICAL_ARC ? coord(r, 'SECONDARYRADIUS') || rx : rx
        if (rx <= 0) break
        extra.push({ x: c.x - rx, y: c.y - ry }, { x: c.x + rx, y: c.y + ry })
        if (id === R.ELLIPSE) {
          path(ellipse(c, rx, ry), width(r), bool(r, 'ISSOLID') ? INK.bodyFill : null)
          break
        }
        const start = num(r, 'STARTANGLE')
        let end = num(r, 'ENDANGLE', 360)
        if (end <= start) end += 360
        const sweep = end - start
        const at = (deg: number) => ({
          x: c.x + rx * Math.cos((deg * Math.PI) / 180),
          y: c.y - ry * Math.sin((deg * Math.PI) / 180),
        })
        const s = at(start)
        const e = at(end)
        const arc = `A ${rx} ${ry} 0 ${sweep > 180 ? 1 : 0} 0 ${e.x} ${e.y}`
        if (sweep >= 359.99) path(ellipse(c, rx, ry), width(r))
        else if (id === R.PIE)
          path(`M ${c.x} ${c.y} L ${s.x} ${s.y} ${arc} Z`, width(r), bool(r, 'ISSOLID') ? INK.bodyFill : null)
        else path(`M ${s.x} ${s.y} ${arc}`, width(r))
        break
      }
      case R.PIN: {
        const flags = num(r, 'PINCONGLOMERATE')
        if (flags & 0x04) break
        const orientation = flags & 0x03
        const dir = DIRECTIONS[orientation]
        const length = coord(r, 'PINLENGTH')
        const a = loc(r)
        const b = { x: a.x + dir.x * length, y: a.y + dir.y * length }
        line([a, b], INK.body, 1)
        const size = fontSize(r) * 0.8
        const vertical = orientation % 2
        if (flags & 0x08)
          text(
            { x: a.x - dir.x * 2, y: a.y - dir.y * 2 },
            (r.get('NAME') ?? '').replace(/\\/g, ''),
            size,
            INK.text,
            vertical,
            orientation < 2 ? 5 : 3,
          )
        if (flags & 0x10)
          text(
            { x: (a.x + b.x) / 2 - dir.y, y: (a.y + b.y) / 2 - (vertical ? 0 : 1) },
            r.get('DESIGNATOR') ?? '',
            size,
            INK.muted,
            vertical,
            1,
          )
        break
      }
      case R.JUNCTION: {
        const c = loc(r)
        prims.push({
          kind: 'circle',
          cx: c.x,
          cy: c.y,
          r: 2,
          stroke: INK.wire,
          strokeWidth: 0,
          fill: INK.wire,
          opacity: 1,
        })
        break
      }
      case R.NO_ERC: {
        const c = loc(r)
        line(
          [
            { x: c.x - 3, y: c.y - 3 },
            { x: c.x + 3, y: c.y + 3 },
          ],
          INK.power,
          1,
        )
        line(
          [
            { x: c.x - 3, y: c.y + 3 },
            { x: c.x + 3, y: c.y - 3 },
          ],
          INK.power,
          1,
        )
        break
      }
      case R.NET_LABEL: {
        const label = r.get('TEXT') ?? ''
        nets.add(label)
        text(loc(r), label, fontSize(r), INK.label, num(r, 'ORIENTATION'), num(r, 'JUSTIFICATION'))
        break
      }
      case R.LABEL:
        text(loc(r), r.get('TEXT') ?? '', fontSize(r), INK.text, num(r, 'ORIENTATION'), num(r, 'JUSTIFICATION'))
        break
      case R.POWER_PORT: {
        const c = loc(r)
        const dir = DIRECTIONS[num(r, 'ORIENTATION') & 3]
        const style = num(r, 'STYLE')
        line([c, { x: c.x + dir.x * 10, y: c.y + dir.y * 10 }], INK.power, 1)
        const bar = (offset: number, half: number) =>
          line(
            [
              { x: c.x + dir.x * offset - dir.y * half, y: c.y + dir.y * offset + dir.x * half },
              { x: c.x + dir.x * offset + dir.y * half, y: c.y + dir.y * offset - dir.x * half },
            ],
            INK.power,
            1,
          )
        if (style >= 4 && style <= 6) {
          bar(10, 10)
          bar(13, 6.5)
          bar(16, 3)
        } else bar(10, 6)
        const label = r.get('TEXT') ?? ''
        nets.add(label)
        if (bool(r, 'SHOWNETNAME') || !r.has('SHOWNETNAME'))
          text({ x: c.x + dir.x * 22, y: c.y + dir.y * 22 }, label, fontSize(r), INK.power, 0, 4)
        break
      }
      case R.PORT: {
        const c = loc(r)
        const w = coord(r, 'WIDTH') || 40
        const h = coord(r, 'HEIGHT') || 10
        const vertical = num(r, 'STYLE') >= 4
        const outline = vertical
          ? [
              c,
              { x: c.x + h / 2, y: c.y - h / 2 },
              { x: c.x + h / 2, y: c.y - w },
              { x: c.x - h / 2, y: c.y - w },
              { x: c.x - h / 2, y: c.y - h / 2 },
            ]
          : [
              c,
              { x: c.x + h / 2, y: c.y - h / 2 },
              { x: c.x + w, y: c.y - h / 2 },
              { x: c.x + w, y: c.y + h / 2 },
              { x: c.x + h / 2, y: c.y + h / 2 },
            ]
        line(outline, INK.label, 1, true)
        const name = r.get('NAME') ?? ''
        nets.add(name)
        text(
          vertical ? { x: c.x, y: c.y - w / 2 } : { x: c.x + w / 2, y: c.y },
          name,
          fontSize(r),
          INK.label,
          vertical ? 1 : 0,
          4,
        )
        break
      }
      case R.SHEET_SYMBOL: {
        const c = loc(r)
        const w = coord(r, 'XSIZE')
        const h = coord(r, 'YSIZE')
        prims.push({
          kind: 'rect',
          x: c.x,
          y: c.y,
          width: w,
          height: h,
          rx: 0,
          ry: 0,
          rotation: 0,
          stroke: INK.bus,
          strokeWidth: 1,
          fill: null,
          opacity: 1,
        })
        extra.push(c, { x: c.x + w, y: c.y + h })
        for (const e of children.get(index) ?? []) {
          if (!isRecord(e, R.SHEET_ENTRY)) continue
          const side = num(e, 'SIDE')
          const d = coord(e, 'DISTANCEFROMTOP') * 10
          const at =
            side === 1
              ? { x: c.x + w, y: c.y + d }
              : side === 2
                ? { x: c.x + d, y: c.y }
                : side === 3
                  ? { x: c.x + d, y: c.y + h }
                  : { x: c.x, y: c.y + d }
          text({ x: at.x + (side === 1 ? -3 : 3), y: at.y }, e.get('NAME') ?? '', 7, INK.bus, 0, side === 1 ? 5 : 3)
          prims.push({
            kind: 'circle',
            cx: at.x,
            cy: at.y,
            r: 1.5,
            stroke: INK.bus,
            strokeWidth: 0,
            fill: INK.bus,
            opacity: 1,
          })
        }
        break
      }
      case R.SHEET_NAME:
      case R.FILE_NAME:
        if (!bool(r, 'ISHIDDEN')) text(loc(r), r.get('TEXT') ?? '', fontSize(r), INK.bus, num(r, 'ORIENTATION'))
        break
      case R.DESIGNATOR: {
        if (bool(r, 'ISHIDDEN')) break
        const comp = components.get(Number(r.get('OWNERINDEX')))
        const suffix =
          comp && num(comp, 'PARTCOUNT', 2) - 1 > 1 ? String.fromCharCode(64 + num(comp, 'CURRENTPARTID', 1)) : ''
        text(
          loc(r),
          (r.get('TEXT') ?? '') + suffix,
          fontSize(r),
          INK.label,
          num(r, 'ORIENTATION'),
          num(r, 'JUSTIFICATION'),
        )
        break
      }
      case R.PARAMETER:
        if (!bool(r, 'ISHIDDEN') && r.has('OWNERINDEX') && r.has('LOCATION.X'))
          text(
            loc(r),
            resolveParameter(Number(r.get('OWNERINDEX')), r.get('TEXT') ?? ''),
            fontSize(r),
            INK.text,
            num(r, 'ORIENTATION'),
            num(r, 'JUSTIFICATION'),
          )
        break
    }
  })

  const list: SchComponent[] = []
  for (const [index, comp] of components) {
    const kids = children.get(index) ?? []
    const parameters: Record<string, string> = {}
    for (const k of kids) {
      if (!isRecord(k, R.PARAMETER)) continue
      const name = k.get('NAME')
      const value = resolveParameter(index, k.get('TEXT') ?? '')
      if (name && value && value !== '*') parameters[name] = value
    }
    const models = kids
      .filter((k) => isRecord(k, R.IMPLEMENTATION_LIST))
      .flatMap((k) => children.get(indexOf.get(k)!) ?? [])
      .filter((k) => k.get('MODELTYPE') === 'PCBLIB')
    list.push({
      designator: kids.find((k) => isRecord(k, R.DESIGNATOR))?.get('TEXT') ?? '',
      libReference: comp.get('LIBREFERENCE') ?? '',
      description: comp.get('COMPONENTDESCRIPTION') ?? '',
      footprint: (models.find((k) => bool(k, 'ISCURRENT')) ?? models[0])?.get('MODELNAME') ?? '',
      parameters,
    })
  }
  list.sort((a, b) => a.designator.localeCompare(b.designator, undefined, { numeric: true }))

  const bounds = boundsOf(prims, extra)
  return {
    kind: 'schematic',
    document: bounds
      ? {
          title,
          documentKind: 'schematic',
          primitives: prims,
          bounds,
          shapeCount: records.length,
          unknownShapePrefixes: [],
        }
      : null,
    components: list,
    nets: [...nets].filter(Boolean).sort(),
  }
}
