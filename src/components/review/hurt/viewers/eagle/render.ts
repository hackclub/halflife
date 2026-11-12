import { BOARD_COLORS, UNKNOWN_LAYER_COLOR } from '../../ui/boardColors'
import { child, children, parseXml, path, type XNode } from './xml'

export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export interface LayerInfo {
  number: number
  name: string
  color: string
  visible: boolean
  side: 'top' | 'bottom' | 'both'
}

export interface EagleLayerSvg extends LayerInfo {
  body: string
  detail?: string
}

export interface EagleSheet {
  name: string
  group: string
  layers: EagleLayerSvg[]
  viewBox: [number, number, number, number]
  focus?: [number, number, number, number]
}

export interface EaglePart {
  name: string
  value: string
  device: string
  package: string
  library: string
}

export interface EagleRender {
  kind: 'board' | 'schematic' | 'library'
  version: string
  sheets: EagleSheet[]
  parts: EaglePart[]
  stats: string[]
  warnings: string[]
}

const BOARD_LAYERS: Record<number, [string, string, boolean, LayerInfo['side']]> = {
  1: ['Top', BOARD_COLORS['copper:top'], true, 'top'],
  16: ['Bottom', BOARD_COLORS['copper:bottom'], true, 'bottom'],
  17: ['Pads', '#c9a43a', true, 'both'],
  18: ['Vias', '#9fb0ad', true, 'both'],
  19: ['Unrouted', '#e6d36a', true, 'both'],
  20: ['Dimension', BOARD_COLORS.outline, true, 'both'],
  21: ['tPlace', BOARD_COLORS['silkscreen:top'], true, 'top'],
  22: ['bPlace', BOARD_COLORS['silkscreen:bottom'], true, 'bottom'],
  23: ['tOrigins', '#dddddd', false, 'top'],
  24: ['bOrigins', '#dddddd', false, 'bottom'],
  25: ['tNames', '#e6e6e6', true, 'top'],
  26: ['bNames', '#d6c6c0', true, 'bottom'],
  27: ['tValues', '#b8b8b8', true, 'top'],
  28: ['bValues', '#a89c98', true, 'bottom'],
  29: ['tStop', BOARD_COLORS['soldermask:top'], false, 'top'],
  30: ['bStop', BOARD_COLORS['soldermask:bottom'], false, 'bottom'],
  31: ['tCream', BOARD_COLORS['solderpaste:top'], false, 'top'],
  32: ['bCream', BOARD_COLORS['solderpaste:bottom'], false, 'bottom'],
  33: ['tFinish', '#888888', false, 'top'],
  34: ['bFinish', '#888888', false, 'bottom'],
  35: ['tGlue', '#888888', false, 'top'],
  36: ['bGlue', '#888888', false, 'bottom'],
  37: ['tTest', '#888888', false, 'top'],
  38: ['bTest', '#888888', false, 'bottom'],
  39: ['tKeepout', '#ff6b6b', false, 'top'],
  40: ['bKeepout', '#6b9bff', false, 'bottom'],
  41: ['tRestrict', '#ff6b6b', false, 'top'],
  42: ['bRestrict', '#6b9bff', false, 'bottom'],
  43: ['vRestrict', '#7bd88f', false, 'both'],
  44: ['Drills', BOARD_COLORS.drill, true, 'both'],
  45: ['Holes', BOARD_COLORS.drill, true, 'both'],
  46: ['Milling', BOARD_COLORS.outline, true, 'both'],
  47: ['Measures', '#9e9e9e', false, 'both'],
  48: ['Document', '#9e9e9e', false, 'both'],
  49: ['Reference', '#9e9e9e', false, 'both'],
  51: ['tDocu', '#8f9a98', false, 'top'],
  52: ['bDocu', '#7f8aa0', false, 'bottom'],
}

const SCHEMATIC_LAYERS: Record<number, [string, string, boolean]> = {
  91: ['Nets', '#6fd08c', true],
  92: ['Busses', '#5b8fd6', true],
  93: ['Pins', '#4caf6a', true],
  94: ['Symbols', '#d9665b', true],
  95: ['Names', '#d8d8d8', true],
  96: ['Values', '#b0b0b0', true],
  97: ['Info', '#9e9e9e', true],
  98: ['Guide', '#7a7a7a', true],
}

export const FLIP: Record<number, number> = {}
for (const [a, b] of [
  [1, 16],
  [21, 22],
  [23, 24],
  [25, 26],
  [27, 28],
  [29, 30],
  [31, 32],
  [33, 34],
  [35, 36],
  [37, 38],
  [39, 40],
  [41, 42],
  [51, 52],
]) {
  FLIP[a] = b
  FLIP[b] = a
}
for (let i = 2; i <= 15; i++) FLIP[i] = 17 - i

const BOARD_STACK = [
  ...[52, 48, 47, 49, 40, 42, 38, 36, 34, 32, 30, 28, 26, 24, 22, 16],
  ...[15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2],
  ...[1, 17, 18, 19, 43, 39, 41, 35, 37, 33, 31, 29, 21, 25, 27, 23, 51, 20, 46, 44, 45],
]
const SCHEMATIC_ORDER = [98, 97, 94, 92, 91, 93, 96, 95]

const DIMENSION = 20
export const HAIRLINE = 'H'
const HAIRLINE_ATTR = `stroke-width="${HAIRLINE}"`
const MAX_FRAME_COLUMNS = 127
const MAX_FRAME_ROWS = 26

const PIN_LENGTH: Record<string, number> = { point: 0, short: 2.54, middle: 5.08, long: 7.62 }

export const n = (value: number) => {
  const rounded = Math.round(value * 10000) / 10000
  return !Number.isFinite(rounded) || Math.abs(value) < 1e-9 ? '0' : String(rounded)
}
const MAX_SVG_CHARS = 120_000_000
const MAX_LIBRARY_SHEETS = 1500
const num = (node: XNode, key: string, fallback = 0) => {
  const v = Number(node.attrs[key])
  return Number.isFinite(v) ? v : fallback
}
const upper = (node: XNode) => (node.attrs.name ?? '').toUpperCase()
export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface Rot {
  angle: number
  mirror: boolean
  spin: boolean
}

