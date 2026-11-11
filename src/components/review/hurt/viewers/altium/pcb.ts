import type { Cfb } from '../../core/cfb'
import type { EasyEdaVisualDocument } from '../easyeda/visual'
import {
  bool,
  boundsOf,
  num,
  openAltium,
  parseProps,
  pcbLength,
  readLengthPrefixed,
  type Point,
  type Primitive,
  type Props,
} from './records'

interface Item {
  layer: string
  net: number
  component: number
}
interface PcbTrack extends Item {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
}
interface PcbArc extends Item {
  cx: number
  cy: number
  r: number
  start: number
  end: number
  width: number
}
interface PcbVia {
  x: number
  y: number
  diameter: number
  hole: number
}
interface PcbPad extends Item {
  x: number
  y: number
  sx: number
  sy: number
  shape: 'round' | 'rect' | 'octagon' | 'roundrect'
  corner?: number
  rotation: number
  hole: number
}
interface PcbFill extends Item {
  x1: number
  y1: number
  x2: number
  y2: number
  rotation: number
}
interface PcbRegion {
  layer: string
  outline: Point[]
  holes: Point[][]
  keepout: boolean
  cutout: boolean
}
interface PcbText {
  layer: string
  x: number
  y: number
  height: number
  rotation: number
  text: string
  mirrored: boolean
  component: number
  isComment: boolean
  isDesignator: boolean
}
export interface PcbComponent {
  index: number
  designator: string
  footprint: string
  libReference: string
  description: string
  comment: string
  layer: string
  nameOn: boolean
  commentOn: boolean
}
export interface PcbModel {
  kind: 'pcb'
  outline: Point[]
  tracks: PcbTrack[]
  arcs: PcbArc[]
  vias: PcbVia[]
  pads: PcbPad[]
  fills: PcbFill[]
  regions: PcbRegion[]
  texts: PcbText[]
  components: PcbComponent[]
  nets: string[]
  models: number
  warnings: string[]
}

const LAYER_IDS: Record<number, string> = {
  1: 'TOP',
  32: 'BOTTOM',
  33: 'TOPOVERLAY',
  34: 'BOTTOMOVERLAY',
  35: 'TOPPASTE',
  36: 'BOTTOMPASTE',
  37: 'TOPSOLDER',
  38: 'BOTTOMSOLDER',
  55: 'DRILLGUIDE',
  56: 'KEEPOUT',
  73: 'DRILLDRAWING',
  74: 'MULTILAYER',
}
for (let i = 2; i <= 31; i++) LAYER_IDS[i] = `MID${i - 1}`
for (let i = 39; i <= 54; i++) LAYER_IDS[i] = `PLANE${i - 38}`
for (let i = 57; i <= 72; i++) LAYER_IDS[i] = `MECHANICAL${i - 56}`
const layerName = (id: number) => LAYER_IDS[id] ?? `LAYER${id}`

const UNIT = 10000
const POINT_LIMIT = 2_000_000
// Pad size-and-shape subrecord: inner sizes (29 x 2 x 4), inner shapes (29), 1, hole shape (1), slot size (4),
// slot rotation (8), hole offsets (32 x 2 x 4), 1, then 32 alternative shapes and 32 corner radius percentages.
const SIZE_AND_SHAPE_LENGTH = 596
const ALT_SHAPE_OFFSET = 532
const ALT_ROUNDRECT = 9
const ANSI = new TextDecoder('windows-1252')

