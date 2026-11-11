import {
  apply,
  arcPath,
  arcSamples,
  around,
  drawText,
  FLIP,
  HAIRLINE,
  IDENTITY,
  isMirrored,
  makeSheet,
  multiply,
  n,
  newCtx,
  placement,
  plural,
  restring,
  sharedBudget,
  truncation,
  type EaglePart,
  type EagleRender,
  type EagleSheet,
  type FileLayer,
  type Matrix,
} from '../eagle/render'
import { child, children, flag, number, parseSexpr, point, value, type SNode } from './sexpr'

export type LibrePcbViewKind = 'schematic' | 'board' | 'library'

export interface LibrePcbView {
  kind: LibrePcbViewKind
  render: EagleRender
  paths: string[]
}

export interface LibrePcbRender {
  name: string
  views: LibrePcbView[]
}

type DrawCtx = ReturnType<typeof newCtx>
type Lookup = (key: string) => string | undefined

const BOARD_LAYER: Record<string, number> = {
  top_cu: 1,
  bot_cu: 16,
  brd_outlines: 20,
  top_legend: 21,
  bot_legend: 22,
  top_placement: 21,
  bot_placement: 22,
  top_package_outlines: 23,
  bot_package_outlines: 24,
  top_names: 25,
  bot_names: 26,
  top_values: 27,
  bot_values: 28,
  top_stop_mask: 29,
  bot_stop_mask: 30,
  top_solder_paste: 31,
  bot_solder_paste: 32,
  top_glue: 35,
  bot_glue: 36,
  top_courtyard: 39,
  bot_courtyard: 40,
  brd_cutouts: 46,
  brd_plated_cutouts: 46,
  brd_guide: 47,
  brd_documentation: 48,
  brd_comments: 49,
  top_documentation: 51,
  bot_documentation: 52,
}

const SCHEMATIC_LAYER: Record<string, number> = {
  sym_pin_numbers: 93,
  sym_outlines: 94,
  sym_pin_lines: 94,
  sym_names: 95,
  sym_pin_names: 95,
  sym_values: 96,
  sch_frames: 97,
  sch_documentation: 98,
  sch_comments: 98,
  sch_guide: 98,
}

const FIXED_NAMES: Record<number, [string, string]> = {
  17: ['Pads', 'THT pads'],
  18: ['Vias', 'vias'],
  44: ['Drills', 'plated drills'],
  45: ['Holes', 'non-plated holes'],
  91: ['Wires', 'sch_net_lines'],
  92: ['Net labels', 'sch_net_labels'],
  93: ['Pin numbers', 'sym_pin_numbers'],
}

const COPPER_IDS: Record<number, string> = { 1: 'top_cu', 16: 'bot_cu' }
const WORDS: Record<string, string> = { top: 'Top', bot: 'Bottom', brd: 'Board', sch: 'Schematic', sym: 'Symbol' }
const TERMS: Record<string, string> = { cu: 'Copper', brd: 'Board', sch: 'Schematic', sym: 'Symbol' }
const MAX_FILES_PER_KIND = 1500
const NET_LINE_WIDTH = 0.15875
const NET_LABEL_HEIGHT = 2
const PIN_LINE_WIDTH = 0.1524
const JUNCTION_RADIUS = 0.6
const LEGACY_PIN_NAME_GAP = 0.6