function parseRot(value: string | undefined): Rot {
  if (!value) return { angle: 0, mirror: false, spin: false }
  const m = /^([SM]*)R(-?[\d.]+)$/.exec(value)
  if (!m) return { angle: 0, mirror: false, spin: false }
  return { angle: ((Number(m[2]) % 360) + 360) % 360, mirror: m[1].includes('M'), spin: m[1].includes('S') }
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

export function placement(x: number, y: number, rot: Rot): Matrix {
  const r = (rot.angle * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const m = rot.mirror ? -1 : 1
  return [c * m, s * m, -s, c, x, y]
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export function isMirrored(m: Matrix) {
  return m[0] * m[3] - m[1] * m[2] < 0
}

function angleOf(m: Matrix) {
  const mirrored = isMirrored(m)
  const a = (Math.atan2(m[1], mirrored ? -m[0] : m[0]) * 180) / Math.PI
  return ((a % 360) + 360) % 360
}

export class Bounds {
  minX = Infinity
  minY = Infinity
  maxX = -Infinity
  maxY = -Infinity
  add(x: number, y: number, pad = 0) {
    if (![x - pad, y - pad, x + pad, y + pad].every(Number.isFinite)) return
    this.minX = Math.min(this.minX, x - pad)
    this.minY = Math.min(this.minY, y - pad)
    this.maxX = Math.max(this.maxX, x + pad)
    this.maxY = Math.max(this.maxY, y + pad)
  }
  get empty() {
    return !(this.maxX >= this.minX)
  }
}

export function arcPath(x1: number, y1: number, x2: number, y2: number, curve: number) {
  if (!curve) return `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`
  const chord = Math.hypot(x2 - x1, y2 - y1)
  const half = (Math.abs(curve) * Math.PI) / 360
  const r = chord / (2 * Math.sin(half))
  return `M${n(x1)} ${n(y1)}A${n(r)} ${n(r)} 0 ${Math.abs(curve) > 180 ? 1 : 0} ${curve > 0 ? 1 : 0} ${n(x2)} ${n(y2)}`
}

export function arcSamples(x1: number, y1: number, x2: number, y2: number, curve: number) {
  if (!curve) return [[x2, y2]]
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const chord = Math.hypot(x2 - x1, y2 - y1)
  const t = (curve * Math.PI) / 180
  const d = chord / 2 / Math.tan(t / 2)
  const nx = -(y2 - y1) / chord
  const ny = (x2 - x1) / chord
  const cx = mx + nx * d
  const cy = my + ny * d
  const start = Math.atan2(y1 - cy, x1 - cx)
  const r = Math.hypot(x1 - cx, y1 - cy)
  const out: number[][] = []
  for (let i = 1; i <= 8; i++) {
    const a = start + (t * i) / 8
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

type Emit = (layer: number, svg: string) => void

export interface Ctx {
  emit: Emit
  bounds: Bounds
  outline: Bounds
  resolve: (text: string, layer: number) => string | null
  mapLayer: (layer: number) => number
  restring: { pad: [number, number, number]; via: [number, number, number] }
  pinPads?: Map<string, string>
  readable?: boolean
  vias: number
  budget: { chars: number; truncated: boolean }
}

function track(ctx: Ctx, m: Matrix, x: number, y: number, pad: number, layer: number) {
  const [ax, ay] = apply(m, x, y)
  ctx.bounds.add(ax, ay, pad)
  if (layer === DIMENSION) ctx.outline.add(ax, ay, 0)
}

function wire(ctx: Ctx, node: XNode, m: Matrix) {
  const layer = ctx.mapLayer(num(node, 'layer'))
  const w = Math.max(num(node, 'width'), 0)
  const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => num(node, k))
  const curve = num(node, 'curve')
  const cap = node.attrs.cap === 'flat' ? 'butt' : 'round'
  const dash = layer === 19 ? ' stroke-dasharray="0.5 0.5"' : ''
  const width = layer === 19 ? n(0.08) : w > 0 ? n(Math.max(w, 0.02)) : HAIRLINE
  ctx.emit(
    layer,
    `<path d="${arcPath(...(apply(m, x1, y1) as [number, number]), ...(apply(m, x2, y2) as [number, number]), isMirrored(m) ? -curve : curve)}" fill="none" stroke-width="${width}" stroke-linecap="${cap}"${dash}/>`,
  )
  track(ctx, m, x1, y1, w / 2, layer)
  for (const [x, y] of arcSamples(x1, y1, x2, y2, curve)) track(ctx, m, x, y, w / 2, layer)
}

function circle(ctx: Ctx, node: XNode, m: Matrix) {
  const layer = ctx.mapLayer(num(node, 'layer'))
  const w = num(node, 'width')
  const r = num(node, 'radius')
  const [x, y] = apply(m, num(node, 'x'), num(node, 'y'))
  ctx.emit(
    layer,
    w > 0
      ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="none" stroke-width="${n(w)}"/>`
      : `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" stroke="none"/>`,
  )
  ctx.bounds.add(x, y, r + w / 2)
  if (layer === DIMENSION) ctx.outline.add(x, y, r)
}

function rectangle(ctx: Ctx, node: XNode, m: Matrix) {
  const layer = ctx.mapLayer(num(node, 'layer'))
  const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => num(node, k))
  const rot = parseRot(node.attrs.rot)
  const local = multiply(m, placement((x1 + x2) / 2, (y1 + y2) / 2, rot))
  const hw = Math.abs(x2 - x1) / 2
  const hh = Math.abs(y2 - y1) / 2
  const pts = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => apply(local, x, y))
  ctx.emit(layer, `<polygon points="${pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" stroke="none"/>`)
  for (const [x, y] of pts) {
    ctx.bounds.add(x, y)
    if (layer === DIMENSION) ctx.outline.add(x, y)
  }
}

function polygon(ctx: Ctx, node: XNode, m: Matrix, pour: boolean) {
  const layer = ctx.mapLayer(num(node, 'layer'))
  const w = num(node, 'width')
  const vertices = children(node, 'vertex')
  if (vertices.length < 2) return
  const mirrored = isMirrored(m)
  let d = ''
  vertices.forEach((v, i) => {
    const next = vertices[(i + 1) % vertices.length]
    const [x1, y1] = apply(m, num(v, 'x'), num(v, 'y'))
    const [x2, y2] = apply(m, num(next, 'x'), num(next, 'y'))
    const curve = num(v, 'curve') * (mirrored ? -1 : 1)
    const seg = arcPath(x1, y1, x2, y2, curve)
    d += i === 0 ? seg : seg.replace(/^M[^LA]*/, '')
    ctx.bounds.add(x1, y1, w / 2)
    if (layer === DIMENSION) ctx.outline.add(x1, y1)
  })
  d += 'Z'
  ctx.emit(
    layer,
    pour
      ? `<path d="${d}" fill-opacity="0.16" stroke-width="${n(Math.max(w, 0.05))}" stroke-dasharray="${n(Math.max(w, 0.2) * 3)} ${n(Math.max(w, 0.2) * 2)}" stroke-linejoin="round"/>`
      : `<path d="${d}" stroke-width="${n(w)}" stroke-linejoin="round"/>`,
  )
}

function shapePath(shape: string, w: number, h: number, offset = 0) {
  if (shape === 'square') return { kind: 'rect' as const, x: -w / 2 + offset, y: -h / 2, w, h, r: 0 }
  if (shape === 'long' || shape === 'offset')
    return { kind: 'rect' as const, x: -w / 2 + offset, y: -h / 2, w, h, r: h / 2 }
  if (shape === 'octagon') return { kind: 'octagon' as const, x: 0, y: 0, w, h, r: 0 }
  return { kind: 'circle' as const, x: 0, y: 0, w, h, r: w / 2 }
}

function shapeSvg(shape: ReturnType<typeof shapePath>, m: Matrix, extra = '') {
  const t = `transform="matrix(${m.map(n).join(' ')})"`
  if (shape.kind === 'circle') return `<circle cx="0" cy="0" r="${n(shape.r)}" ${t} stroke="none"${extra}/>`
  if (shape.kind === 'octagon') {
    const r = shape.w / 2 / Math.cos(Math.PI / 8)
    const pts = Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI / 8 + (i * Math.PI) / 4
      return `${n(r * Math.cos(a))},${n(r * Math.sin(a))}`
    })
    return `<polygon points="${pts.join(' ')}" ${t} stroke="none"${extra}/>`
  }
  return `<rect x="${n(shape.x)}" y="${n(shape.y)}" width="${n(shape.w)}" height="${n(shape.h)}" rx="${n(shape.r)}" ${t} stroke="none"${extra}/>`
}