class Reader {
  readonly view: DataView
  o = 0
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  get left() {
    return this.bytes.length - this.o
  }
  u8() {
    if (this.o >= this.bytes.length) throw new RangeError('Record ended early.')
    return this.bytes[this.o++]
  }
  u16() {
    const v = this.view.getUint16(this.o, true)
    this.o += 2
    return v
  }
  u32() {
    const v = this.view.getUint32(this.o, true)
    this.o += 4
    return v
  }
  f64() {
    const v = this.view.getFloat64(this.o, true)
    this.o += 8
    return v
  }
  mil() {
    const v = this.view.getInt32(this.o, true)
    this.o += 4
    return v / UNIT
  }
  skip(n: number) {
    this.o += n
  }
  shortString() {
    const n = this.u8()
    const s = ANSI.decode(this.bytes.subarray(this.o, this.o + n))
    this.o += n
    return s
  }
  props() {
    const n = this.u32()
    if (n > this.left) throw new RangeError('Record ended early.')
    const p = parseProps(this.bytes.subarray(this.o, this.o + n))
    this.o += n
    return p
  }
  sub() {
    const n = this.u32()
    if (n > this.left) throw new RangeError('Record ended early.')
    const r = new Reader(this.bytes.subarray(this.o, this.o + n))
    this.o += n
    return r
  }
}

function eachRecord(
  stream: Uint8Array | null,
  expected: number,
  read: (r: Reader) => void,
  model: PcbModel,
  label: string,
) {
  if (!stream?.length) return
  const r = new Reader(stream)
  while (r.left > 5) {
    if (r.u8() !== expected) return void model.warnings.push(`${label} has a record type the viewer does not know.`)
    try {
      read(r)
    } catch {
      return void model.warnings.push(`${label} has a damaged record, so the rest of it was skipped.`)
    }
  }
}

function boardOutline(props: Props): Point[] {
  const out: Point[] = []
  for (let i = 0; props.has(`VX${i}`) && i < 10000; i++) {
    const x = pcbLength(props, `VX${i}`)
    const y = pcbLength(props, `VY${i}`)
    out.push({ x, y })
    if (num(props, `KIND${i}`) !== 1 || !props.has(`CX${i}`)) continue
    const cx = pcbLength(props, `CX${i}`)
    const cy = pcbLength(props, `CY${i}`)
    const radius = props.get(`R${i}`) ?? ''
    const r =
      /^[\d.]+$/.test(radius) && /mil$/i.test(props.get(`CX${i}`) ?? '') ? Number(radius) : pcbLength(props, `R${i}`)
    let sa = num(props, `SA${i}`)
    let ea = num(props, `EA${i}`)
    const at = (deg: number) => ({
      x: cx + r * Math.cos((deg * Math.PI) / 180),
      y: cy + r * Math.sin((deg * Math.PI) / 180),
    })
    const distance = (p: Point) => Math.hypot(p.x - x, p.y - y)
    if (distance(at(sa)) > distance(at(ea))) [sa, ea] = [ea, sa]
    let sweep = ea - sa
    if (Math.abs(sweep) < 1e-6) continue
    if (sweep < -180) sweep += 360
    else if (sweep > 180) sweep -= 360
    const steps = Math.max(4, Math.ceil(Math.abs(sweep) / 6))
    for (let k = 1; k < steps; k++) out.push(at(sa + (sweep * k) / steps))
  }
  return out
}

function emptyModel(): PcbModel {
  return {
    kind: 'pcb',
    outline: [],
    tracks: [],
    arcs: [],
    vias: [],
    pads: [],
    fills: [],
    regions: [],
    texts: [],
    components: [],
    nets: [],
    models: 0,
    warnings: [],
  }
}

function component(p: Props, index: number): PcbComponent {
  return {
    index,
    designator: p.get('SOURCEDESIGNATOR') ?? '',
    footprint: p.get('PATTERN') ?? '',
    libReference: p.get('SOURCELIBREFERENCE') ?? '',
    description: p.get('SOURCEDESCRIPTION') ?? '',
    comment: '',
    layer: (p.get('LAYER') ?? 'TOP').toUpperCase(),
    nameOn: bool(p, 'NAMEON'),
    commentOn: bool(p, 'COMMENTON'),
  }
}

function header(s: Reader) {
  const layer = layerName(s.u8())
  s.skip(2)
  const net = s.u16()
  s.skip(2)
  const component = s.u16()
  s.skip(4)
  return { layer, net, component }
}