function layerName(id: string) {
  const inner = /^in(\d+)_cu$/.exec(id)
  if (inner) return `Inner Copper ${inner[1]}`
  return id
    .split('_')
    .map((word, i) => (i === 0 && WORDS[word]) || TERMS[word] || word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

class Layers {
  ids = new Map<number, Set<string>>()
  extra = new Map<string, number>()
  constructor(
    private readonly known: Record<string, number>,
    private readonly fallback: number | null,
  ) {}

  number(id: string | undefined) {
    if (!id || id.includes('grab_area')) return null
    const inner = /^in(\d+)_cu$/.exec(id)
    let layer = inner && this.known === BOARD_LAYER ? Math.min(15, 1 + Number(inner[1])) : this.known[id]
    if (layer === undefined) layer = this.fallback ?? this.extra.get(id) ?? 100 + this.extra.size
    if (this.fallback === null) this.extra.set(id, layer)
    let set = this.ids.get(layer)
    if (!set) this.ids.set(layer, (set = new Set()))
    set.add(id)
    return layer
  }

  table() {
    const table = new Map<number, FileLayer>()
    for (const [layer, ids] of this.ids) table.set(layer, { name: layerName([...ids][0]) })
    for (const [layer, [name]] of Object.entries(FIXED_NAMES)) table.set(Number(layer), { name })
    for (const [layer, id] of Object.entries(COPPER_IDS))
      if (!table.has(Number(layer))) table.set(Number(layer), { name: layerName(id) })
    return table
  }

  annotate(sheet: EagleSheet) {
    for (const layer of sheet.layers) {
      const ids = this.ids.get(layer.number)
      layer.detail = ids ? [...ids].join(', ') : (FIXED_NAMES[layer.number]?.[1] ?? COPPER_IDS[layer.number] ?? '')
    }
    return sheet
  }
}

function substitute(text: string, lookup: Lookup, depth = 0): string {
  if (!text.includes('{{')) return text
  return text.replace(/\{\{([\s\S]*?)\}\}/g, (_, body: string) => {
    for (const option of body.split(/\s+or\s+/i)) {
      const key = option.trim()
      const quoted = /^"(.*)"$|^'(.*)'$/.exec(key)
      if (quoted) return quoted[1] ?? quoted[2]
      const found = lookup(key.toUpperCase())
      if (found) return depth < 4 ? substitute(found, lookup, depth + 1) : found
    }
    return ''
  })
}

function chain(...lookups: (Lookup | Record<string, string>)[]): Lookup {
  return (key) => {
    for (const l of lookups) {
      const v = typeof l === 'function' ? l(key) : l[key]
      if (v) return v
    }
    return undefined
  }
}

function attributes(node: SNode | undefined) {
  const out: Record<string, string> = {}
  for (const a of children(node, 'attribute')) {
    const key = a.args[0]?.toUpperCase()
    if (key && !(key in out)) out[key] = value(a, 'value') ?? ''
  }
  return out
}

function at(node: SNode, mirror = false): Matrix {
  const [x, y] = point(node)
  return placement(x, y, { angle: number(node, 'rotation'), mirror, spin: false })
}

function outline(ctx: DrawCtx, m: Matrix, vertices: SNode[], pad: number, edge: boolean) {
  const mirrored = isMirrored(m)
  const pts = vertices.map((v) => apply(m, ...point(v)))
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`
  ctx.bounds.add(pts[0][0], pts[0][1], pad)
  if (edge) ctx.outline.add(pts[0][0], pts[0][1])
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    const angle = number(vertices[i], 'angle') * (mirrored ? -1 : 1)
    d += arcPath(x1, y1, x2, y2, angle).replace(/^M[^LA]*/, '')
    for (const [x, y] of arcSamples(x1, y1, x2, y2, angle)) {
      ctx.bounds.add(x, y, pad)
      if (edge) ctx.outline.add(x, y)
    }
  }
  const [fx, fy] = pts[0]
  const [lx, ly] = pts[pts.length - 1]
  const closed = pts.length > 2 && Math.hypot(lx - fx, ly - fy) < 1e-6
  return { d: closed ? `${d}Z` : d, closed }
}

function polygon(ctx: DrawCtx, node: SNode, m: Matrix, layer: number | null, pour = false) {
  const vertices = children(node, 'vertex')
  if (layer === null || vertices.length < 2) return
  const w = number(node, 'width')
  const { d, closed } = outline(ctx, m, vertices, w / 2, layer === 20)
  if (pour)
    ctx.emit(
      layer,
      `<path d="${d}" fill-opacity="0.16" stroke-width="${n(Math.max(w, 0.05))}" stroke-dasharray="${n(Math.max(w, 0.2) * 3)} ${n(Math.max(w, 0.2) * 2)}" stroke-linejoin="round"/>`,
    )
  else if (flag(node, 'fill') && closed)
    ctx.emit(layer, `<path d="${d}" stroke-width="${n(w)}" stroke-linejoin="round"/>`)
  else
    ctx.emit(
      layer,
      `<path d="${d}" fill="none" stroke-width="${w > 0 ? n(w) : HAIRLINE}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
}

function circle(ctx: DrawCtx, node: SNode, m: Matrix, layer: number | null) {
  if (layer === null) return
  const r = number(node, 'diameter') / 2
  const w = number(node, 'width')
  const [x, y] = apply(m, ...point(node))
  ctx.emit(
    layer,
    flag(node, 'fill')
      ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" stroke-width="${n(w)}"/>`
      : `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="none" stroke-width="${w > 0 ? n(w) : HAIRLINE}"/>`,
  )
  ctx.bounds.add(x, y, r + w / 2)
  if (layer === 20) ctx.outline.add(x, y, r)
}

function label(ctx: DrawCtx, node: SNode, layer: number | null, lookup: Lookup | null, m: Matrix = IDENTITY) {
  if (layer === null) return
  const raw = value(node, 'value') ?? ''
  const shown = lookup ? substitute(raw, lookup) : raw
  const [x, y] = point(node)
  const [h = 'left', v = 'bottom'] = child(node, 'align')?.args ?? []
  const align = h === 'center' && v === 'center' ? 'center' : `${v}-${h}`
  const rot = {
    angle: number(node, 'rotation'),
    mirror: flag(node, 'mirror'),
    spin: value(node, 'auto_rotate') === 'false',
  }
  drawText(ctx, layer, shown, x, y, number(node, 'height', 1), rot, m, align)
}

function drill(ctx: DrawCtx, node: SNode, m: Matrix, layer: number) {
  const d = number(node, 'diameter')
  const pts = children(node, 'vertex').map((v) => apply(m, ...point(v)))
  if (pts.length === 0) return
  if (pts.length === 1) {
    ctx.emit(layer, `<circle cx="${n(pts[0][0])}" cy="${n(pts[0][1])}" r="${n(d / 2)}" stroke="none"/>`)
  } else {
    const { d: path } = outline(ctx, m, children(node, 'vertex'), d / 2, false)
    ctx.emit(layer, `<path d="${path}" fill="none" stroke-width="${n(d)}" stroke-linecap="round"/>`)
  }
  for (const [x, y] of pts) ctx.bounds.add(x, y, d / 2)
}

function hole(ctx: DrawCtx, node: SNode, m: Matrix) {
  const d = number(node, 'diameter')
  const pts = children(node, 'vertex').map((v) => apply(m, ...point(v)))
  if (pts.length === 1)
    ctx.emit(45, `<circle cx="${n(pts[0][0])}" cy="${n(pts[0][1])}" r="${n(d / 2)}" fill="none" stroke-width="0.1"/>`)
  drill(ctx, node, m, 44)
}

function octagon(w: number, h: number) {
  const k = (Math.min(w, h) / 2) * (1 - Math.tan(Math.PI / 8))
  const x = w / 2
  const y = h / 2
  return [
    [x, y - k],
    [x - k, y],
    [-x + k, y],
    [-x, y - k],
    [-x, -y + k],
    [-x + k, -y],
    [x - k, -y],
    [x, -y + k],
  ]
    .map(([px, py]) => `${n(px)},${n(py)}`)
    .join(' ')
}

function pad(ctx: DrawCtx, node: SNode, m: Matrix, flipped: boolean) {
  const local = multiply(m, at(node))
  const w = number(node, 'size', 0, 0)
  const h = number(node, 'size', 0, 1)
  const holes = children(node, 'hole')
  const legacyDrill = number(node, 'drill')
  const side = value(node, 'side') === 'bottom' ? 16 : 1
  const layer = holes.length > 0 || legacyDrill > 0 || value(node, 'side') === 'tht' ? 17 : flipped ? FLIP[side] : side
  const shape = value(node, 'shape') ?? 'roundrect'
  const t = `transform="matrix(${local.map(n).join(' ')})"`
  if (shape === 'custom') {
    const vertices = children(node, 'vertex')
    if (vertices.length > 1) ctx.emit(layer, `<path d="${outline(ctx, local, vertices, 0, false).d}" stroke="none"/>`)
  } else if (shape === 'octagon') {
    ctx.emit(layer, `<polygon points="${octagon(w, h)}" ${t} stroke="none"/>`)
  } else {
    const ratio = shape === 'round' ? 1 : shape === 'rect' ? 0 : Math.min(1, Math.max(0, number(node, 'radius')))
    const r = (ratio * Math.min(w, h)) / 2
    ctx.emit(
      layer,
      `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" ${t} stroke="none"/>`,
    )
  }
  for (const h of holes) drill(ctx, h, local, 44)
  if (legacyDrill > 0)
    ctx.emit(44, `<circle cx="${n(local[4])}" cy="${n(local[5])}" r="${n(legacyDrill / 2)}" stroke="none"/>`)
  ctx.bounds.add(local[4], local[5], Math.max(w, h) / 2)
  return apply(local, 0, 0)
}

function pin(ctx: DrawCtx, node: SNode, m: Matrix, name: string | null, numbers: string) {
  const local = multiply(m, at(node))
  const length = number(node, 'length')
  if (length > 0)
    ctx.emit(
      94,
      `<path d="M0 0H${n(length)}" fill="none" stroke-width="${PIN_LINE_WIDTH}" transform="matrix(${local.map(n).join(' ')})"/>`,
    )
  ctx.bounds.add(local[4], local[5])
  ctx.bounds.add(...apply(local, length, 0))
  const inner = { angle: 0, mirror: false, spin: false }
  if (name) {
    const [nx, ny] = child(node, 'name_position') ? point(node, 'name_position') : [length + LEGACY_PIN_NAME_GAP, 0]
    const [h = 'left', v = 'center'] = child(node, 'name_align')?.args ?? []
    drawText(
      ctx,
      95,
      name,
      nx,
      ny,
      number(node, 'name_height', 2.5),
      { ...inner, angle: number(node, 'name_rotation') },
      local,
      h === 'center' && v === 'center' ? 'center' : `${v}-${h}`,
    )
  }
  if (numbers && length > 0) drawText(ctx, 93, numbers, length / 2, 0.3, 1, inner, local, 'bottom-center')
  return apply(local, 0, 0)
}

class Library {
  #cache = new Map<string, SNode | null>()
  #missing = new Set<string>()

  constructor(
    private readonly files: Record<string, string>,
    private readonly root: string,
  ) {}

  get(kind: 'cmp' | 'dev' | 'pkg' | 'sym', uuid: string | undefined, required = true) {
    if (!uuid) return undefined
    const file = { cmp: 'component', dev: 'device', pkg: 'package', sym: 'symbol' }[kind]
    const path = `${this.root}library/${kind}/${uuid}/${file}.lp`
    if (!this.#cache.has(path)) {
      const text = this.files[path]
      this.#cache.set(path, text === undefined ? null : (parseSexpr(text).children[0] ?? null))
    }
    const node = this.#cache.get(path) ?? undefined
    if (!node && required) this.#missing.add(path)
    return node
  }

  get missing() {
    return this.#missing.size
  }
}

interface Part {
  node: SNode
  name: string
  value: string
  lookup: Lookup
  component?: SNode
  device?: SNode
  package?: SNode
}

function partsOf(circuit: SNode | undefined, library: Library, project: Record<string, string>) {
  const parts = new Map<string, Part>()
  for (const node of children(circuit, 'component')) {
    const component = library.get('cmp', value(node, 'lib_component'))
    const device = children(node, 'device')
      .map((option) => library.get('dev', option.args[0], false))
      .find(Boolean)
    const assembly = children(node, 'device').find((option) => option.args[0] === device?.args[0])
    const pkg = device ? library.get('pkg', value(device, 'package')) : undefined
    const mpn = child(assembly, 'part')
    const own: Record<string, string> = {
      NAME: value(node, 'name') ?? '',
      DEVICE: value(device, 'name') ?? '',
      PACKAGE: value(pkg, 'name') ?? '',
      MPN: mpn?.args[0] ?? '',
      MANUFACTURER: value(mpn, 'manufacturer') ?? '',
    }
    const lookup = chain(own, attributes(mpn), attributes(node), attributes(device), attributes(component), project)
    const raw = value(node, 'value') ?? ''
    const shown = substitute(raw, lookup)
    parts.set(node.args[0], {
      node,
      name: own.NAME,
      value: shown,
      lookup: chain({ VALUE: shown }, lookup),
      component,
      device,
      package: pkg,
    })
  }
  return parts
}

function padNames(part: Part | undefined) {
  const names = new Map<string, string>()
  for (const p of children(part?.package, 'pad')) names.set(p.args[0], value(p, 'name') ?? '')
  const bySignal = new Map<string, string[]>()
  for (const p of children(part?.device, 'pad')) {
    const signal = value(p, 'signal')
    const name = names.get(p.args[0])
    if (!signal || signal === 'none' || !name) continue
    bySignal.set(signal, [...(bySignal.get(signal) ?? []), name])
  }
  return bySignal
}

function anchor(node: SNode | undefined, points: Map<string, [number, number]>) {
  if (!node) return undefined
  const junction = value(node, 'junction') ?? value(node, 'via')
  if (junction) return points.get(junction)
  const owner = value(node, 'symbol') ?? value(node, 'device')
  const end = value(node, 'pin') ?? value(node, 'pad')
  return owner && end ? points.get(`${owner}/${end}`) : undefined
}

function line(ctx: DrawCtx, layer: number, a: [number, number], b: [number, number], width: number) {
  ctx.emit(
    layer,
    `<path d="M${n(a[0])} ${n(a[1])}L${n(b[0])} ${n(b[1])}" fill="none" stroke-width="${n(width)}" stroke-linecap="round"/>`,
  )
  ctx.bounds.add(a[0], a[1], width / 2)
  ctx.bounds.add(b[0], b[1], width / 2)
}

function renderSchematics(
  sheets: { path: string; node: SNode }[],
  parts: Map<string, Part>,
  nets: Map<string, string>,
  project: Record<string, string>,
  library: Library,
): EagleRender {
  const budget = sharedBudget()
  const out: EagleSheet[] = []
  let wires = 0
  sheets.forEach(({ node: sheet }, index) => {
    const ctx = newCtx((t) => t, budget)
    ctx.readable = true
    const layers = new Layers(SCHEMATIC_LAYER, 98)
    const sheetName = value(sheet, 'name') ?? `Sheet ${index + 1}`
    const sheetLookup = chain(
      {
        SHEET: sheetName,
        PAGE: String(index + 1),
        PAGES: String(sheets.length),
        PAGE_X_OF_Y: `Page ${index + 1} of ${sheets.length}`,
      },
      project,
    )
    const points = new Map<string, [number, number]>()

    for (const symbol of children(sheet, 'symbol')) {
      if (ctx.budget.truncated) break
      const part = parts.get(value(symbol, 'component') ?? '')
      const variant =
        children(part?.component, 'variant').find((v) => v.args[0] === value(part?.node, 'lib_variant')) ??
        child(part?.component, 'variant')
      const gate = children(variant, 'gate').find((g) => g.args[0] === value(symbol, 'lib_gate'))
      const lib = library.get('sym', value(gate, 'symbol'))
      const m = at(symbol, flag(symbol, 'mirror'))
      const suffix = value(gate, 'suffix') ?? ''
      const lookup = chain({ NAME: `${part?.name ?? ''}${suffix}` }, part?.lookup ?? {}, sheetLookup)
      const signals = new Map(children(part?.component, 'signal').map((s) => [s.args[0], value(s, 'name') ?? '']))
      const gatePins = new Map(children(gate, 'pin').map((p) => [p.args[0], p]))
      const pads = padNames(part)
      for (const node of lib?.children ?? []) {
        if (node.name === 'polygon') polygon(ctx, node, m, layers.number(value(node, 'layer')))
        else if (node.name === 'circle') circle(ctx, node, m, layers.number(value(node, 'layer')))
        else if (node.name === 'pin') {
          const mapping = gatePins.get(node.args[0])
          const signal = value(mapping, 'signal')
          const shown = value(mapping, 'text') ?? 'pin'
          const pinName = value(node, 'name') ?? ''
          const name =
            shown === 'none' ? null : shown === 'signal' && signal && signal !== 'none' ? signals.get(signal) : pinName
          const numbers = signal ? (pads.get(signal) ?? []).join(',') : ''
          points.set(`${symbol.args[0]}/${node.args[0]}`, pin(ctx, node, m, name ?? null, numbers))
        }
      }
      const texts = children(symbol, 'text')
      for (const text of texts) label(ctx, text, layers.number(value(text, 'layer')), lookup)
      if (texts.length === 0)
        for (const text of children(lib, 'text')) label(ctx, text, layers.number(value(text, 'layer')), lookup, m)
    }

    for (const segment of children(sheet, 'netsegment')) {
      const netName = nets.get(value(segment, 'net') ?? '') ?? ''
      const links = new Map<string, number>()
      for (const j of children(segment, 'junction')) points.set(j.args[0], point(j))
      for (const l of children(segment, 'line')) {
        const from = child(l, 'from')
        const to = child(l, 'to')
        const a = anchor(from, points)
        const b = anchor(to, points)
        for (const end of [from, to]) {
          const id = value(end, 'junction')
          if (id) links.set(id, (links.get(id) ?? 0) + 1)
        }
        if (!a || !b) continue
        line(ctx, 91, a, b, number(l, 'width', NET_LINE_WIDTH))
        wires++
      }
      for (const [id, count] of links) {
        const p = points.get(id)
        if (count >= 3 && p)
          ctx.emit(91, `<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${JUNCTION_RADIUS}" stroke="none"/>`)
      }
      for (const l of children(segment, 'label')) {
        const [x, y] = point(l)
        const mirror = flag(l, 'mirror')
        drawText(
          ctx,
          92,
          netName,
          x,
          y,
          NET_LABEL_HEIGHT,
          { angle: number(l, 'rotation'), mirror, spin: false },
          IDENTITY,
          mirror ? 'bottom-right' : 'bottom-left',
        )
      }
    }

    for (const node of sheet.children) {
      if (node.name === 'polygon') polygon(ctx, node, IDENTITY, layers.number(value(node, 'layer')))
      else if (node.name === 'circle') circle(ctx, node, IDENTITY, layers.number(value(node, 'layer')))
      else if (node.name === 'text') label(ctx, node, layers.number(value(node, 'layer')), sheetLookup)
    }
    out.push(layers.annotate(makeSheet(sheetName, 'Schematics', ctx.buckets, layers.table(), true, ctx.bounds, 5)))
  })

  const placed = [...parts.values()].filter((p) => value(p.component, 'schematic_only') !== 'true')
  const warnings: string[] = []
  truncation(budget, warnings)
  return {
    kind: 'schematic',
    version: '',
    sheets: out,
    parts: placed.map((p) => ({
      name: p.name,
      value: p.value,
      device: value(p.device, 'name') ?? value(p.component, 'name') ?? '',
      package: value(p.package, 'name') ?? '',
      library: '',
    })),
    stats: [
      plural(sheets.length, 'sheet'),
      plural(placed.length, 'part'),
      plural(nets.size, 'net'),
      plural(wires, 'wire'),
    ],
    warnings,
  }
}

function renderBoards(
  boards: { path: string; node: SNode }[],
  parts: Map<string, Part>,
  nets: Map<string, string>,
  project: Record<string, string>,
  library: Library,
): EagleRender {
  const budget = sharedBudget()
  const out: EagleSheet[] = []
  const rows: EaglePart[] = []
  const warnings: string[] = []
  const stats: string[] = []
  let planes = 0
  boards.forEach(({ node: board }, index) => {
    const rules = child(board, 'design_rules')
    const viaRing = child(rules, 'via_annular_ring')
    const ring: [number, number, number] = [
      number(viaRing, 'ratio', 0.25),
      number(viaRing, 'min', 0.2),
      number(viaRing, 'max', 2),
    ]
    const ctx = newCtx((t) => t, budget)
    const layers = new Layers(BOARD_LAYER, null)
    const boardName = value(board, 'name') ?? `Board ${index + 1}`
    const boardLookup = chain({ BOARD: boardName }, project)
    const points = new Map<string, [number, number]>()
    const devices = children(board, 'device')

    for (const device of devices) {
      if (ctx.budget.truncated) break
      const part = parts.get(device.args[0])
      const lib = library.get('dev', value(device, 'lib_device')) ?? part?.device
      const pkg = library.get('pkg', value(lib, 'package')) ?? part?.package
      const footprint =
        children(pkg, 'footprint').find((f) => f.args[0] === value(device, 'lib_footprint')) ?? child(pkg, 'footprint')
      const flipped = flag(device, 'flip') || flag(device, 'mirror')
      const m = at(device, flipped)
      const map = (id: string | undefined) =>
        layers.number(flipped ? id?.replace(/^(top|bot)_/, (side) => (side === 'top_' ? 'bot_' : 'top_')) : id)
      if (index === 0)
        rows.push({
          name: part?.name ?? '',
          value: part?.value ?? '',
          device: value(lib, 'name') ?? '',
          package: value(pkg, 'name') ?? '',
          library: '',
        })
      for (const node of footprint?.children ?? []) {
        if (node.name === 'pad') points.set(`${device.args[0]}/${node.args[0]}`, pad(ctx, node, m, flipped))
        else if (node.name === 'polygon') polygon(ctx, node, m, map(value(node, 'layer')))
        else if (node.name === 'circle') circle(ctx, node, m, map(value(node, 'layer')))
        else if (node.name === 'hole') hole(ctx, node, m)
      }
      const lookup = chain(part?.lookup ?? {}, boardLookup)
      for (const text of children(device, 'stroke_text')) label(ctx, text, layers.number(value(text, 'layer')), lookup)
    }

    let traces = 0
    let vias = 0
    const used = new Set<string>()
    for (const segment of children(board, 'netsegment')) {
      const net = value(segment, 'net')
      if (net && net !== 'none') used.add(net)
      for (const j of children(segment, 'junction')) points.set(j.args[0], point(j))
      for (const v of children(segment, 'via')) {
        const [x, y] = point(v)
        const drillValue = Number(value(v, 'drill'))
        const d = Number.isFinite(drillValue) ? drillValue : number(rules, 'default_via_drill_diameter', 0.3)
        const sizeValue = Number(value(v, 'size'))
        const size = Number.isFinite(sizeValue) ? sizeValue : restring(d, ring)
        ctx.emit(18, `<circle cx="${n(x)}" cy="${n(y)}" r="${n(size / 2)}" stroke="none"/>`)
        ctx.emit(44, `<circle cx="${n(x)}" cy="${n(y)}" r="${n(d / 2)}" stroke="none"/>`)
        ctx.bounds.add(x, y, size / 2)
        points.set(v.args[0], [x, y])
        vias++
      }
      for (const trace of children(segment, 'trace')) {
        const layer = layers.number(value(trace, 'layer'))
        const a = anchor(child(trace, 'from'), points)
        const b = anchor(child(trace, 'to'), points)
        if (layer === null || !a || !b) continue
        line(ctx, layer, a, b, number(trace, 'width', 0.25))
        traces++
      }
    }

    for (const node of board.children) {
      if (node.name === 'polygon') polygon(ctx, node, IDENTITY, layers.number(value(node, 'layer')))
      else if (node.name === 'circle') circle(ctx, node, IDENTITY, layers.number(value(node, 'layer')))
      else if (node.name === 'stroke_text') label(ctx, node, layers.number(value(node, 'layer')), boardLookup)
      else if (node.name === 'hole') hole(ctx, node, IDENTITY)
      else if (node.name === 'plane') {
        polygon(ctx, node, IDENTITY, layers.number(value(node, 'layer')), true)
        planes++
      }
    }

    const fit = ctx.outline.empty ? ctx.bounds : around(ctx.outline, ctx.bounds)
    out.push(layers.annotate(makeSheet(boardName, 'Boards', ctx.buckets, layers.table(), false, fit, 2, ctx.outline)))
    if (index === 0) {
      const copper = 2 + Math.max(0, number(child(board, 'layers'), 'inner'))
      stats.push(
        !ctx.outline.empty
          ? `${(ctx.outline.maxX - ctx.outline.minX).toFixed(1)} × ${(ctx.outline.maxY - ctx.outline.minY).toFixed(1)} mm`
          : 'no board outline',
        `${copper} copper layers`,
        plural(devices.length, 'part'),
        plural(used.size, 'net'),
        plural(traces, 'track segment'),
        plural(vias, 'via'),
      )
    }
  })
  if (boards.length > 1) stats.unshift(plural(boards.length, 'board'))
  if (planes)
    warnings.push(
      `${planes} copper ${planes === 1 ? 'plane is' : 'planes are'} drawn as a tinted outline. LibrePCB doesn't save the filled copper; it fills planes again when the board is opened.`,
    )
  truncation(budget, warnings)
  return { kind: 'board', version: '', sheets: out, parts: rows, stats, warnings }
}

function listed(files: Record<string, string>, root: string, index: string, tag: string, pattern: RegExp) {
  const text = files[`${root}${index}`]
  const paths = text
    ? children(parseSexpr(text).children[0], tag).map((node) => `${root}${node.args[0]}`)
    : Object.keys(files)
        .filter((p) => p.startsWith(root) && pattern.test(p.slice(root.length)))
        .sort()
  return paths
    .filter((p) => files[p] !== undefined)
    .slice(0, MAX_FILES_PER_KIND)
    .map((path) => ({ path, node: parseSexpr(files[path]).children[0] }))
    .filter((entry) => entry.node)
}

export function renderProject(files: Record<string, string>, root: string): LibrePcbRender {
  const library = new Library(files, root)
  const metadata = files[`${root}project/metadata.lp`]
  const meta = metadata ? parseSexpr(metadata).children[0] : undefined
  const name = value(meta, 'name') ?? root.replace(/\/$/, '').split('/').pop() ?? 'LibrePCB project'
  const project: Record<string, string> = {
    PROJECT: name,
    AUTHOR: value(meta, 'author') ?? '',
    VERSION: value(meta, 'version') ?? '',
    ...attributes(meta),
  }
  const circuitText = files[`${root}circuit/circuit.lp`]
  const circuit = circuitText ? parseSexpr(circuitText).children[0] : undefined
  const nets = new Map(children(circuit, 'net').map((net) => [net.args[0], value(net, 'name') ?? '']))
  const parts = partsOf(circuit, library, project)
  const schematics = listed(files, root, 'schematics/schematics.lp', 'schematic', /^schematics\/[^/]+\/schematic\.lp$/)
  const boards = listed(files, root, 'boards/boards.lp', 'board', /^boards\/[^/]+\/board\.lp$/)
  const views: LibrePcbView[] = []
  if (schematics.length > 0)
    views.push({
      kind: 'schematic',
      render: renderSchematics(schematics, parts, nets, project, library),
      paths: schematics.map((s) => s.path),
    })
  if (boards.length > 0)
    views.push({
      kind: 'board',
      render: renderBoards(boards, parts, nets, project, library),
      paths: boards.map((b) => b.path),
    })
  if (views.length === 0) throw new Error('This LibrePCB project has no schematics or boards in it.')
  if (library.missing > 0) {
    const note = `${plural(library.missing, 'library element is', 'library elements are')} missing from the project's library folder, so some parts are not drawn.`
    for (const view of views) view.render.warnings.unshift(note)
  }
  return { name, views }
}

export function renderElement(text: string): LibrePcbRender {
  const root = parseSexpr(text).children[0]
  const name = value(root, 'name') ?? ''
  const budget = sharedBudget()
  const sheets: EagleSheet[] = []
  if (root?.name === 'librepcb_symbol') {
    const ctx = newCtx((t) => t, budget)
    ctx.readable = true
    const layers = new Layers(SCHEMATIC_LAYER, 98)
    for (const node of root.children) {
      if (node.name === 'polygon') polygon(ctx, node, IDENTITY, layers.number(value(node, 'layer')))
      else if (node.name === 'circle') circle(ctx, node, IDENTITY, layers.number(value(node, 'layer')))
      else if (node.name === 'text') label(ctx, node, layers.number(value(node, 'layer')), null)
      else if (node.name === 'pin') pin(ctx, node, IDENTITY, value(node, 'name') ?? '', '')
    }
    sheets.push(layers.annotate(makeSheet(name, 'Symbols', ctx.buckets, layers.table(), true, ctx.bounds, 2)))
  } else if (root?.name === 'librepcb_package') {
    for (const footprint of children(root, 'footprint')) {
      const ctx = newCtx((t) => t, budget)
      const layers = new Layers(BOARD_LAYER, null)
      for (const node of footprint.children) {
        if (node.name === 'pad') pad(ctx, node, IDENTITY, false)
        else if (node.name === 'polygon') polygon(ctx, node, IDENTITY, layers.number(value(node, 'layer')))
        else if (node.name === 'circle') circle(ctx, node, IDENTITY, layers.number(value(node, 'layer')))
        else if (node.name === 'stroke_text') label(ctx, node, layers.number(value(node, 'layer')), null)
        else if (node.name === 'hole') hole(ctx, node, IDENTITY)
      }
      const title = value(footprint, 'name') || name
      sheets.push(layers.annotate(makeSheet(title, 'Footprints', ctx.buckets, layers.table(), false, ctx.bounds, 1)))
    }
  } else throw new Error('This LibrePCB file has nothing the viewer can draw.')
  const warnings: string[] = []
  truncation(budget, warnings)
  const symbol = root.name === 'librepcb_symbol'
  return {
    name,
    views: [
      {
        kind: 'library',
        render: {
          kind: 'library',
          version: '',
          sheets,
          parts: [],
          stats: symbol
            ? [plural(children(root, 'pin').length, 'pin')]
            : [plural(children(root, 'pad').length, 'pad'), plural(sheets.length, 'footprint')],
          warnings,
        },
        paths: [],
      },
    ],
  }
}