export function restring(drill: number, [ratio, min, max]: [number, number, number]) {
  return drill + 2 * Math.min(max, Math.max(min, drill * ratio))
}

function pad(ctx: Ctx, node: XNode, m: Matrix) {
  const drill = num(node, 'drill')
  const d = Math.max(num(node, 'diameter'), restring(drill, ctx.restring.pad))
  const shape = node.attrs.shape ?? 'round'
  const elongation = num(node, 'elongation', 100) / 100
  const long = shape === 'long' || shape === 'offset'
  const w = long ? d * (1 + elongation) : d
  const offset = shape === 'offset' ? (d * elongation) / 2 : 0
  const local = multiply(m, placement(num(node, 'x'), num(node, 'y'), parseRot(node.attrs.rot)))
  ctx.emit(17, shapeSvg(shapePath(shape, w, d, offset), local))
  ctx.emit(44, `<circle cx="${n(local[4])}" cy="${n(local[5])}" r="${n(drill / 2)}" stroke="none"/>`)
  ctx.bounds.add(local[4], local[5], w / 2 + Math.abs(offset))
}

function smd(ctx: Ctx, node: XNode, m: Matrix) {
  const layer = ctx.mapLayer(num(node, 'layer', 1))
  const dx = num(node, 'dx')
  const dy = num(node, 'dy')
  const r = (num(node, 'roundness') / 100) * (Math.min(dx, dy) / 2)
  const local = multiply(m, placement(num(node, 'x'), num(node, 'y'), parseRot(node.attrs.rot)))
  ctx.emit(
    layer,
    `<rect x="${n(-dx / 2)}" y="${n(-dy / 2)}" width="${n(dx)}" height="${n(dy)}" rx="${n(r)}" transform="matrix(${local.map(n).join(' ')})" stroke="none"/>`,
  )
  ctx.bounds.add(local[4], local[5], Math.max(dx, dy) / 2)
}

function hole(ctx: Ctx, node: XNode, m: Matrix) {
  const [x, y] = apply(m, num(node, 'x'), num(node, 'y'))
  const r = num(node, 'drill') / 2
  ctx.emit(45, `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="none" stroke-width="0.1"/>`)
  ctx.emit(44, `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" stroke="none"/>`)
  ctx.bounds.add(x, y, r)
}

function via(ctx: Ctx, node: XNode) {
  const drill = num(node, 'drill')
  const d = Math.max(num(node, 'diameter'), restring(drill, ctx.restring.via))
  const shape = node.attrs.shape ?? 'round'
  const local = placement(num(node, 'x'), num(node, 'y'), { angle: 0, mirror: false, spin: false })
  ctx.emit(18, shapeSvg(shapePath(shape, d, d), local))
  ctx.emit(44, `<circle cx="${n(local[4])}" cy="${n(local[5])}" r="${n(drill / 2)}" stroke="none"/>`)
  ctx.bounds.add(local[4], local[5], d / 2)
  ctx.vias++
}

function overbars(line: string) {
  const runs: [string, boolean][] = []
  let run = ''
  let over = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '\\' && line[i + 1] === '!') {
      run += '!'
      i++
    } else if (c === '!') {
      if (run) runs.push([run, over])
      run = ''
      over = !over
    } else run += c
  }
  if (run) runs.push([run, over])
  return runs
}

const ALIGN: Record<string, [number, number]> = {
  'bottom-left': [0, 0],
  'bottom-center': [1, 0],
  'bottom-right': [2, 0],
  'center-left': [0, 1],
  center: [1, 1],
  'center-right': [2, 1],
  'top-left': [0, 2],
  'top-center': [1, 2],
  'top-right': [2, 2],
}