function readBinary(file: Cfb): PcbModel {
  const m = emptyModel()
  const data = (name: string) => file.read(`${name}/Data`)

  const board = readLengthPrefixed(data('Board6'))
  if (board[0]) m.outline = boardOutline(board[0])
  m.nets = readLengthPrefixed(data('Nets6')).map((p) => p.get('NAME') ?? '')
  m.components = readLengthPrefixed(data('Components6')).map(component)

  eachRecord(
    data('Tracks6'),
    4,
    (r) => {
      const s = r.sub()
      m.tracks.push({ ...header(s), x1: s.mil(), y1: s.mil(), x2: s.mil(), y2: s.mil(), width: s.mil() })
    },
    m,
    'Tracks6',
  )
  eachRecord(
    data('Arcs6'),
    1,
    (r) => {
      const s = r.sub()
      m.arcs.push({ ...header(s), cx: s.mil(), cy: s.mil(), r: s.mil(), start: s.f64(), end: s.f64(), width: s.mil() })
    },
    m,
    'Arcs6',
  )
  eachRecord(
    data('Vias6'),
    3,
    (r) => {
      const s = r.sub()
      s.skip(13)
      m.vias.push({ x: s.mil(), y: s.mil(), diameter: s.mil(), hole: s.mil() })
    },
    m,
    'Vias6',
  )
  eachRecord(
    data('Fills6'),
    6,
    (r) => {
      const s = r.sub()
      m.fills.push({ ...header(s), x1: s.mil(), y1: s.mil(), x2: s.mil(), y2: s.mil(), rotation: s.f64() })
    },
    m,
    'Fills6',
  )
  eachRecord(
    data('Pads6'),
    2,
    (r) => {
      r.sub()
      r.sub()
      r.sub()
      r.sub()
      const s = r.sub()
      const h = header(s)
      const x = s.mil()
      const y = s.mil()
      const sx = s.mil()
      const sy = s.mil()
      s.skip(16)
      const hole = s.mil()
      const shapeId = s.u8()
      s.skip(2)
      const rotation = s.f64()
      let shape: PcbPad['shape'] = shapeId === 2 ? 'rect' : shapeId === 3 ? 'octagon' : 'round'
      let corner: number | undefined
      if (r.left >= 4) {
        const extra = r.sub()
        if (extra.bytes.length >= SIZE_AND_SHAPE_LENGTH && extra.bytes[ALT_SHAPE_OFFSET] === ALT_ROUNDRECT) {
          shape = 'roundrect'
          corner = Math.min(100, extra.bytes[ALT_SHAPE_OFFSET + 32]) / 200
        }
      }
      m.pads.push({ ...h, x, y, sx, sy, hole, shape, corner, rotation })
    },
    m,
    'Pads6',
  )

  const regions = (stream: string, extended: boolean) =>
    eachRecord(
      data(stream),
      11,
      (r) => {
        const s = r.sub()
        const layer = layerName(s.u8())
        s.skip(1)
        const flags2 = s.u8()
        s.skip(11)
        const holeCount = s.u16()
        s.skip(2)
        const props = s.props()
        const ring = (count: number, ext: boolean) => {
          const pts: Point[] = []
          for (let i = 0; i < count && s.left > 0; i++) {
            if (ext) {
              s.skip(1)
              pts.push({ x: s.mil(), y: s.mil() })
              s.skip(28)
            } else pts.push({ x: s.f64() / UNIT, y: s.f64() / UNIT })
          }
          return pts
        }
        const outline = ring(extended ? s.u32() + 1 : s.u32(), extended)
        const holes: Point[][] = []
        for (let i = 0; i < holeCount && s.left >= 4; i++) holes.push(ring(s.u32(), false))
        m.regions.push({
          layer,
          outline,
          holes,
          keepout: flags2 === 2,
          cutout: num(props, 'KIND') === 1 || bool(props, 'ISBOARDCUTOUT'),
        })
      },
      m,
      stream,
    )
  if (data('ShapeBasedRegions6')?.length) regions('ShapeBasedRegions6', true)
  else regions('Regions6', false)

  eachRecord(
    data('Texts6'),
    5,
    (r) => {
      const s = r.sub()
      const layer = layerName(s.u8())
      s.skip(6)
      const component = s.u16()
      s.skip(4)
      const x = s.mil()
      const y = s.mil()
      const height = s.mil()
      s.skip(2)
      const rotation = s.f64()
      const mirrored = s.u8() !== 0
      s.skip(4)
      const isComment = s.left > 0 && s.u8() !== 0
      const isDesignator = s.left > 0 && s.u8() !== 0
      const t = r.sub()
      const text = t.bytes.length ? t.shortString() : ''
      m.texts.push({ layer, component, x, y, height, rotation, mirrored, text, isComment, isDesignator })
    },
    m,
    'Texts6',
  )

  m.models = file.paths.filter((p) => /^Models\/\d+$/.test(p)).length
  return m
}

