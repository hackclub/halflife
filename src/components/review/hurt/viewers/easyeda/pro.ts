import { openZip } from '../../core/archive'
import {
  includeText,
  pathPoints,
  usedLayers,
  type EasyEdaVisualBounds,
  type EasyEdaVisualDocument,
  type EasyEdaVisualPrimitive,
} from './visual'

export type ProRecord = unknown[]

export interface ProDocument {
  docType: string
  records: ProRecord[]
}

export interface ProArchive {
  projectInfo: ProjectInfo | null
  pcbs: Map<string, ProDocument>
  schematicSheets: Map<string, ProDocument> // key: sheetUuid (folder)/sheetId
  footprints: Map<string, ProDocument>
  symbols: Map<string, ProDocument>
}

export interface ProjectInfo {
  schematics: Array<{
    uuid: string
    name: string
    sheets: Array<{ id: number | string; name: string; uuid: string }>
  }>
  pcbs: Array<{ uuid: string; name: string }>
  deviceSymbols?: Map<string, string>
}

export function parseProDocument(text: string): ProDocument | null {
  const lines = text.split(/\r?\n/)
  const records: ProRecord[] = []
  let docType = ''
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!Array.isArray(record) || record.length === 0) continue
    const tag = record[0]
    if (typeof tag !== 'string') continue
    if (tag === 'DOCTYPE' && typeof record[1] === 'string') {
      docType = record[1]
    }
    records.push(record as ProRecord)
  }
  if (records.length === 0) return null
  return { docType, records }
}

const PRO_TEXT_EXTENSIONS = ['.epcb', '.esch', '.efoo', '.esym']
const TEXT_DECODER = new TextDecoder('utf-8')