export function drawText(
  ctx: Ctx,
  layer: number,
  text: string,
  x: number,
  y: number,
  size: number,
  rot: Rot,
  m: Matrix,
  align = 'bottom-left',
  distance = 50,
) {
  if (!text) return
  const [ax, ay] = apply(m, x, y)
  const em = isMirrored(m)
  const ea = angleOf(m)
  let angle = (((ea + (em ? -rot.angle : rot.angle)) % 360) + 360) % 360
  let mirror = em !== rot.mirror
  let [h, v] = ALIGN[align] ?? [0, 0]
  if (mirror && ctx.readable) {
    mirror = false
    h = 2 - h
  }
  if (!rot.spin && angle > 90 && angle <= 270) {
    angle = (angle + 180) % 360
    h = 2 - h
    v = 2 - v
  }
  const lines = text.split('\n')
  const pitch = size * (1 + distance / 100)
  const anchor = ['start', 'middle', 'end'][h]
  const firstShift = v === 0 ? -(lines.length - 1) * pitch : v === 1 ? (-(lines.length - 1) * pitch) / 2 : 0
  const baseline = ['auto', 'central', 'hanging'][v]
  const parsed = lines.map(overbars)
  const body = parsed
    .map(
      (runs, i) =>
        `<tspan x="0" y="${n(firstShift + i * pitch)}">${runs.map(([run, over]) => (over ? `<tspan text-decoration="overline">${esc(run)}</tspan>` : esc(run))).join('')}</tspan>`,
    )
    .join('')
  ctx.emit(
    layer,
    `<text transform="translate(${n(ax)} ${n(ay)}) rotate(${n(angle)}) scale(${mirror ? -1 : 1} -1)" font-size="${n(size * 1.2)}" text-anchor="${anchor}" dominant-baseline="${baseline}" stroke="none">${body}</text>`,
  )
  const width =
    parsed.reduce(
      (longest, runs) =>
        Math.max(
          longest,
          runs.reduce((sum, [run]) => sum + run.length, 0),
        ),
      0,
    ) *
    size *
    0.75
  const height = (lines.length - 1) * pitch + size
  const left = -h * (width / 2)
  const bottom = v === 0 ? 0 : v === 1 ? -height / 2 : -height
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  for (const [dx, dy] of [
    [left, bottom],
    [left + width, bottom],
    [left, bottom + height],
    [left + width, bottom + height],
  ]) {
    const x = mirror ? -dx : dx
    ctx.bounds.add(ax + x * cos - dy * sin, ay + x * sin + dy * cos)
  }
}

function text(ctx: Ctx, node: XNode, m: Matrix, skip?: Set<string>) {
  const raw = node.text.trim()
  const layer = ctx.mapLayer(num(node, 'layer'))
  const key = raw.startsWith('>') ? raw.slice(1).toUpperCase() : null
  if (key && skip?.has(key)) return
  const value = ctx.resolve(raw, layer)
  if (value === null) return
  drawText(
    ctx,
    layer,
    value,
    num(node, 'x'),
    num(node, 'y'),
    num(node, 'size', 1.778),
    parseRot(node.attrs.rot),
    m,
    node.attrs.align,
    num(node, 'distance', 50),
  )
}

function frame(ctx: Ctx, node: XNode, m: Matrix) {
  const layer = ctx.mapLayer(num(node, 'layer'))
  const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => num(node, k))
  const columns = Math.min(MAX_FRAME_COLUMNS, Math.max(1, Math.floor(Math.abs(num(node, 'columns', 1)))))
  const rows = Math.min(MAX_FRAME_ROWS, Math.max(1, Math.floor(Math.abs(num(node, 'rows', 1)))))
  const [ax1, ay1] = apply(m, Math.min(x1, x2), Math.min(y1, y2))
  const [ax2, ay2] = apply(m, Math.max(x1, x2), Math.max(y1, y2))
  const lx = Math.min(ax1, ax2)
  const ly = Math.min(ay1, ay2)
  const hx = Math.max(ax1, ax2)
  const hy = Math.max(ay1, ay2)
  const on = (side: string) => node.attrs[`border-${side}`] !== 'no'
  const inset = Math.min(4, (hx - lx) / 4, (hy - ly) / 4)
  const left = on('left') ? lx + inset : lx
  const right = on('right') ? hx - inset : hx
  const bottom = on('bottom') ? ly + inset : ly
  const top = on('top') ? hy - inset : hy
  let d = `M${n(lx)} ${n(ly)}H${n(hx)}V${n(hy)}H${n(lx)}Z`
  if (on('left')) d += `M${n(left)} ${n(bottom)}V${n(top)}`
  if (on('right')) d += `M${n(right)} ${n(bottom)}V${n(top)}`
  if (on('bottom')) d += `M${n(left)} ${n(bottom)}H${n(right)}`
  if (on('top')) d += `M${n(left)} ${n(top)}H${n(right)}`
  for (let i = 1; i < columns; i++) {
    const x = lx + ((hx - lx) * i) / columns
    if (on('bottom')) d += `M${n(x)} ${n(ly)}V${n(bottom)}`
    if (on('top')) d += `M${n(x)} ${n(top)}V${n(hy)}`
  }
  for (let i = 1; i < rows; i++) {
    const y = ly + ((hy - ly) * i) / rows
    if (on('left')) d += `M${n(lx)} ${n(y)}H${n(left)}`
    if (on('right')) d += `M${n(right)} ${n(y)}H${n(hx)}`
  }
  ctx.emit(layer, `<path d="${d}" fill="none" stroke-width="0.254"/>`)
  const label = (value: string, x: number, y: number) =>
    drawText(ctx, layer, value, x, y, inset * 0.5, parseRot(undefined), IDENTITY, 'center')
  const leftToRight = num(node, 'columns', 1) >= 0
  const topToBottom = num(node, 'rows', 1) >= 0
  for (let i = 0; i < columns; i++) {
    const x = lx + ((hx - lx) * (i + 0.5)) / columns
    const value = String(leftToRight ? i + 1 : columns - i)
    if (on('bottom')) label(value, x, (ly + bottom) / 2)
    if (on('top')) label(value, x, (top + hy) / 2)
  }
  for (let i = 0; i < rows; i++) {
    const y = hy - ((hy - ly) * (i + 0.5)) / rows
    const value = String.fromCharCode(65 + (topToBottom ? i : rows - 1 - i))
    if (on('left')) label(value, (lx + left) / 2, y)
    if (on('right')) label(value, (right + hx) / 2, y)
  }
  ctx.bounds.add(lx, ly)
  ctx.bounds.add(hx, hy)
}