function wideString(value: string | undefined) {
  if (!value) return ''
  const codes = value.split(',').map(Number)
  return codes.every((c) => Number.isInteger(c) && c >= 0 && c < 0x10000)
    ? String.fromCharCode(...codes.slice(0, 4096))
    : ''
}

function readAscii(records: Props[]): PcbModel {
  const m = emptyModel()
  const withOutline = records.find((r) => r.get('RECORD') === 'Board' && r.has('VX0'))
  if (withOutline) m.outline = boardOutline(withOutline)
  const L = (r: Props) => (r.get('LAYER') ?? '').toUpperCase()
  const item = (r: Props) => ({ layer: L(r), net: num(r, 'NET', -1), component: num(r, 'COMPONENT', -1) })
  let pointBudget = POINT_LIMIT
  const ring = (r: Props, count: string, x: (i: number) => string, y: (i: number) => string) => {
    const pts: Point[] = []
    const n = Math.max(0, Math.min(num(r, count), 100000, pointBudget))
    pointBudget -= n
    for (let i = 0; i < n; i++) pts.push({ x: num(r, x(i)) / UNIT, y: num(r, y(i)) / UNIT })
    return pts
  }
  let next = 0
  for (const r of records) {
    switch (r.get('RECORD')) {
      case 'Net':
        m.nets.push(r.get('NAME') ?? '')
        break
      case 'Track':
        m.tracks.push({
          ...item(r),
          x1: pcbLength(r, 'X1'),
          y1: pcbLength(r, 'Y1'),
          x2: pcbLength(r, 'X2'),
          y2: pcbLength(r, 'Y2'),
          width: pcbLength(r, 'WIDTH'),
        })
        break
      case 'Arc':
        m.arcs.push({
          ...item(r),
          cx: pcbLength(r, 'LOCATION.X'),
          cy: pcbLength(r, 'LOCATION.Y'),
          r: pcbLength(r, 'RADIUS'),
          start: num(r, 'STARTANGLE'),
          end: num(r, 'ENDANGLE'),
          width: pcbLength(r, 'WIDTH'),
        })
        break
      case 'Via':
        m.vias.push({
          x: pcbLength(r, 'X'),
          y: pcbLength(r, 'Y'),
          diameter: pcbLength(r, 'DIAMETER'),
          hole: pcbLength(r, 'HOLESIZE'),
        })
        break
      case 'Pad': {
        const shape = (r.get('TOPSHAPE') ?? r.get('SHAPE') ?? 'ROUND').toUpperCase()
        m.pads.push({
          ...item(r),
          x: pcbLength(r, 'X'),
          y: pcbLength(r, 'Y'),
          sx: pcbLength(r, 'TOPXSIZE', pcbLength(r, 'XSIZE')),
          sy: pcbLength(r, 'TOPYSIZE', pcbLength(r, 'YSIZE')),
          shape: shape.startsWith('RECT')
            ? 'rect'
            : shape.startsWith('OCT')
              ? 'octagon'
              : shape.startsWith('ROUNDEDRECT')
                ? 'roundrect'
                : 'round',
          rotation: num(r, 'ROTATION'),
          hole: pcbLength(r, 'HOLESIZE'),
        })
        break
      }
      case 'Fill':
        m.fills.push({
          ...item(r),
          x1: pcbLength(r, 'X1'),
          y1: pcbLength(r, 'Y1'),
          x2: pcbLength(r, 'X2'),
          y2: pcbLength(r, 'Y2'),
          rotation: num(r, 'ROTATION'),
        })
        break
      case 'Region': {
        let outline = ring(
          r,
          'MAINCONTOURVERTEXCOUNT',
          (i) => `MVX${i}`,
          (i) => `MVY${i}`,
        )
        if (!r.has('MVX0')) {
          outline = []
          for (let i = 0; r.has(`VX${i}`) && i < 100000; i++)
            outline.push({ x: pcbLength(r, `VX${i}`), y: pcbLength(r, `VY${i}`) })
        }
        const holes: Point[][] = []
        for (let h = 0; r.has(`HOLE${h}VERTEXCOUNT`) && h < 10000; h++)
          holes.push(
            ring(
              r,
              `HOLE${h}VERTEXCOUNT`,
              (i) => `HVX${h}_${i}`,
              (i) => `HVY${h}_${i}`,
            ),
          )
        m.regions.push({ layer: L(r), outline, holes, keepout: bool(r, 'KEEPOUT'), cutout: num(r, 'KIND') === 1 })
        break
      }
      case 'Text':
        m.texts.push({
          layer: L(r),
          x: pcbLength(r, 'X'),
          y: pcbLength(r, 'Y'),
          height: pcbLength(r, 'HEIGHT'),
          rotation: num(r, 'ROTATION'),
          mirrored: bool(r, 'MIRROR'),
          text: r.get('TEXT') ?? wideString(r.get('WIDESTRING')),
          component: num(r, 'COMPONENT', -1),
          isComment: bool(r, 'COMMENT'),
          isDesignator: bool(r, 'DESIGNATOR'),
        })
        break
      case 'Component':
        m.components.push(component(r, r.has('ID') ? num(r, 'ID') : next++))
        break
    }
  }
  return m
}