function isProTextEntry(name: string): boolean {
  const lower = name.toLowerCase()
  return PRO_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

function entryBaseId(name: string): string {
  const lastSlash = name.lastIndexOf('/')
  const file = lastSlash >= 0 ? name.slice(lastSlash + 1) : name
  const dot = file.lastIndexOf('.')
  return dot >= 0 ? file.slice(0, dot) : file
}

export async function extractEasyEdaProArchive(content: ArrayBuffer): Promise<ProArchive> {
  const zip = openZip(content)

  const archive: ProArchive = {
    projectInfo: null,
    pcbs: new Map(),
    schematicSheets: new Map(),
    footprints: new Map(),
    symbols: new Map(),
  }

  for (const entry of zip.entries) {
    if (entry.dir) continue
    const lower = entry.name.toLowerCase()
    try {
      if (lower.endsWith('project.json')) {
        const data = await zip.read(entry)
        const text = TEXT_DECODER.decode(data)
        archive.projectInfo = parseProjectInfo(text)
      } else if (isProTextEntry(entry.name)) {
        const data = await zip.read(entry)
        const text = TEXT_DECODER.decode(data)
        const doc = parseProDocument(text)
        if (!doc) continue
        if (lower.endsWith('.epcb')) {
          archive.pcbs.set(entryBaseId(entry.name), doc)
        } else if (lower.endsWith('.esch')) {
          // .esch lives at SHEET/{schematicUuid}/{sheetId}.esch
          const key = sheetKey(entry.name)
          archive.schematicSheets.set(key, doc)
        } else if (lower.endsWith('.efoo')) {
          archive.footprints.set(entryBaseId(entry.name), doc)
        } else if (lower.endsWith('.esym')) {
          archive.symbols.set(entryBaseId(entry.name), doc)
        }
      }
    } catch {}
  }

  return archive
}

function sheetKey(entryName: string): string {
  // For SHEET/{schUuid}/{sheetId}.esch we want "{schUuid}/{sheetId}".
  const parts = entryName.split('/')
  if (parts.length >= 2) {
    const file = parts[parts.length - 1]
    const sheetId = file.replace(/\.esch$/i, '')
    const schUuid = parts[parts.length - 2]
    return `${schUuid}/${sheetId}`
  }
  return entryBaseId(entryName)
}

function parseProjectInfo(text: string): ProjectInfo | null {
  try {
    const value = JSON.parse(text) as unknown
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const schematicsRaw = (record.schematics as Record<string, unknown> | undefined) ?? undefined
    const pcbsRaw = (record.pcbs as Record<string, unknown> | undefined) ?? undefined

    const schematics: ProjectInfo['schematics'] = []
    if (schematicsRaw && typeof schematicsRaw === 'object') {
      for (const [uuid, rawEntry] of Object.entries(schematicsRaw)) {
        if (!rawEntry || typeof rawEntry !== 'object') continue
        const entry = rawEntry as Record<string, unknown>
        const name = typeof entry.name === 'string' ? entry.name : uuid
        const sheets: ProjectInfo['schematics'][number]['sheets'] = []
        if (Array.isArray(entry.sheets)) {
          for (const sheet of entry.sheets) {
            if (!sheet || typeof sheet !== 'object') continue
            const s = sheet as Record<string, unknown>
            sheets.push({
              id: typeof s.id === 'number' || typeof s.id === 'string' ? s.id : '',
              name: typeof s.name === 'string' ? s.name : String(s.id ?? ''),
              uuid: typeof s.uuid === 'string' ? s.uuid : '',
            })
          }
        }
        schematics.push({ uuid, name, sheets })
      }
    }

    const pcbs: ProjectInfo['pcbs'] = []
    if (pcbsRaw && typeof pcbsRaw === 'object') {
      for (const [uuid, name] of Object.entries(pcbsRaw)) {
        pcbs.push({ uuid, name: typeof name === 'string' ? name : uuid })
      }
    }

    const deviceSymbols = new Map<string, string>()
    if (record.devices && typeof record.devices === 'object') {
      for (const [uuid, device] of Object.entries(record.devices as Record<string, unknown>)) {
        const symbol = (device as { attributes?: { Symbol?: unknown } } | null)?.attributes?.Symbol
        if (typeof symbol === 'string' && symbol) deviceSymbols.set(uuid, symbol)
      }
    }

    return { schematics, pcbs, deviceSymbols }
  } catch {
    return null
  }
}

const PCB_LAYER_COLORS: Record<string, string> = {
  '1': '#ce2929', // top copper
  '2': '#2c8bd6', // bottom copper
  '3': '#dadada', // top silk
  '4': '#9aa0a6', // bottom silk
  '5': '#7a3aa3', // top solder mask
  '6': '#a45cd1', // bottom solder mask
  '7': '#7e7e7e', // top paste mask
  '8': '#a04444', // bottom paste mask
  '9': '#33cc99', // top assembly
  '10': '#5566ff', // bottom assembly
  '11': '#ff66ff', // outline
  '12': '#cccccc', // multi
  '13': '#f4f4f4', // document
  '14': '#f022f0', // mechanical
  '47': '#1a1a1a', // hole
  '48': '#33cccc', // component shape
  '49': '#66ffcc', // component marking
  '50': '#cc9999', // pin soldering
  '51': '#ff99ff', // pin floating
}

const COPPER_LAYERS = new Set([
  '1',
  '2',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '40',
  '41',
  '42',
  '43',
  '44',
  '45',
  '46',
])

interface LayerInfo {
  id: string
  name: string
  type: string
  color: string
  visible: boolean
}

interface Sink {
  primitives: EasyEdaVisualPrimitive[]
  points: number
  layer?: string | null
}

interface PcbContext extends Sink {
  layers: Map<string, LayerInfo>
  footprints: Map<string, ProDocument>
  unknownTags: Set<string>
  pourLayerById: Map<string, string>
  loose: Set<EasyEdaVisualPrimitive>
}

interface ComponentTransform {
  cx: number
  cy: number
  rotation: number // degrees
  flipY: boolean
  layerSwap: boolean
  yUp: boolean
}

interface PointXY {
  x: number
  y: number
}

interface Mapper {
  at: (x: number, y: number) => PointXY
  scale: number
}

const IDENTITY_TRANSFORM: ComponentTransform = {
  cx: 0,
  cy: 0,
  rotation: 0,
  flipY: false,
  layerSwap: false,
  yUp: true,
}

const MAX_PRIMITIVES = 100_000
const MAX_POINTS = 500_000
const POURED_SCALE = 10
const DOCUMENT_LAYER = '13'
const MULTI_LAYER = '12'

function full(sink: Sink): boolean {
  return sink.primitives.length >= MAX_PRIMITIVES || sink.points >= MAX_POINTS
}

function add(sink: Sink, primitive: EasyEdaVisualPrimitive): EasyEdaVisualPrimitive | null {
  if (full(sink)) return null
  if (sink.layer) primitive.layer = sink.layer
  sink.primitives.push(primitive)
  sink.points +=
    primitive.kind === 'polyline'
      ? primitive.points.length
      : primitive.kind === 'path'
        ? (primitive.points?.length ?? 1)
        : 1
  return primitive
}

function mapperFor(t: ComponentTransform): Mapper {
  return { at: (x, y) => applyTransform(t, x, y), scale: 1 }
}

export function buildEasyEdaProPcbVisual(
  archive: ProArchive,
  pcbDoc: ProDocument,
  title: string,
): EasyEdaVisualDocument | null {
  const ctx: PcbContext = {
    layers: new Map(),
    primitives: [],
    points: 0,
    footprints: archive.footprints,
    unknownTags: new Set(),
    pourLayerById: new Map(),
    loose: new Set(),
  }

  for (const rec of pcbDoc.records) {
    if (rec[0] === 'LAYER') readLayer(rec, ctx)
    if (rec[0] === 'POUR') {
      const id = String(rec[1] ?? '')
      const layer = String(rec[4] ?? '')
      if (id && layer) ctx.pourLayerById.set(id, layer)
    }
  }

  const attrByComponent = new Map<string, Map<string, string>>()
  for (const rec of pcbDoc.records) {
    if (rec[0] === 'ATTR') {
      const compId = String(rec[3] ?? '')
      const key = String(rec[7] ?? '')
      const val = rec[8] == null ? '' : String(rec[8])
      if (!compId || !key) continue
      let m = attrByComponent.get(compId)
      if (!m) {
        m = new Map()
        attrByComponent.set(compId, m)
      }
      m.set(key, val)
    }
  }

  for (const rec of pcbDoc.records) {
    if (full(ctx)) break
    renderRecord(rec, ctx, IDENTITY_TRANSFORM)
  }

  for (const rec of pcbDoc.records) {
    if (full(ctx)) break
    if (rec[0] !== 'COMPONENT') continue
    const compId = String(rec[1] ?? '')
    const layerSide = String(rec[3] ?? '1')
    const cx = numberAt(rec, 4)
    const cy = numberAt(rec, 5)
    const rotation = numberAt(rec, 6)
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue

    const attrs = attrByComponent.get(compId)
    const footprintId = attrs?.get('Footprint')
    if (!footprintId) continue
    const footprint = archive.footprints.get(footprintId)
    if (!footprint) continue

    const flipY = layerSide === '2'
    const transform: ComponentTransform = {
      cx,
      cy,
      rotation,
      flipY,
      layerSwap: flipY,
      yUp: true,
    }

    for (const fpRec of footprint.records) {
      if (full(ctx)) break
      renderRecord(fpRec, ctx, transform)
    }
  }

  if (ctx.primitives.length === 0) return null

  const fitted = ctx.primitives.filter((p) => !ctx.loose.has(p))
  const bounds = computeBounds(fitted.length > 0 ? fitted : ctx.primitives)
  if (!bounds) return null

  return {
    title,
    documentKind: 'pcb',
    primitives: ctx.primitives,
    bounds,
    shapeCount: pcbDoc.records.length,
    unknownShapePrefixes: Array.from(ctx.unknownTags).sort(),
    layers: usedLayers(ctx.primitives, (id) => ctx.layers.get(id)?.name.replace(/([a-z])([A-Z])/g, '$1 $2')),
  }
}

function readLayer(rec: ProRecord, ctx: PcbContext): void {
  // ["LAYER", id, type, name, visible(?), color, opacity, color2, ?]
  const id = String(rec[1] ?? '')
  const type = String(rec[2] ?? '')
  const name = String(rec[3] ?? '')
  const visibleFlag = rec[4]
  const visible = !(visibleFlag === 0 || visibleFlag === false)
  const rawColor = typeof rec[5] === 'string' ? rec[5] : ''
  const color = PCB_LAYER_COLORS[id] ?? (rawColor || '#bbbbbb')
  ctx.layers.set(id, { id, name, type, color, visible })
}

function renderRecord(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  const tag = rec[0]
  if (typeof tag !== 'string') return
  ctx.layer = tag === 'VIA' ? MULTI_LAYER : null
  switch (tag) {
    case 'LINE':
      renderLine(rec, ctx, t)
      break
    case 'ARC':
      renderArc(rec, ctx, t)
      break
    case 'VIA':
      renderVia(rec, ctx, t)
      break
    case 'PAD':
      renderPad(rec, ctx, t)
      break
    case 'FILL':
      renderFill(rec, ctx, t)
      break
    case 'POLY':
      renderPoly(rec, ctx, t)
      break
    case 'REGION':
      renderRegion(rec, ctx, t)
      break
    case 'POURED':
      renderPoured(rec, ctx, t)
      break
    case 'STRING':
      renderString(rec, ctx, t)
      break
    case 'IMAGE':
      renderImage(rec, ctx, t)
      break
    case 'COMPONENT':
    case 'ATTR':
    case 'LAYER':
    case 'LAYER_PHYS':
    case 'NET':
    case 'PAD_NET':
    case 'PRIMITIVE':
    case 'CANVAS':
    case 'HEAD':
    case 'DOCTYPE':
    case 'ACTIVE_LAYER':
    case 'PANELIZE':
    case 'PANELIZE_SIDE':
    case 'PANELIZE_STAMP':
    case 'PREFERENCE':
    case 'RULE':
    case 'RULE_TEMPLATE':
    case 'RULE_SELECTOR':
    case 'POUR':
    case 'FONT':
    case 'SILK_OPTS':
    case 'HOLE':
      break
    default:
      ctx.unknownTags.add(tag)
  }
}

function applyTransform(t: ComponentTransform, x: number, y: number): { x: number; y: number } {
  const px = t.flipY ? -x : x
  const rad = (t.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const ty = t.cy + px * sin + y * cos
  return { x: t.cx + px * cos - y * sin, y: t.yUp ? -ty : ty }
}

function screenAngle(t: ComponentTransform, local: number): number {
  const angle = t.flipY ? t.rotation - local : t.rotation + local
  return t.yUp ? -angle : angle
}

function sampleArc(cx: number, cy: number, r: number, start: number, sweep: number): PointXY[] {
  const steps = Math.min(32, Math.max(2, Math.ceil((Math.abs(sweep) * 180) / Math.PI / 10)))
  const out: PointXY[] = []
  for (let k = 1; k <= steps; k++) {
    const a = start + (sweep * k) / steps
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return out
}

function arcPoints(sx: number, sy: number, ex: number, ey: number, sweepDeg: number): PointXY[] {
  const sweep = (sweepDeg * Math.PI) / 180
  const chord = Math.hypot(ex - sx, ey - sy)
  const half = Math.tan(sweep / 2)
  if (!chord || !Number.isFinite(half) || Math.abs(half) < 1e-9 || Math.abs(sweepDeg) >= 360) return [{ x: ex, y: ey }]
  const d = chord / 2 / half
  const cx = (sx + ex) / 2 - ((ey - sy) / chord) * d
  const cy = (sy + ey) / 2 + ((ex - sx) / chord) * d
  const out = sampleArc(cx, cy, Math.hypot(sx - cx, sy - cy), Math.atan2(sy - cy, sx - cx), sweep)
  out[out.length - 1] = { x: ex, y: ey }
  return out
}

function threePointArc(x1: number, y1: number, xm: number, ym: number, x2: number, y2: number): PointXY[] {
  const d = 2 * (x1 * (ym - y2) + xm * (y2 - y1) + x2 * (y1 - ym))
  if (Math.abs(d) < 1e-9)
    return [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ]
  const s1 = x1 * x1 + y1 * y1
  const sm = xm * xm + ym * ym
  const s2 = x2 * x2 + y2 * y2
  const cx = (s1 * (ym - y2) + sm * (y2 - y1) + s2 * (y1 - ym)) / d
  const cy = (s1 * (x2 - xm) + sm * (x1 - x2) + s2 * (xm - x1)) / d
  const tau = Math.PI * 2
  const start = Math.atan2(y1 - cy, x1 - cx)
  const turn = (x: number, y: number) => (((Math.atan2(y - cy, x - cx) - start) % tau) + tau) % tau
  let sweep = turn(x2, y2)
  if (turn(xm, ym) > sweep) sweep -= tau
  return [{ x: x1, y: y1 }, ...sampleArc(cx, cy, Math.hypot(x1 - cx, y1 - cy), start, sweep)]
}

function ellipsePoints(cx: number, cy: number, rx: number, ry: number, rotDeg: number): PointXY[] {
  const rot = (rotDeg * Math.PI) / 180
  const out: PointXY[] = []
  for (let k = 0; k < 36; k++) {
    const a = (k * Math.PI) / 18
    const x = rx * Math.cos(a)
    const y = ry * Math.sin(a)
    out.push({ x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) })
  }
  return out
}

function applyTransformLayer(t: ComponentTransform, layer: string): string {
  if (!t.layerSwap) return layer
  // Swap top<->bottom layer pairs when component is on bottom side.
  const swap: Record<string, string> = {
    '1': '2',
    '2': '1',
    '3': '4',
    '4': '3',
    '5': '6',
    '6': '5',
    '7': '8',
    '8': '7',
    '9': '10',
    '10': '9',
  }
  return swap[layer] ?? layer
}

function layerColor(ctx: PcbContext, layer: string, fallback = '#bbbbbb'): string {
  const info = ctx.layers.get(layer)
  if (info) return info.color
  return PCB_LAYER_COLORS[layer] ?? fallback
}

function enterLayer(ctx: PcbContext, layer: string): boolean {
  ctx.layer = layer
  const info = ctx.layers.get(layer)
  if (!info) return true
  if (!info.visible) return false
  // Hide deep inner copper, keepouts, dielectrics, etc to keep render readable.
  if (info.type === 'SUBSTRATE') return false
  return true
}

function numberAt(rec: unknown[], idx: number, fallback = 0): number {
  const v = rec[idx]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function renderLine(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["LINE", id, ?, net, layer, x1, y1, x2, y2, width, ...]
  const layerRaw = String(rec[4] ?? '')
  const layer = applyTransformLayer(t, layerRaw)
  if (!enterLayer(ctx, layer)) return
  const x1 = numberAt(rec, 5)
  const y1 = numberAt(rec, 6)
  const x2 = numberAt(rec, 7)
  const y2 = numberAt(rec, 8)
  const width = Math.max(0.4, numberAt(rec, 9, 1))
  const a = applyTransform(t, x1, y1)
  const b = applyTransform(t, x2, y2)
  const isCopper = COPPER_LAYERS.has(layer)
  add(ctx, {
    kind: 'polyline',
    points: [a, b],
    closed: false,
    stroke: layerColor(ctx, layer),
    strokeWidth: width,
    fill: null,
    opacity: isCopper ? 0.95 : 0.9,
  })
}

function renderArc(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["ARC", id, ?, net, layer, x1, y1, x2, y2, sweepAngle, width, ...]
  const layerRaw = String(rec[4] ?? '')
  const layer = applyTransformLayer(t, layerRaw)
  if (!enterLayer(ctx, layer)) return
  const sx = numberAt(rec, 5)
  const sy = numberAt(rec, 6)
  const local = [{ x: sx, y: sy }, ...arcPoints(sx, sy, numberAt(rec, 7), numberAt(rec, 8), numberAt(rec, 9))]
  add(ctx, {
    kind: 'polyline',
    points: local.map((p) => applyTransform(t, p.x, p.y)),
    closed: false,
    stroke: layerColor(ctx, layer),
    strokeWidth: Math.max(0.4, numberAt(rec, 10, 1)),
    fill: null,
    opacity: 0.95,
  })
}

function renderVia(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["VIA", id, ?, net, padId, x, y, holeDiameter, padDiameter, ...]
  const x = numberAt(rec, 5)
  const y = numberAt(rec, 6)
  const holeD = numberAt(rec, 7)
  const padD = numberAt(rec, 8)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  const p = applyTransform(t, x, y)
  add(ctx, {
    kind: 'circle',
    cx: p.x,
    cy: p.y,
    r: Math.max(padD / 2, holeD / 2 + 1),
    stroke: '#c9a227',
    strokeWidth: 0,
    fill: '#c9a227',
    opacity: 0.95,
  })
  add(ctx, {
    kind: 'circle',
    cx: p.x,
    cy: p.y,
    r: holeD / 2,
    stroke: '#000',
    strokeWidth: 0,
    fill: '#0a0a0a',
    opacity: 1,
  })
}
function renderPad(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["PAD", id, ?, net, layer, name, x, y, rotation, holeShape|null, padShape, ...]
  const layerRaw = String(rec[4] ?? '')
  const layer = applyTransformLayer(t, layerRaw)
  if (!enterLayer(ctx, layer)) return
  const x = numberAt(rec, 6)
  const y = numberAt(rec, 7)
  const rot = numberAt(rec, 8)
  const padShape = rec[10]
  const p = applyTransform(t, x, y)
  const fill = layerColor(ctx, layer === '12' ? '1' : layer)

  if (Array.isArray(padShape) && padShape.length >= 3) {
    const shapeKind = String(padShape[0]).toUpperCase()
    const w = numberAt(padShape, 1)
    const h = numberAt(padShape, 2)
    const padRot = screenAngle(t, rot)
    if (shapeKind === 'ROUND' || shapeKind === 'ELLIPSE' || shapeKind === 'OVAL') {
      const r = Math.min(w, h) / 2
      if (Math.abs(w - h) < 0.01) {
        add(ctx, {
          kind: 'circle',
          cx: p.x,
          cy: p.y,
          r,
          stroke: fill,
          strokeWidth: 0,
          fill,
          opacity: 0.95,
        })
      } else {
        add(ctx, {
          kind: 'rect',
          x: p.x - w / 2,
          y: p.y - h / 2,
          width: w,
          height: h,
          rx: r,
          ry: r,
          rotation: padRot,
          stroke: fill,
          strokeWidth: 0,
          fill,
          opacity: 0.95,
        })
      }
    } else if (shapeKind === 'RECT' || shapeKind === 'SQUARE') {
      const corner = (Math.min(w, h) * Math.min(Math.max(numberAt(padShape, 3), 0), 100)) / 200
      add(ctx, {
        kind: 'rect',
        x: p.x - w / 2,
        y: p.y - h / 2,
        width: w,
        height: h,
        rx: corner,
        ry: corner,
        rotation: padRot,
        stroke: fill,
        strokeWidth: 0,
        fill,
        opacity: 0.95,
      })
    } else if (shapeKind === 'ROUNDRECT') {
      const corner = numberAt(padShape, 4, Math.min(w, h) * 0.2)
      add(ctx, {
        kind: 'rect',
        x: p.x - w / 2,
        y: p.y - h / 2,
        width: w,
        height: h,
        rx: corner,
        ry: corner,
        rotation: padRot,
        stroke: fill,
        strokeWidth: 0,
        fill,
        opacity: 0.95,
      })
    }
  }

  const holeShape = rec[9]
  if (Array.isArray(holeShape) && holeShape.length >= 3) {
    const w = numberAt(holeShape, 1)
    const h = numberAt(holeShape, 2)
    const r = Math.min(w, h) / 2
    add(ctx, {
      kind: 'circle',
      cx: p.x,
      cy: p.y,
      r,
      stroke: '#000',
      strokeWidth: 0,
      fill: '#080808',
      opacity: 1,
    })
  }
}

function renderFill(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["FILL", id, ?, net, layer, lineWidth, ?, shapes, ...]
  const layerRaw = String(rec[4] ?? '')
  const layer = applyTransformLayer(t, layerRaw)
  if (!enterLayer(ctx, layer)) return
  const shapes = rec[7]
  if (!Array.isArray(shapes)) return
  emitShapeData(shapes, ctx, mapperFor(t), layerColor(ctx, layer), true, 0)
}

function renderPoly(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["POLY", id, ?, net, layer, lineWidth, shapes, ...]
  const layerRaw = String(rec[4] ?? '')
  const layer = applyTransformLayer(t, layerRaw)
  if (!enterLayer(ctx, layer)) return
  const lineWidth = numberAt(rec, 5, 1)
  const shape = rec[6]
  if (!Array.isArray(shape)) return
  emitShapeData(shape, ctx, mapperFor(t), layerColor(ctx, layer), false, Math.max(0.4, lineWidth))
}

function renderRegion(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["REGION", id, ?, layer, lineWidth, [layerList], shapes, ...]
  const layerRaw = String(rec[3] ?? '')
  const layer = applyTransformLayer(t, layerRaw)
  if (!enterLayer(ctx, layer)) return
  const shapes = rec[6]
  if (!Array.isArray(shapes)) return
  emitShapeData(shapes, ctx, mapperFor(t), layerColor(ctx, layer), false, Math.max(0.4, numberAt(rec, 4, 1)))
}

function renderPoured(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["POURED", id, parentPourId, ?, dirty, [outline, hole1, hole2, ...]], in tenths of board units
  const parentId = String(rec[2] ?? '')
  const drawLayer = ctx.pourLayerById.get(parentId) ?? '1'
  if (!enterLayer(ctx, drawLayer)) return
  const shapes = rec[5]
  if (!Array.isArray(shapes)) return
  const mapper: Mapper = {
    at: (x, y) => applyTransform(t, x * POURED_SCALE, y * POURED_SCALE),
    scale: POURED_SCALE,
  }
  emitShapeData(shapes, ctx, mapper, layerColor(ctx, drawLayer), true, 0)
}

function renderString(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["STRING", id, ?, layer, x, y, text, font, size, lineWidth, ?, ?, origin, rotation, ...], origin 1-9 runs down each column from left-top
  const layerRaw = String(rec[3] ?? '')
  const layer = applyTransformLayer(t, layerRaw)
  if (!enterLayer(ctx, layer)) return
  const x = numberAt(rec, 4)
  const y = numberAt(rec, 5)
  const text = typeof rec[6] === 'string' ? rec[6] : ''
  if (!text) return
  const size = Math.max(8, numberAt(rec, 8, 12))
  const rotation = numberAt(rec, 13)
  const origin = numberAt(rec, 12) - 1
  const known = Number.isInteger(origin) && origin >= 0 && origin < 9
  const column = known ? Math.floor(origin / 3) : 0
  const h = t.flipY ? 2 - column : column
  const v = known ? origin % 3 : 1
  const p = applyTransform(t, x, y)
  const primitive = add(ctx, {
    kind: 'text',
    x: p.x,
    y: p.y,
    text,
    size,
    rotation: screenAngle(t, rotation),
    fill: layerColor(ctx, layer),
    opacity: 0.95,
    anchor: h === 1 ? 'middle' : h === 2 ? 'end' : 'start',
    baseline: v === 0 ? 'top' : v === 2 ? 'bottom' : 'middle',
  })
  if (primitive && layer === DOCUMENT_LAYER) ctx.loose.add(primitive)
}

function renderImage(rec: ProRecord, ctx: PcbContext, t: ComponentTransform): void {
  // ["IMAGE", id, ?, layer, x, y, width, height, rotation, mirror, [path-data]]
  const layerRaw = String(rec[3] ?? '')
  const layer = applyTransformLayer(t, layerRaw)
  if (!enterLayer(ctx, layer)) return
  const data = rec[10]
  if (!Array.isArray(data)) return
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const shape of shapeList(data))
    for (const p of tokenPoints(shape, IDENTITY_MAPPER, MAX_POINTS - ctx.points)) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
  if (!Number.isFinite(minX)) return
  const sx = numberAt(rec, 6) / (maxX - minX || 1)
  const sy = numberAt(rec, 7) / (maxY - minY || 1)
  const x = numberAt(rec, 4)
  const y = numberAt(rec, 5)
  const rad = (numberAt(rec, 8) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const mirror = rec[9] === 1 || rec[9] === true
  const mapper: Mapper = {
    at: (px, py) => {
      const dx = (mirror ? maxX - px : px - minX) * sx
      const dy = (py - maxY) * sy
      return applyTransform(t, x + dx * cos - dy * sin, y + dx * sin + dy * cos)
    },
    scale: (sx + sy) / 2,
  }
  emitShapeData(data, ctx, mapper, layerColor(ctx, layer), true, 0)
}

const IDENTITY_MAPPER: Mapper = { at: (x, y) => ({ x, y }), scale: 1 }

function shapeList(shapes: unknown[]): unknown[][] {
  if (typeof shapes[0] === 'string' || typeof shapes[0] === 'number') return [shapes]
  return shapes.filter((shape): shape is unknown[] => Array.isArray(shape))
}

function tokenPoints(shape: unknown[], mapper: Mapper, limit: number): PointXY[] {
  if (typeof shape[0] !== 'number' || typeof shape[1] !== 'number' || limit <= 0) return []
  let cur = { x: shape[0], y: shape[1] }
  const points = [mapper.at(cur.x, cur.y)]
  let i = 2
  while (i < shape.length && points.length < limit) {
    const token = shape[i]
    if (token === 'ARC' || token === 'arc') {
      const end = { x: numberAt(shape, i + 2), y: numberAt(shape, i + 3) }
      for (const p of arcPoints(cur.x, cur.y, end.x, end.y, numberAt(shape, i + 1))) points.push(mapper.at(p.x, p.y))
      cur = end
      i += 4
    } else if (typeof token === 'number' && typeof shape[i + 1] === 'number') {
      cur = { x: token, y: shape[i + 1] as number }
      points.push(mapper.at(cur.x, cur.y))
      i += 2
    } else if (token === 'L' || token === 'l') {
      i += 1
    } else {
      break
    }
  }
  return points
}

function emitShapeData(
  shapes: unknown[],
  ctx: PcbContext,
  mapper: Mapper,
  color: string,
  filled: boolean,
  strokeWidth: number,
): void {
  const rings: PointXY[][] = []
  let budget = MAX_POINTS - ctx.points
  for (const shape of shapeList(shapes)) {
    if (full(ctx) || budget <= 0) break
    if (typeof shape[0] === 'string') {
      emitSpecialShape(shape, ctx, mapper, color, filled, strokeWidth)
      continue
    }
    const points = tokenPoints(shape, mapper, budget)
    budget -= points.length
    if (points.length >= 2) rings.push(points)
  }
  if (rings.length === 0) return
  if (!filled) {
    for (const points of rings)
      add(ctx, {
        kind: 'polyline',
        points,
        closed: false,
        stroke: color,
        strokeWidth: strokeWidth || 1,
        fill: null,
        opacity: 0.9,
      })
    return
  }
  add(ctx, {
    kind: 'path',
    path: rings.map((ring) => `M ${ring.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`).join(' '),
    points: rings.flat(),
    stroke: color,
    strokeWidth: strokeWidth || 0.5,
    fill: color,
    opacity: 0.45,
  })
}

function emitSpecialShape(
  shape: unknown[],
  ctx: PcbContext,
  mapper: Mapper,
  color: string,
  filled: boolean,
  strokeWidth: number,
): void {
  const paint = {
    stroke: color,
    strokeWidth,
    fill: filled ? color : null,
    opacity: filled ? 0.55 : 0.9,
  }
  const tag = String(shape[0]).toUpperCase()
  if (tag === 'CIRCLE' && shape.length >= 4) {
    const c = mapper.at(numberAt(shape, 1), numberAt(shape, 2))
    add(ctx, { kind: 'circle', cx: c.x, cy: c.y, r: numberAt(shape, 3) * mapper.scale, ...paint })
  } else if (tag === 'ELLIPSE' && shape.length >= 5) {
    const points = ellipsePoints(numberAt(shape, 1), numberAt(shape, 2), numberAt(shape, 3), numberAt(shape, 4), 0)
    add(ctx, { kind: 'polyline', points: points.map((p) => mapper.at(p.x, p.y)), closed: true, ...paint })
  } else if (tag === 'R' && shape.length >= 5) {
    // ["R", x, y, width, height, rotation, cornerRadius]: (x, y) is the top-left corner and y points up
    const corners = rotatedCorners(
      numberAt(shape, 1),
      numberAt(shape, 2),
      numberAt(shape, 3),
      -numberAt(shape, 4),
      numberAt(shape, 5),
    )
    const mapped = corners.map((p) => mapper.at(p.x, p.y))
    add(ctx, quad(mapped, numberAt(shape, 6) * mapper.scale, { ...paint, opacity: filled ? 0.45 : 0.9 }))
  }
}

interface FontStyle {
  size: number | null
  valign: number | null
  halign: number | null
}

interface TableInfo {
  x: number
  y: number
  rows: number[]
  cols: number[]
  covered: Set<string>
}

const SCH_TEXT_SIZE = 8
const SCH_INK = { wire: '#5fc16e', bus: '#7d97f7', body: '#a06e2c', pin: '#d4a23c', text: '#a0b6e8' }
const DRAWING_SYMBOL = 20
const MAX_SPAN = 64
const PAGE_SIZES: Record<string, [number, number]> = {
  A0: [4681, 3311],
  A1: [3311, 2339],
  A2: [2339, 1654],
  A3: [1654, 1169],
  A4: [1169, 827],
  A5: [827, 583],
}
const SCH_SKIPPED = new Set(['DOCTYPE', 'HEAD', 'FONTSTYLE', 'LINESTYLE', 'PART', 'OBJ', 'ATTR'])

function optionalNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? parseFloat(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function fontStyles(doc: ProDocument): Map<string, FontStyle> {
  const styles = new Map<string, FontStyle>()
  for (const rec of doc.records)
    if (rec[0] === 'FONTSTYLE')
      styles.set(String(rec[1]), {
        size: optionalNumber(rec[5]),
        valign: optionalNumber(rec[10]),
        halign: optionalNumber(rec[11]),
      })
  return styles
}

function isShown(value: unknown): boolean {
  return value === true || value === 1 || value === '1'
}

function schText(
  sink: Sink,
  t: ComponentTransform,
  x: number,
  y: number,
  rotation: number,
  text: string,
  style: FontStyle | undefined,
): void {
  if (!text) return
  const p = applyTransform(t, x, y)
  let angle = ((screenAngle(t, rotation) % 360) + 360) % 360
  let h = style?.halign ?? 0
  let v = style?.valign ?? 2
  if (t.flipY) h = 2 - h
  if (angle > 90 && angle <= 270) {
    angle -= 180
    h = 2 - h
    v = 2 - v
  }
  add(sink, {
    kind: 'text',
    x: p.x,
    y: p.y,
    text,
    size: style?.size || SCH_TEXT_SIZE,
    rotation: angle,
    fill: SCH_INK.text,
    opacity: 0.9,
    anchor: h === 1 ? 'middle' : h === 2 ? 'end' : 'start',
    baseline: v === 0 ? 'top' : v === 1 ? 'middle' : 'baseline',
  })
}

function outline(sink: Sink, t: ComponentTransform, corners: PointXY[], radius: number, stroke: string): void {
  const mapped = corners.map((p) => applyTransform(t, p.x, p.y))
  add(sink, quad(mapped, radius, { stroke, strokeWidth: 1, fill: null, opacity: 0.9 }))
}

function quad(
  corners: PointXY[],
  radius: number,
  paint: { stroke: string; strokeWidth: number; fill: string | null; opacity: number },
): EasyEdaVisualPrimitive {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6 * (1 + Math.abs(a))
  const [a, b, c] = corners
  const aligned = (near(a.x, b.x) && near(b.y, c.y)) || (near(a.y, b.y) && near(b.x, c.x))
  if (!aligned) return { kind: 'polyline', points: corners, closed: true, ...paint }
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(...xs) - x
  const height = Math.max(...ys) - y
  const r = Math.min(Math.max(0, radius), width / 2, height / 2)
  return { kind: 'rect', x, y, width, height, rx: r, ry: r, rotation: 0, ...paint }
}

function rotatedCorners(x: number, y: number, w: number, h: number, angle: number): PointXY[] {
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([dx, dy]) => ({ x: x + dx * cos - dy * sin, y: y + dx * sin + dy * cos }))
}

function renderSchShape(rec: ProRecord, t: ComponentTransform, sink: Sink, styles: Map<string, FontStyle>): boolean {
  const line = (points: PointXY[], closed = false) =>
    add(sink, {
      kind: 'polyline',
      points: points.map((p) => applyTransform(t, p.x, p.y)),
      closed,
      stroke: SCH_INK.body,
      strokeWidth: 1,
      fill: null,
      opacity: 0.9,
    })
  switch (rec[0]) {
    case 'POLY':
    case 'LINE': {
      // ["POLY", id, [x1, y1, x2, y2, ...], closed, style, ...]
      const flat = Array.isArray(rec[2]) ? (rec[2] as unknown[]) : rec.slice(2)
      const points: PointXY[] = []
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const x = flat[i]
        const y = flat[i + 1]
        if (typeof x !== 'number' || typeof y !== 'number') break
        points.push({ x, y })
      }
      if (points.length >= 2) line(points, rec[0] === 'POLY' && isShown(rec[3]))
      return true
    }
    case 'RECT': {
      // ["RECT", id, x1, y1, x2, y2, rx, ry, rotation, style, ...]
      const x1 = numberAt(rec, 2)
      const y1 = numberAt(rec, 3)
      const corners = rotatedCorners(x1, y1, numberAt(rec, 4) - x1, numberAt(rec, 5) - y1, numberAt(rec, 8))
      outline(sink, t, corners, numberAt(rec, 6), SCH_INK.body)
      return true
    }
    case 'CIRCLE': {
      // ["CIRCLE", id, cx, cy, r, style, ...]
      const c = applyTransform(t, numberAt(rec, 2), numberAt(rec, 3))
      add(sink, {
        kind: 'circle',
        cx: c.x,
        cy: c.y,
        r: Math.abs(numberAt(rec, 4)),
        stroke: SCH_INK.body,
        strokeWidth: 1,
        fill: null,
        opacity: 0.9,
      })
      return true
    }
    case 'ELLIPSE':
      // ["ELLIPSE", id, cx, cy, rx, ry, rotation, style, ...]
      line(
        ellipsePoints(numberAt(rec, 2), numberAt(rec, 3), numberAt(rec, 4), numberAt(rec, 5), numberAt(rec, 6)),
        true,
      )
      return true
    case 'ARC':
      // ["ARC", id, startX, startY, midX, midY, endX, endY, style, ...]
      line(
        threePointArc(
          numberAt(rec, 2),
          numberAt(rec, 3),
          numberAt(rec, 4),
          numberAt(rec, 5),
          numberAt(rec, 6),
          numberAt(rec, 7),
        ),
      )
      return true
    case 'TEXT':
      // ["TEXT", id, x, y, rotation, text, style, ...]
      if (typeof rec[5] === 'string')
        schText(sink, t, numberAt(rec, 2), numberAt(rec, 3), numberAt(rec, 4), rec[5], styles.get(String(rec[6])))
      return true
  }
  return false
}

export function buildEasyEdaProSchematicVisual(
  archive: ProArchive,
  schDoc: ProDocument,
  title: string,
): EasyEdaVisualDocument | null {
  const sink: Sink = { primitives: [], points: 0 }
  const unknownTags = new Set<string>()
  const styles = fontStyles(schDoc)

  const attrByComponent = new Map<string, Map<string, string>>()
  for (const rec of schDoc.records) {
    if (rec[0] === 'ATTR') {
      const compId = String(rec[2] ?? '')
      const key = String(rec[3] ?? '')
      const val = rec[4] == null ? '' : String(rec[4])
      if (!compId || !key) continue
      let m = attrByComponent.get(compId)
      if (!m) {
        m = new Map()
        attrByComponent.set(compId, m)
      }
      m.set(key, val)
    }
  }

  for (const rec of schDoc.records) {
    if (full(sink)) break
    const tag = rec[0]
    switch (tag) {
      case 'WIRE':
      case 'BUS': {
        // ["WIRE", id, [[x1,y1,x2,y2,...], ...], style, ...]
        const segments = rec[2]
        if (!Array.isArray(segments)) break
        for (const points of segments) {
          if (!Array.isArray(points) || points.length < 4) continue
          const pts: PointXY[] = []
          for (let k = 0; k + 1 < points.length; k += 2) {
            pts.push(applyTransform(IDENTITY_TRANSFORM, numberAt(points, k), numberAt(points, k + 1)))
          }
          add(sink, {
            kind: 'polyline',
            points: pts,
            closed: false,
            stroke: tag === 'WIRE' ? SCH_INK.wire : SCH_INK.bus,
            strokeWidth: tag === 'WIRE' ? 1 : 3,
            fill: null,
            opacity: 0.95,
          })
        }
        break
      }
      case 'COMPONENT': {
        // ["COMPONENT", id, partId, x, y, rotation, mirror, ...]
        const attrs = attrByComponent.get(String(rec[1] ?? ''))
        const symbolId = attrs?.get('Symbol') || archive.projectInfo?.deviceSymbols?.get(attrs?.get('Device') ?? '')
        const symbol = attrs && archive.symbols.get(symbolId ?? '')
        if (!symbol) break
        const t: ComponentTransform = {
          cx: numberAt(rec, 3),
          cy: numberAt(rec, 4),
          rotation: numberAt(rec, 5),
          flipY: isShown(rec[6]),
          layerSwap: false,
          yUp: true,
        }
        renderSymbol(symbol, t, attrs, String(rec[2] ?? ''), sink, unknownTags)
        break
      }
      case 'JUNCTION':
      case 'NETLABEL':
      case 'NETPORT': {
        const p = applyTransform(IDENTITY_TRANSFORM, numberAt(rec, 3), numberAt(rec, 4))
        add(sink, {
          kind: 'circle',
          cx: p.x,
          cy: p.y,
          r: 2,
          stroke: SCH_INK.wire,
          strokeWidth: 0,
          fill: SCH_INK.wire,
          opacity: 0.95,
        })
        break
      }
      case 'ATTR': {
        // ["ATTR", id, parent, key, value, keyVisible, valueVisible, x, y, rotation, style, ...]
        const value = rec[4]
        if (typeof value !== 'string' || !isShown(rec[6])) break
        if (typeof rec[7] !== 'number' || typeof rec[8] !== 'number') break
        schText(sink, IDENTITY_TRANSFORM, rec[7], rec[8], numberAt(rec, 9), value, styles.get(String(rec[10])))
        break
      }
      default:
        if (!renderSchShape(rec, IDENTITY_TRANSFORM, sink, styles) && typeof tag === 'string' && !SCH_SKIPPED.has(tag))
          unknownTags.add(tag)
    }
  }

  if (sink.primitives.length === 0) return null

  const bounds = computeBounds(sink.primitives)
  if (!bounds) return null

  return {
    title,
    documentKind: 'schematic',
    primitives: sink.primitives,
    bounds,
    shapeCount: schDoc.records.length,
    unknownShapePrefixes: Array.from(unknownTags).sort(),
  }
}

function renderSymbol(
  symbol: ProDocument,
  placement: ComponentTransform,
  attrs: Map<string, string>,
  partId: string,
  sink: Sink,
  unknownTags: Set<string>,
): void {
  const styles = fontStyles(symbol)
  const filtered = symbol.records.some((rec) => rec[0] === 'PART' && rec[1] === partId)
  const hiddenPins = new Set<string>()
  const tables = new Map<string, TableInfo>()
  const drawing = symbol.records.some(
    (rec) => rec[0] === 'HEAD' && (rec[1] as { symbolType?: unknown } | null)?.symbolType === DRAWING_SYMBOL,
  )
  const t = drawing ? drawFrame(symbol, placement, attrs, sink) : placement
  let part = ''
  for (const rec of symbol.records) {
    if (full(sink)) return
    const tag = rec[0]
    if (tag === 'PART') part = String(rec[1] ?? '')
    if (filtered && part !== partId) continue
    switch (tag) {
      case 'PIN': {
        // ["PIN", id, display, electric, x, y, length, rotation, ...]
        if (rec[2] === 0 || rec[2] === false) {
          hiddenPins.add(String(rec[1]))
          break
        }
        const x = numberAt(rec, 4)
        const y = numberAt(rec, 5)
        const len = numberAt(rec, 6, 10)
        const rad = (numberAt(rec, 7) * Math.PI) / 180
        add(sink, {
          kind: 'polyline',
          points: [applyTransform(t, x, y), applyTransform(t, x + len * Math.cos(rad), y + len * Math.sin(rad))],
          closed: false,
          stroke: SCH_INK.pin,
          strokeWidth: 1,
          fill: null,
          opacity: 0.9,
        })
        break
      }
      case 'ATTR': {
        // ["ATTR", id, parent, key, value, keyVisible, valueVisible, x, y, rotation, style, ...]
        const value = rec[4]
        if (typeof value !== 'string' || !isShown(rec[6]) || hiddenPins.has(String(rec[2]))) break
        if (rec[2] === '' && attrs.has(String(rec[3]))) break
        if (typeof rec[7] !== 'number' || typeof rec[8] !== 'number') break
        schText(sink, t, rec[7], rec[8], numberAt(rec, 9), value, styles.get(String(rec[10])))
        break
      }
      case 'TABLE': {
        // ["TABLE", id, x, y, rowHeights, columnWidths, ...]
        if (drawing && attrs.get('Title Block') === '0') break
        const sizes = (value: unknown) => (Array.isArray(value) ? value.map((n) => optionalNumber(n) ?? 0) : [])
        tables.set(String(rec[1]), {
          x: numberAt(rec, 2),
          y: numberAt(rec, 3),
          rows: sizes(rec[4]),
          cols: sizes(rec[5]),
          covered: new Set(),
        })
        break
      }
      case 'TABEL_CELL':
        renderTableCell(rec, tables.get(String(rec[2])), t, attrs, styles, sink)
        break
      default:
        if (!renderSchShape(rec, t, sink, styles) && typeof tag === 'string' && !SCH_SKIPPED.has(tag))
          unknownTags.add(`sym:${tag}`)
    }
  }
}

function drawFrame(symbol: ProDocument, t: ComponentTransform, attrs: Map<string, string>, sink: Sink) {
  // Drawing frames are laid out for their native page; the page border and title block follow the sheet's own size.
  const page = PAGE_SIZES[attrs.get('Page Size') ?? '']
  const width = optionalNumber(attrs.get('Width')) ?? page?.[0]
  const height = optionalNumber(attrs.get('Height')) ?? page?.[1]
  if (!width || !height) return t
  const blade = Math.max(0, optionalNumber(attrs.get('Blade Width')) ?? 0)
  outline(sink, t, rotatedCorners(0, 0, width, height, 0), 0, SCH_INK.body)
  if (blade > 0 && blade * 2 < Math.min(width, height))
    outline(sink, t, rotatedCorners(blade, blade, width - blade * 2, height - blade * 2, 0), 0, SCH_INK.body)
  const box = symbol.records.find((rec) => rec[0] === 'PART')?.[2] as { BBOX?: unknown } | undefined
  const bbox = Array.isArray(box?.BBOX) ? box.BBOX.map(optionalNumber) : []
  if (bbox.length < 4 || bbox.some((n) => n === null)) return t
  const [, y1, x2, y2] = bbox as number[]
  return { ...t, cx: t.cx + width - (x2 + Math.min(y1, y2)) }
}

function renderTableCell(
  rec: ProRecord,
  table: TableInfo | undefined,
  t: ComponentTransform,
  attrs: Map<string, string>,
  styles: Map<string, FontStyle>,
  sink: Sink,
): void {
  // ["TABEL_CELL", id, tableId, text, row, column, rowSpan, columnSpan, borders x4, fontStyle, ...]
  if (!table) return
  const row = numberAt(rec, 4)
  const col = numberAt(rec, 5)
  if (row < 0 || col < 0 || row >= table.rows.length || col >= table.cols.length || table.covered.has(`${row},${col}`))
    return
  const rowSpan = Math.min(MAX_SPAN, Math.max(1, numberAt(rec, 6, 1)))
  const colSpan = Math.min(MAX_SPAN, Math.max(1, numberAt(rec, 7, 1)))
  for (let r = row; r < row + rowSpan; r++) for (let c = col; c < col + colSpan; c++) table.covered.add(`${r},${c}`)
  const sum = (list: number[], from: number, to: number) => list.slice(from, to).reduce((a, b) => a + b, 0)
  const x = table.x + sum(table.cols, 0, col)
  const top = table.y - sum(table.rows, 0, row)
  const width = sum(table.cols, col, col + colSpan)
  const height = sum(table.rows, row, row + rowSpan)
  outline(sink, t, rotatedCorners(x, top, width, -height, 0), 0, SCH_INK.body)
  const raw = typeof rec[3] === 'string' ? rec[3] : ''
  const text = raw.startsWith('=')
    ? raw.slice(1).replace(/\{([^}]*)\}/g, (_, key: string) => attrs.get(key) ?? '')
    : raw
  if (!text) return
  const style = styles.get(String(rec[12]))
  const halign = style?.halign ?? 0
  const valign = style?.valign ?? 1
  const tx = halign === 1 ? x + width / 2 : halign === 2 ? x + width - 3 : x + 3
  const ty = valign === 0 ? top - 2 : valign === 2 ? top - height + 2 : top - height / 2
  schText(sink, t, tx, ty, 0, text, { size: style?.size ?? null, halign, valign })
}

function computeBounds(primitives: EasyEdaVisualPrimitive[]): EasyEdaVisualBounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const include = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }

  for (const p of primitives) {
    switch (p.kind) {
      case 'polyline':
        for (const pt of p.points) include(pt.x, pt.y)
        break
      case 'circle':
        include(p.cx - p.r, p.cy - p.r)
        include(p.cx + p.r, p.cy + p.r)
        break
      case 'rect':
        include(p.x, p.y)
        include(p.x + p.width, p.y + p.height)
        break
      case 'path':
        for (const pt of p.points ?? pathPoints(p.path)) include(pt.x, pt.y)
        break
      case 'text':
        includeText(p, include)
        break
    }
  }

  if (!Number.isFinite(minX)) return null
  const padding = Math.max(2, (maxX - minX) * 0.02)
  const minXP = minX - padding
  const minYP = minY - padding
  const maxXP = maxX + padding
  const maxYP = maxY + padding
  return {
    minX: minXP,
    minY: minYP,
    maxX: maxXP,
    maxY: maxYP,
    width: Math.max(1, maxXP - minXP),
    height: Math.max(1, maxYP - minYP),
  }
}