function primitives(ctx: Ctx, nodes: XNode[], m: Matrix, skip?: Set<string>) {
  for (const node of nodes) {
    if (ctx.budget.truncated) return
    switch (node.name) {
      case 'wire':
        wire(ctx, node, m)
        break
      case 'circle':
        circle(ctx, node, m)
        break
      case 'rectangle':
        rectangle(ctx, node, m)
        break
      case 'polygon':
        polygon(ctx, node, m, false)
        break
      case 'text':
        text(ctx, node, m, skip)
        break
      case 'pad':
        pad(ctx, node, m)
        break
      case 'smd':
        smd(ctx, node, m)
        break
      case 'hole':
        hole(ctx, node, m)
        break
      case 'frame':
        frame(ctx, node, m)
        break
      case 'pin':
        pin(ctx, node, m)
        break
    }
  }
}

function displayPinName(name: string) {
  return name.replace(/@.*$/, '')
}

function pin(ctx: Ctx, node: XNode, m: Matrix) {
  const length = PIN_LENGTH[node.attrs.length ?? 'long'] ?? 7.62
  const rot = parseRot(node.attrs.rot)
  const local = multiply(m, placement(num(node, 'x'), num(node, 'y'), { ...rot, mirror: false }))
  const fn = node.attrs.function ?? 'none'
  const dot = fn === 'dot' || fn === 'dotclk'
  const clk = fn === 'clk' || fn === 'dotclk'
  const lineEnd = dot ? length - 0.762 : length
  const t = `transform="matrix(${local.map(n).join(' ')})"`
  let svg = ''
  if (length > 0) svg += `<path d="M0 0H${n(lineEnd)}" fill="none" stroke-width="0.1524" ${t}/>`
  if (dot) svg += `<circle cx="${n(length - 0.381)}" cy="0" r="0.381" fill="none" stroke-width="0.1524" ${t}/>`
  if (clk)
    svg += `<path d="M${n(length)} 0.6L${n(length + 1.2)} 0L${n(length)} -0.6" fill="none" stroke-width="0.1524" ${t}/>`
  ctx.emit(94, svg)
  ctx.bounds.add(local[4], local[5])
  const [ex, ey] = apply(local, length, 0)
  ctx.bounds.add(ex, ey)
  const visible = node.attrs.visible ?? 'both'
  const name = node.attrs.name ?? ''
  const inner = { angle: 0, mirror: false, spin: false }
  if (visible === 'both' || visible === 'pin') {
    drawText(ctx, 95, displayPinName(name), length + (clk ? 1.8 : 0.762), 0, 1.778, inner, local, 'center-left')
  }
  const padName = ctx.pinPads?.get(name)
  if (padName && (visible === 'both' || visible === 'pad') && length > 0) {
    drawText(ctx, 93, padName, 1.524, 0.4, 1.27, inner, local, 'bottom-left')
  }
}

function designParams(board: XNode | undefined) {
  const params = new Map<string, string>()
  for (const p of children(child(board, 'designrules'), 'param')) params.set(p.attrs.name, p.attrs.value)
  return params
}

const isCopper = (layer: number) => layer >= 1 && layer <= 16

function copperLayers(params: Map<string, string>, buckets: Map<number, string[]>) {
  const setup = (params.get('layerSetup')?.match(/\d+/g) ?? []).map(Number).filter(isCopper)
  if (setup.length > 0) return new Set(setup).size
  const used = new Set([...buckets.keys()].filter(isCopper))
  if (buckets.has(17) || buckets.has(18)) used.add(1).add(16)
  return used.size
}

function designRules(params: Map<string, string>) {
  const length = (key: string, fallback: number) => {
    const raw = params.get(key)?.split(/\s+/)[0]
    const m = raw ? /^(-?[\d.]+)(mil|mm|in|mic)?$/.exec(raw) : null
    if (!m) return fallback
    const v = Number(m[1])
    return m[2] === 'mil' ? v * 0.0254 : m[2] === 'in' ? v * 25.4 : m[2] === 'mic' ? v / 1000 : v
  }
  const ratio = (key: string, fallback: number) => {
    const v = Number(params.get(key)?.split(/\s+/)[0])
    return Number.isFinite(v) ? v : fallback
  }
  return {
    pad: [ratio('rvPadTop', 0.25), length('rlMinPadTop', 0.254), length('rlMaxPadTop', 0.508)] as [
      number,
      number,
      number,
    ],
    via: [ratio('rvViaOuter', 0.25), length('rlMinViaOuter', 0.2032), length('rlMaxViaOuter', 0.508)] as [
      number,
      number,
      number,
    ],
  }
}

const indexes = new WeakMap<XNode, Map<string, Map<string, XNode>>>()

function named(parent: XNode | undefined, tag: string, name: string | undefined) {
  if (!parent || name === undefined) return undefined
  let byTag = indexes.get(parent)
  if (!byTag) indexes.set(parent, (byTag = new Map()))
  let index = byTag.get(tag)
  if (!index) {
    index = new Map()
    for (const c of parent.children) if (c.name === tag && !index.has(c.attrs.name)) index.set(c.attrs.name, c)
    byTag.set(tag, index)
  }
  return index.get(name)
}

function libraryKey(name: string | undefined, urn: string | undefined) {
  return `${name ?? ''}\u0000${urn ?? ''}`
}

function indexLibraries(libraries: XNode | undefined) {
  const byKey = new Map<string, XNode>()
  const byName = new Map<string, XNode>()
  for (const lib of children(libraries, 'library')) {
    byKey.set(libraryKey(lib.attrs.name, lib.attrs.urn), lib)
    if (!byName.has(lib.attrs.name)) byName.set(lib.attrs.name, lib)
  }
  return (name: string | undefined, urn: string | undefined) =>
    byKey.get(libraryKey(name, urn)) ?? byName.get(name ?? '')
}

export interface FileLayer {
  name?: string
  visible?: boolean
}

function layerTable(drawing: XNode | undefined) {
  const table = new Map<number, FileLayer>()
  for (const l of children(child(drawing, 'layers'), 'layer')) {
    const visible = l.attrs.visible === 'yes' ? true : l.attrs.visible === 'no' ? false : undefined
    table.set(Number(l.attrs.number), { name: l.attrs.name, visible })
  }
  return table
}