export function readPcbDoc(bytes: Uint8Array): PcbModel {
  const container = openAltium(bytes)
  const model = container.kind === 'cfb' ? readBinary(container.file) : readAscii(container.records)
  const byIndex = new Map(model.components.map((c) => [c.index, c]))
  for (const t of model.texts) {
    const comp = byIndex.get(t.component)
    if (comp && t.isComment && !comp.comment) comp.comment = t.text
  }
  model.texts = model.texts.flatMap((t) => {
    const comp = byIndex.get(t.component)
    if (comp && ((t.isComment && !comp.commentOn) || (t.isDesignator && !comp.nameOn))) return []
    const text = t.text.replace(/^\.Designator$/i, comp?.designator ?? '').replace(/^\.Comment$/i, comp?.comment ?? '')
    return text ? [{ ...t, text }] : []
  })
  model.components = model.components.filter((c) => c.footprint !== 'IMPORTED_IMAGE')
  return model
}

interface LayerStyle {
  color: string
  order: number
  opacity: number
}

const LAYER_STYLE: Record<string, LayerStyle> = {
  BOTTOM: { color: '#3d7fd9', order: 1, opacity: 0.8 },
  BOTTOMOVERLAY: { color: '#9aa0a6', order: 2, opacity: 0.6 },
  TOP: { color: '#d94b3d', order: 5, opacity: 0.85 },
  MULTILAYER: { color: '#c9a227', order: 7, opacity: 0.95 },
  TOPOVERLAY: { color: '#edf7f6', order: 8, opacity: 0.95 },
  KEEPOUT: { color: '#d03fd0', order: 9, opacity: 0.6 },
  DRILLS: { color: '#04110f', order: 99, opacity: 1 },
}