const BOARD_CORE = new Set([17, 18, DIMENSION, 21, 22, 44, 45])
const isBoardCore = (layer: number) => isCopper(layer) || BOARD_CORE.has(layer)
const isDesignAid = (layer: number) => layer >= 29 && layer <= 43

function collectLayers(
  buckets: Map<number, string[]>,
  table: Map<number, FileLayer>,
  schematic: boolean,
  view: [number, number, number, number],
): EagleLayerSvg[] {
  const order = schematic ? SCHEMATIC_ORDER : BOARD_STACK
  const known: Record<number, [string, string, boolean, LayerInfo['side']?]> = schematic
    ? SCHEMATIC_LAYERS
    : BOARD_LAYERS
  const hairline = `stroke-width="${n(Math.max(0.2, Math.max(view[2], view[3]) / 700))}"`
  const ordered = [...buckets.keys()].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? 1000 + a : ia) - (ib < 0 ? 1000 + b : ib)
  })
  return ordered.map((number) => {
    const info =
      known[number] ??
      (number >= 2 && number <= 15 ? ['Inner ' + number, BOARD_COLORS['copper:inner'], true, 'both'] : null)
    const color = info?.[1] ?? UNKNOWN_LAYER_COLOR
    const file = table.get(number)
    const fallback = info?.[2] ?? number >= 100
    const visible = isBoardCore(number) || (!isDesignAid(number) && (file?.visible ?? fallback))
    const body = buckets.get(number)!.join('')
    return {
      number,
      name: file?.name ?? info?.[0] ?? `Layer ${number}`,
      color,
      visible,
      side: (info?.[3] as LayerInfo['side']) ?? 'both',
      body: body.includes(HAIRLINE_ATTR) ? body.replaceAll(HAIRLINE_ATTR, hairline) : body,
    }
  })
}

export function makeSheet(
  name: string,
  group: string,
  buckets: Map<number, string[]>,
  table: Map<number, FileLayer>,
  schematic: boolean,
  fit: Bounds,
  margin: number,
  focus?: Bounds,
): EagleSheet {
  const box = viewBox(fit, margin)
  const sheet: EagleSheet = { name, group, layers: collectLayers(buckets, table, schematic, box), viewBox: box }
  if (focus && !focus.empty) sheet.focus = viewBox(focus, margin)
  return sheet
}

export function around(outline: Bounds, bounds: Bounds) {
  const reach = Math.max(outline.maxX - outline.minX, outline.maxY - outline.minY)
  const out = new Bounds()
  out.add(Math.max(bounds.minX, outline.minX - reach), Math.max(bounds.minY, outline.minY - reach))
  out.add(Math.min(bounds.maxX, outline.maxX + reach), Math.min(bounds.maxY, outline.maxY + reach))
  out.add(outline.minX, outline.minY)
  out.add(outline.maxX, outline.maxY)
  return out
}

function viewBox(bounds: Bounds, margin: number): [number, number, number, number] {
  if (bounds.empty) return [0, 0, 1, 1]
  return [
    bounds.minX - margin,
    -(bounds.maxY + margin),
    bounds.maxX - bounds.minX + 2 * margin,
    bounds.maxY - bounds.minY + 2 * margin,
  ]
}

export const sharedBudget = () => ({ chars: MAX_SVG_CHARS, truncated: false })

export function newCtx(
  resolve: Ctx['resolve'],
  budget: Ctx['budget'],
  restringRules?: Ctx['restring'],
): Ctx & { buckets: Map<number, string[]> } {
  const buckets = new Map<number, string[]>()
  return {
    buckets,
    budget,
    emit: (layer, svg) => {
      budget.chars -= svg.length
      if (budget.chars < 0) {
        budget.truncated = true
        return
      }
      let list = buckets.get(layer)
      if (!list) buckets.set(layer, (list = []))
      list.push(svg)
    },
    bounds: new Bounds(),
    outline: new Bounds(),
    resolve,
    mapLayer: (l) => l,
    restring: restringRules ?? { pad: [0.25, 0.254, 0.508], via: [0.25, 0.2032, 0.508] },
    vias: 0,
  }
}

export function truncation(budget: Ctx['budget'], warnings: string[]) {
  if (budget.truncated) warnings.push('This drawing is too large to show in full, so some of it was left out.')
}

function renderBoard(root: XNode, version: string): EagleRender {
  const drawing = path(root, 'eagle', 'drawing')
  const board = child(drawing, 'board')
  const names = layerTable(drawing)
  const warnings: string[] = []
  const lookup = indexLibraries(child(board, 'libraries'))
  let resolve: Ctx['resolve'] = (t) => t
  const budget = sharedBudget()
  const params = designParams(board)
  const ctx = newCtx((t, l) => resolve(t, l), budget, designRules(params))
  const parts: EaglePart[] = []

  primitives(ctx, child(board, 'plain')?.children ?? [], IDENTITY)

  const elements = children(child(board, 'elements'), 'element')
  let missing = 0
  for (const el of elements) {
    const lib = lookup(el.attrs.library, el.attrs.library_urn)
    const pkg = named(child(lib, 'packages'), 'package', el.attrs.package)
    parts.push({
      name: el.attrs.name ?? '',
      value: el.attrs.value ?? '',
      device: '',
      package: el.attrs.package ?? '',
      library: el.attrs.library ?? '',
    })
    const rot = parseRot(el.attrs.rot)
    const m = placement(num(el, 'x'), num(el, 'y'), rot)
    const attributes = children(el, 'attribute')
    const placed = new Set(attributes.filter((a) => a.attrs.x !== undefined).map((a) => upper(a)))
    const smashed = el.attrs.smashed === 'yes'
    const skip = smashed ? new Set(['NAME', 'VALUE', ...placed]) : placed
    const values: Record<string, string> = { NAME: el.attrs.name ?? '', VALUE: el.attrs.value ?? '' }
    for (const a of attributes) if (a.attrs.value !== undefined) values[upper(a)] = a.attrs.value
    resolve = (t) => (t.startsWith('>') ? (values[t.slice(1).toUpperCase()] ?? '') : t)
    if (!pkg) {
      missing++
    } else {
      ctx.mapLayer = rot.mirror ? (l) => FLIP[l] ?? l : (l) => l
      primitives(ctx, pkg.children, m, skip)
      ctx.mapLayer = (l) => l
    }
    for (const a of attributes) {
      if (a.attrs.x === undefined || a.attrs.display === 'off') continue
      const key = upper(a)
      const value = values[key] ?? ''
      const shown = a.attrs.display === 'name' ? key : a.attrs.display === 'both' ? `${key}=${value}` : value
      drawText(
        ctx,
        num(a, 'layer'),
        shown,
        num(a, 'x'),
        num(a, 'y'),
        num(a, 'size', 1.778),
        parseRot(a.attrs.rot),
        IDENTITY,
        a.attrs.align,
      )
    }
    resolve = (t) => t
  }
  if (missing)
    warnings.push(
      `${plural(missing, 'part uses a package', 'parts use packages')} missing from the embedded libraries.`,
    )

  let wires = 0
  let pours = 0
  const signals = children(child(board, 'signals'), 'signal')
  for (const signal of signals) {
    for (const node of signal.children) {
      if (node.name === 'wire') {
        wire(ctx, node, IDENTITY)
        if (num(node, 'layer') !== 19) wires++
      } else if (node.name === 'via') via(ctx, node)
      else if (node.name === 'polygon') {
        polygon(ctx, node, IDENTITY, true)
        pours++
      }
    }
  }

  const fit = ctx.outline.empty ? ctx.bounds : around(ctx.outline, ctx.bounds)
  const copper = copperLayers(params, ctx.buckets)
  const stats = [
    !ctx.outline.empty
      ? `${(ctx.outline.maxX - ctx.outline.minX).toFixed(1)} × ${(ctx.outline.maxY - ctx.outline.minY).toFixed(1)} mm`
      : 'no board outline',
    `${copper} copper ${copper === 1 ? 'layer' : 'layers'}`,
    plural(elements.length, 'part'),
    plural(signals.length, 'net'),
    plural(wires, 'track segment'),
    plural(ctx.vias, 'via'),
  ]
  if (pours) {
    warnings.push(
      `${pours} copper ${pours === 1 ? 'pour is' : 'pours are'} drawn as a tinted outline. Eagle doesn't save poured copper; it fills it again when you run Ratsnest.`,
    )
  }
  truncation(budget, warnings)
  return {
    kind: 'board',
    version,
    parts,
    sheets: [makeSheet('Board', 'Board', ctx.buckets, names, false, fit, 2, ctx.outline)],
    stats,
    warnings,
  }
}

function deviceName(part: XNode, deviceset = part.attrs.deviceset ?? '') {
  const name = deviceset.includes('*') ? deviceset.replace('*', part.attrs.technology ?? '') : deviceset
  const device = part.attrs.device ?? ''
  return name.includes('?') ? name.replace('?', device) : name + device
}

function deviceValue(part: XNode, deviceset: XNode | undefined) {
  return part.attrs.value ?? deviceName(part, deviceset?.attrs.name)
}