function styleOf(layer: string): LayerStyle {
  if (LAYER_STYLE[layer]) return LAYER_STYLE[layer]
  if (layer.startsWith('MID') || layer.startsWith('PLANE')) return { color: '#c9b03d', order: 3, opacity: 0.5 }
  if (layer.startsWith('MECHANICAL')) return { color: '#d6c86b', order: 9, opacity: 0.5 }
  return { color: '#949e9d', order: 4, opacity: 0.4 }
}

export type PcbSide = 'all' | 'top' | 'bottom' | 'copper'

const HIDDEN_ALWAYS = /^(TOP|BOTTOM)(PASTE|SOLDER)$|^DRILL(GUIDE|DRAWING)$/

function shown(layer: string, side: PcbSide) {
  if (HIDDEN_ALWAYS.test(layer)) return false
  if (side === 'all' || layer === 'MULTILAYER' || layer === 'DRILLS') return true
  if (side === 'copper') return /^(TOP|BOTTOM|MID\d+|PLANE\d+)$/.test(layer)
  if (side === 'top') return !/^BOTTOM/.test(layer)
  return !/^TOP/.test(layer)
}

export function buildPcb(model: PcbModel, title: string, side: PcbSide = 'all'): EasyEdaVisualDocument | null {
  const layers = new Map<string, Primitive[]>()
  const extra: Point[] = []
  const P = (x: number, y: number) => ({ x, y: -y })
  const push = (layer: string, p: Primitive) => {
    if (!shown(layer, side)) return
    const list = layers.get(layer) ?? []
    list.push(p)
    layers.set(layer, list)
  }
  const ink = (layer: string) => {
    const s = styleOf(layer)
    return { stroke: s.color, fill: s.color, opacity: s.opacity }
  }
  const ringPath = (pts: Point[]) => `${pts.map((q, i) => `${i ? 'L' : 'M'} ${q.x} ${-q.y}`).join(' ')} Z`
  const drill = (c: Point, hole: number) =>
    push('DRILLS', { kind: 'circle', cx: c.x, cy: c.y, r: hole / 2, ...ink('DRILLS'), strokeWidth: 0 })

  const base: Primitive[] = []
  const outline = model.outline.map((q) => P(q.x, q.y))
  if (outline.length > 2)
    base.push({
      kind: 'polyline',
      points: outline,
      closed: true,
      stroke: '#d6c86b',
      strokeWidth: 4,
      fill: '#0c322c',
      opacity: 1,
    })

  for (const r of model.regions) {
    if (r.outline.length < 3) continue
    if (r.cutout) {
      base.push({
        kind: 'path',
        path: ringPath(r.outline),
        stroke: '#d6c86b',
        strokeWidth: 2,
        fill: '#04110f',
        opacity: 1,
      })
      continue
    }
    const { stroke, fill, opacity } = ink(r.layer)
    push(r.layer, {
      kind: 'path',
      path: [r.outline, ...r.holes].map(ringPath).join(' '),
      stroke,
      strokeWidth: 0,
      fill: r.keepout ? null : fill,
      opacity: opacity * 0.85,
    })
  }
  for (const f of model.fills) {
    const a = P(Math.min(f.x1, f.x2), Math.max(f.y1, f.y2))
    push(f.layer, {
      kind: 'rect',
      x: a.x,
      y: a.y,
      width: Math.abs(f.x2 - f.x1),
      height: Math.abs(f.y2 - f.y1),
      rx: 0,
      ry: 0,
      rotation: -f.rotation,
      ...ink(f.layer),
      strokeWidth: 0,
    })
  }
  for (const t of model.tracks) {
    push(t.layer, {
      kind: 'polyline',
      points: [P(t.x1, t.y1), P(t.x2, t.y2)],
      closed: false,
      ...ink(t.layer),
      fill: null,
      strokeWidth: Math.max(0.5, t.width),
    })
  }
  for (const a of model.arcs) {
    if (!(a.r > 0)) continue
    let sweep = a.end - a.start
    if (sweep <= 0) sweep += 360
    const at = (deg: number) =>
      P(a.cx + a.r * Math.cos((deg * Math.PI) / 180), a.cy + a.r * Math.sin((deg * Math.PI) / 180))
    const s = at(a.start)
    const e = at(a.end)
    const path =
      sweep >= 359.99
        ? `M ${a.cx - a.r} ${-a.cy} a ${a.r} ${a.r} 0 1 0 ${2 * a.r} 0 a ${a.r} ${a.r} 0 1 0 ${-2 * a.r} 0`
        : `M ${s.x} ${s.y} A ${a.r} ${a.r} 0 ${sweep > 180 ? 1 : 0} 0 ${e.x} ${e.y}`
    push(a.layer, { kind: 'path', path, ...ink(a.layer), fill: null, strokeWidth: Math.max(0.5, a.width) })
    if (shown(a.layer, side)) extra.push(s, e)
  }
  for (const p of model.pads) {
    const c = P(p.x, p.y)
    const { fill, opacity } = ink(p.layer)
    if (p.shape === 'round' && Math.abs(p.sx - p.sy) < 0.01) {
      push(p.layer, { kind: 'circle', cx: c.x, cy: c.y, r: p.sx / 2, stroke: fill, strokeWidth: 0, fill, opacity })
    } else {
      const radius =
        p.shape === 'round'
          ? Math.min(p.sx, p.sy) / 2
          : p.shape === 'roundrect'
            ? Math.min(p.sx, p.sy) * (p.corner ?? 0.25)
            : 0
      push(p.layer, {
        kind: 'rect',
        x: c.x - p.sx / 2,
        y: c.y - p.sy / 2,
        width: p.sx,
        height: p.sy,
        rx: radius,
        ry: radius,
        rotation: -p.rotation,
        stroke: fill,
        strokeWidth: 0,
        fill,
        opacity,
      })
    }
    if (p.hole > 0) drill(c, p.hole)
  }
  for (const v of model.vias) {
    const c = P(v.x, v.y)
    push('MULTILAYER', { kind: 'circle', cx: c.x, cy: c.y, r: v.diameter / 2, ...ink('MULTILAYER'), strokeWidth: 0 })
    if (v.hole > 0) drill(c, v.hole)
  }
  for (const t of model.texts) {
    if (!t.text || !(t.height > 0)) continue
    const c = P(t.x, t.y)
    const rad = (t.rotation * Math.PI) / 180
    push(t.layer, {
      kind: 'text',
      x: c.x - Math.sin(rad) * t.height * 0.5,
      y: c.y - Math.cos(rad) * t.height * 0.5,
      text: t.text,
      size: t.height,
      rotation: -t.rotation,
      fill: ink(t.layer).fill,
      opacity: ink(t.layer).opacity,
      anchor: t.mirrored ? 'end' : 'start',
    })
  }

  const drawn = [...layers.entries()]
    .sort((a, b) => styleOf(a[0]).order - styleOf(b[0]).order)
    .flatMap(([, list]) => list)
  const content = boundsOf(drawn, extra)
  const board = outline.length > 2 ? boundsOf(base, outline) : null
  const trusted = board && content && board.width * board.height < content.width * content.height * 4
  if (!trusted && outline.length > 2) base.shift()
  const bounds = trusted ? board : (content ?? boundsOf(base))
  const primitives = [...base, ...drawn]
  if (!bounds || primitives.length === 0) return null
  return { title, documentKind: 'pcb', primitives, bounds, shapeCount: primitives.length, unknownShapePrefixes: [] }
}