function renderSchematic(root: XNode, version: string): EagleRender {
  const drawing = path(root, 'eagle', 'drawing')
  const schematic = child(drawing, 'schematic')
  const names = layerTable(drawing)
  const lookup = indexLibraries(child(schematic, 'libraries'))
  const partNodes = new Map<string, XNode>()
  for (const p of children(child(schematic, 'parts'), 'part')) partNodes.set(p.attrs.name, p)
  const warnings: string[] = []
  const sheetNodes = children(child(schematic, 'sheets'), 'sheet')
  const sheets: EagleSheet[] = []
  let missing = 0
  let instancesTotal = 0
  const budget = sharedBudget()

  sheetNodes.forEach((sheet, index) => {
    let resolve: Ctx['resolve'] = (t) => t
    const ctx = newCtx((t, l) => resolve(t, l), budget)
    ctx.readable = true
    const sheetValues: Record<string, string> = {
      SHEET: `${index + 1}/${sheetNodes.length}`,
      SHEETNR: String(index + 1),
      SHEETS: String(sheetNodes.length),
      SHEET_TOTAL: String(sheetNodes.length),
      SHEETNR_TOTAL: String(sheetNodes.length),
      DRAWING_NAME: '',
      LAST_DATE_TIME: '',
      PLOT_DATE_TIME: '',
    }
    resolve = (t) => (t.startsWith('>') ? (sheetValues[t.slice(1).toUpperCase()] ?? t) : t)
    primitives(ctx, child(sheet, 'plain')?.children ?? [], IDENTITY)

    for (const inst of children(child(sheet, 'instances'), 'instance')) {
      instancesTotal++
      const part = partNodes.get(inst.attrs.part)
      const lib = lookup(part?.attrs.library, part?.attrs.library_urn)
      const deviceset = named(child(lib, 'devicesets'), 'deviceset', part?.attrs.deviceset)
      const gates = children(child(deviceset, 'gates'), 'gate')
      const gate = named(child(deviceset, 'gates'), 'gate', inst.attrs.gate)
      const symbol = named(child(lib, 'symbols'), 'symbol', gate?.attrs.symbol)
      if (!part || !symbol) {
        missing++
        continue
      }
      const device = named(child(deviceset, 'devices'), 'device', part.attrs.device ?? '')
      const pinPads = new Map<string, string>()
      for (const c of children(child(device, 'connects'), 'connect')) {
        if (c.attrs.gate === inst.attrs.gate) pinPads.set(c.attrs.pin, (c.attrs.pad ?? '').split(/\s+/).join(','))
      }
      const values: Record<string, string> = {
        ...sheetValues,
        NAME: part.attrs.name + (gates.length > 1 ? inst.attrs.gate : ''),
        PART: part.attrs.name,
        GATE: inst.attrs.gate ?? '',
        VALUE: deviceValue(part, deviceset),
      }
      for (const a of children(part, 'attribute')) values[upper(a)] = a.attrs.value ?? ''
      const tech = children(child(device, 'technologies'), 'technology').find(
        (t) => t.attrs.name === (part.attrs.technology ?? ''),
      )
      for (const a of children(tech, 'attribute')) values[upper(a)] ??= a.attrs.value ?? ''
      const attributes = children(inst, 'attribute')
      const placed = new Set(attributes.filter((a) => a.attrs.x !== undefined).map((a) => upper(a)))
      const skip = inst.attrs.smashed === 'yes' ? new Set(['NAME', 'VALUE', 'PART', 'GATE', ...placed]) : placed
      resolve = (t) => (t.startsWith('>') ? (values[t.slice(1).toUpperCase()] ?? '') : t)
      ctx.pinPads = device?.attrs.package ? pinPads : undefined
      primitives(ctx, symbol.children, placement(num(inst, 'x'), num(inst, 'y'), parseRot(inst.attrs.rot)), skip)
      ctx.pinPads = undefined
      for (const a of attributes) {
        if (a.attrs.x === undefined || a.attrs.display === 'off') continue
        const key = upper(a)
        const value = values[key] ?? a.attrs.value ?? ''
        const shown = a.attrs.display === 'name' ? key : a.attrs.display === 'both' ? `${key}=${value}` : value
        drawText(
          ctx,
          num(a, 'layer'),
          shown,
          num(a, 'x'),
          num(a, 'y'),
          num(a, 'size', 1.778),
          parseRot(a.attrs.rot),
          IDENTITY,
          a.attrs.align,
        )
      }
      resolve = (t) => (t.startsWith('>') ? (sheetValues[t.slice(1).toUpperCase()] ?? t) : t)
    }

    for (const group of ['nets', 'busses']) {
      for (const net of children(child(sheet, group), group === 'nets' ? 'net' : 'bus')) {
        for (const segment of children(net, 'segment')) {
          for (const node of segment.children) {
            if (node.name === 'wire') wire(ctx, node, IDENTITY)
            else if (node.name === 'junction') {
              const x = num(node, 'x')
              const y = num(node, 'y')
              ctx.emit(91, `<circle cx="${n(x)}" cy="${n(y)}" r="0.5" stroke="none"/>`)
            } else if (node.name === 'label') {
              const rot = parseRot(node.attrs.rot)
              const size = num(node, 'size', 1.778)
              drawText(
                ctx,
                num(node, 'layer', 95),
                net.attrs.name,
                num(node, 'x'),
                num(node, 'y'),
                size,
                rot,
                IDENTITY,
                node.attrs.xref === 'yes' ? 'center-left' : node.attrs.align,
              )
            }
          }
        }
      }
    }
    const name = child(sheet, 'description')?.text.trim() || `Sheet ${index + 1}`
    sheets.push(makeSheet(name, 'Sheets', ctx.buckets, names, true, ctx.bounds, 5))
  })
  if (missing) warnings.push(`${plural(missing, 'symbol is', 'symbols are')} missing from the embedded libraries.`)
  if (children(child(schematic, 'modules'), 'module').length > 0)
    warnings.push('This schematic uses modules. Their sheets are not drawn.')
  truncation(budget, warnings)
  const parts: EaglePart[] = [...partNodes.values()].map((part) => {
    const lib = lookup(part.attrs.library, part.attrs.library_urn)
    const deviceset = named(child(lib, 'devicesets'), 'deviceset', part.attrs.deviceset)
    const device = named(child(deviceset, 'devices'), 'device', part.attrs.device ?? '')
    return {
      name: part.attrs.name ?? '',
      value: deviceValue(part, deviceset),
      device: deviceName(part),
      package: device?.attrs.package ?? '',
      library: part.attrs.library ?? '',
    }
  })
  return {
    kind: 'schematic',
    version,
    sheets,
    parts,
    stats: [
      plural(sheets.length, 'sheet'),
      plural(partNodes.size, 'part'),
      plural(instancesTotal, 'symbol'),
      plural(children(child(schematic, 'libraries'), 'library').length, 'library', 'libraries'),
    ],
    warnings,
  }
}

function renderLibrary(root: XNode, version: string): EagleRender {
  const library = path(root, 'eagle', 'drawing', 'library')
  const names = layerTable(path(root, 'eagle', 'drawing'))
  const sheets: EagleSheet[] = []
  const budget = sharedBudget()
  const packages = children(child(library, 'packages'), 'package')
  const symbols = children(child(library, 'symbols'), 'symbol')
  for (const pkg of packages.slice(0, MAX_LIBRARY_SHEETS)) {
    const ctx = newCtx((t) => t, budget)
    primitives(ctx, pkg.children, IDENTITY)
    sheets.push(makeSheet(pkg.attrs.name ?? '', 'Packages', ctx.buckets, names, false, ctx.bounds, 1))
  }
  for (const sym of symbols.slice(0, MAX_LIBRARY_SHEETS)) {
    const ctx = newCtx((t) => t, budget)
    ctx.readable = true
    primitives(ctx, sym.children, IDENTITY)
    sheets.push(makeSheet(sym.attrs.name ?? '', 'Symbols', ctx.buckets, names, true, ctx.bounds, 2))
  }
  const warnings: string[] = []
  if (packages.length > MAX_LIBRARY_SHEETS || symbols.length > MAX_LIBRARY_SHEETS)
    warnings.push(`Only the first ${MAX_LIBRARY_SHEETS} packages and symbols are listed.`)
  truncation(budget, warnings)
  const parts = children(child(library, 'devicesets'), 'deviceset').flatMap((set) =>
    children(child(set, 'devices'), 'device').map((device) => ({
      name: `${set.attrs.name ?? ''}${device.attrs.name ?? ''}`,
      value: '',
      device: set.attrs.name ?? '',
      package: device.attrs.package ?? '',
      library: '',
    })),
  )
  return {
    kind: 'library',
    version,
    sheets,
    parts,
    stats: [plural(packages.length, 'package'), plural(symbols.length, 'symbol'), plural(parts.length, 'device')],
    warnings,
  }
}

function renderDrawing(root: XNode, version: string) {
  const drawing = path(root, 'eagle', 'drawing')
  if (child(drawing, 'board')) return renderBoard(root, version)
  if (child(drawing, 'schematic')) return renderSchematic(root, version)
  if (child(drawing, 'library')) return renderLibrary(root, version)
  throw new Error('This Eagle file has no board, schematic or library in it.')
}

export function renderEagle(src: string): EagleRender {
  const { root, complete } = parseXml(src)
  const eagle = child(root, 'eagle')
  if (!eagle) throw new Error('This is not an Eagle XML file.')
  const result = renderDrawing(root, eagle.attrs.version ?? '')
  if (!complete) result.warnings.unshift('This file looks cut off, so the drawing may be incomplete.')
  return result
}
