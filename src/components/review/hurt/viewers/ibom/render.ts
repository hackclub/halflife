import { list, num, point, type IbomDocument, type Raw } from './decode'
import { circlePath as circle, emptyBounds, f, grow, type Bounds, type Box, type Point, type Side } from './geometry'

type TextLayer = 'silk' | 'fab'

export interface IbomFrame {
  x: number
  y: number
  width: number
  height: number
  body: string
}

export interface IbomPart {
  ref: string
  side: Side
  bbox: Box
  row: number
  excluded: boolean
  mark: string
}

export interface IbomView {
  format: IbomDocument['format']
  generator: string
  metadata: IbomDocument['metadata']
  columns: string[]
  rows: { ids: number[]; values: string[] }[]
  parts: IbomPart[]
  excludedLabel: string
  frames: Record<Side, IbomFrame>
  layers: { tracks: boolean; silk: boolean; fab: boolean; refs: TextLayer[]; values: TextLayer[] }
  fontText: boolean
}

const BODY_LIMIT = 48 * 1024 * 1024
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/

const rad = (deg: number) => (deg * Math.PI) / 180

function pathData(value: unknown) {
  return typeof value === 'string' && value.length < 8_000_000 && PATH_DATA.test(value) ? value : ''
}

function arc(cx: number, cy: number, r: number, start: number, end: number) {
  let sweep = (((end - start) % 360) + 360) % 360
  if (sweep === 0 && end !== start) sweep = 360
  if (sweep >= 360) return circle(cx, cy, r)
  const x0 = cx + r * Math.cos(rad(start))
  const y0 = cy + r * Math.sin(rad(start))
  const x1 = cx + r * Math.cos(rad(start + sweep))
  const y1 = cy + r * Math.sin(rad(start + sweep))
  return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`
}

function rings(polygons: unknown) {
  return list<unknown[]>(polygons)
    .map((ring) => {
      const points = list(ring).map(point)
      return points.length ? `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z` : ''
    })
    .join('')
}

function transform(pos: unknown, angle: unknown, offset?: unknown) {
  const [x, y] = point(pos)
  const a = num(angle)
  const parts: string[] = []
  if (x || y) parts.push(`translate(${f(x)} ${f(y)})`)
  if (a) parts.push(`rotate(${f(-a)})`)
  if (offset) {
    const [ox, oy] = point(offset)
    if (ox || oy) parts.push(`translate(${f(ox)} ${f(oy)})`)
  }
  return parts.length ? ` transform="${parts.join(' ')}"` : ''
}

function stroke(cls: string, d: string, width: number, extra = '') {
  return d ? `<path class="${cls}" d="${d}" stroke-width="${f(Math.max(width, 0.02))}"${extra}/>` : ''
}

function fill(cls: string, d: string, extra = '') {
  return d ? `<path class="${cls} fill" d="${d}"${extra}/>` : ''
}

function drawing(d: Raw, cls: string, minWidth = 0): string {
  const width = Math.max(num(d.width ?? d.thickness), minWidth)
  const filled = d.filled !== undefined && d.filled !== 0 && d.filled !== false
  if (!d.type) {
    if (d.svgpath) return d.thickness ? stroke(cls, pathData(d.svgpath), width) : fill(cls, pathData(d.svgpath))
    if (d.polygons) return fill(cls, rings(d.polygons))
    return ''
  }
  switch (d.type) {
    case 'segment': {
      const [x0, y0] = point(d.start)
      const [x1, y1] = point(d.end)
      return stroke(cls, `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`, width)
    }
    case 'rect': {
      const [x0, y0] = point(d.start)
      const [x1, y1] = point(d.end)
      const p = `M${f(x0)} ${f(y0)}H${f(x1)}V${f(y1)}H${f(x0)}Z`
      return filled ? fill(cls, p) : stroke(cls, p, width)
    }
    case 'circle': {
      const [cx, cy] = point(d.start)
      const p = circle(cx, cy, num(d.radius))
      return filled ? fill(cls, p) : stroke(cls, p, width)
    }
    case 'arc': {
      const [cx, cy] = point(d.start)
      const p = d.svgpath ? pathData(d.svgpath) : arc(cx, cy, num(d.radius), num(d.startangle), num(d.endangle))
      return stroke(cls, p, width)
    }
    case 'curve': {
      const [x0, y0] = point(d.start)
      const [ax, ay] = point(d.cpa)
      const [bx, by] = point(d.cpb)
      const [x1, y1] = point(d.end)
      return stroke(cls, `M${f(x0)} ${f(y0)}C${f(ax)} ${f(ay)} ${f(bx)} ${f(by)} ${f(x1)} ${f(y1)}`, width)
    }
    case 'polygon': {
      const p = d.svgpath ? pathData(d.svgpath) : rings(d.polygons)
      const t = transform(d.pos, d.angle)
      return d.filled === 0 || d.filled === false ? stroke(cls, p, width, t) : fill(cls, p, t)
    }
    case 'svgpath':
      return d.filled ? fill(cls, pathData(d.svgpath), ' fill-rule="evenodd"') : stroke(cls, pathData(d.svgpath), width)
    default:
      return ''
  }
}

function rect(w: number, h: number, r = 0) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  const x = -w / 2
  const y = -h / 2
  if (!radius) return `M${f(x)} ${f(y)}h${f(w)}v${f(h)}h${f(-w)}Z`
  const a = `A${f(radius)} ${f(radius)} 0 0 1`
  return (
    `M${f(x + radius)} ${f(y)}H${f(x + w - radius)}${a} ${f(x + w)} ${f(y + radius)}` +
    `V${f(y + h - radius)}${a} ${f(x + w - radius)} ${f(y + h)}H${f(x + radius)}${a} ${f(x)} ${f(y + h - radius)}` +
    `V${f(y + radius)}${a} ${f(x + radius)} ${f(y)}Z`
  )
}

function chamfered(w: number, h: number, corners: number, ratio: number) {
  const c = Math.min(w, h) * Math.min(Math.max(ratio, 0), 0.5)
  const x = -w / 2
  const y = -h / 2
  const corner = (bit: number, sharp: Point, ...cut: Point[]) => (corners & bit ? cut : [sharp])
  const points = [
    ...corner(1, [x, y], [x, y + c], [x + c, y]),
    ...corner(2, [x + w, y], [x + w - c, y], [x + w, y + c]),
    ...corner(8, [x + w, y + h], [x + w, y + h - c], [x + w - c, y + h]),
    ...corner(4, [x, y + h], [x + c, y + h], [x, y + h - c]),
  ]
  return `M${points.map(([px, py]) => `${f(px)} ${f(py)}`).join('L')}Z`
}

function padShape(pad: Raw) {
  const [w, h] = point(pad.size)
  switch (pad.shape) {
    case 'rect':
      return rect(w, h)
    case 'oval':
      return rect(w, h, Math.min(w, h) / 2)
    case 'circle':
      return circle(0, 0, w / 2)
    case 'roundrect':
      return rect(w, h, num(pad.radius))
    case 'chamfrect':
      return chamfered(w, h, num(pad.chamfpos), num(pad.chamfratio))
    default:
      return pad.svgpath ? pathData(pad.svgpath) : pad.polygons ? rings(pad.polygons) : rect(w, h)
  }
}

function pad(p: Raw, cls: string) {
  if (p.type === 'svgpath') return drawing(p, cls)
  const d = padShape(p)
  return d ? `<path class="${cls}" d="${d}"${transform(p.pos, p.angle, p.offset)}/>` : ''
}

function hole(p: Raw) {
  const [w, h] = point(p.drillsize)
  if (w <= 0) return ''
  const d = p.drillshape === 'circle' ? circle(0, 0, w / 2) : rect(w, h, Math.min(w, h) / 2)
  return `<path class="hole" d="${d}"${transform(p.pos, p.angle)}/>`
}

function onSide(p: Raw, side: Side) {
  return p.both === true || list<string>(p.layers).includes(side)
}

function track(t: Raw) {
  if (t.type === 'svgpath') return drawing(t, 'track')
  const width = num(t.width)
  if (t.center) {
    const [cx, cy] = point(t.center)
    return stroke('track', arc(cx, cy, num(t.radius), num(t.startangle), num(t.endangle)), width)
  }
  const [x0, y0] = point(t.start)
  const [x1, y1] = point(t.end)
  return stroke('track', `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`, width)
}

function zone(z: Raw) {
  const d = z.svgpath ? pathData(z.svgpath) : rings(z.polygons)
  const rule = z.fillrule === 'evenodd' ? 'evenodd' : 'nonzero'
  return d ? `<path class="zone" d="${d}" fill-rule="${rule}" stroke-width="${f(Math.max(num(z.width), 0))}"/>` : ''
}

function textLayer(items: Raw[], cls: TextLayer) {
  const plain: string[] = []
  const refs: string[] = []
  const values: string[] = []
  for (const item of items) {
    const markup = drawing(item, cls)
    if (item.ref) refs.push(markup)
    else if (item.val) values.push(markup)
    else plain.push(markup)
  }
  return `<g class="l-${cls}">${plain.join('')}<g class="l-refs">${refs.join('')}</g><g class="l-values">${values.join('')}</g></g>`
}

function bounds(doc: IbomDocument): Bounds {
  if (doc.board.bounds) return doc.board.bounds
  const box = emptyBounds()
  for (const fp of doc.footprints) {
    const [x, y] = fp.bbox.pos
    const r = Math.hypot(...fp.bbox.relpos) + Math.hypot(...fp.bbox.size)
    grow(box, x - r, y - r, x + r, y + r)
  }
  return Number.isFinite(box.minx) ? box : { minx: 0, miny: 0, maxx: 10, maxy: 10 }
}

function frame(doc: IbomDocument, side: Side, body: string): IbomFrame {
  const b = bounds(doc)
  const margin = Math.max(b.maxx - b.minx, b.maxy - b.miny) * 0.03 + 0.5
  return {
    x: f((side === 'B' ? -b.maxx : b.minx) - margin),
    y: f(b.miny - margin),
    width: f(b.maxx - b.minx + 2 * margin),
    height: f(b.maxy - b.miny + 2 * margin),
    body: side === 'B' ? `<g transform="scale(-1 1)">${body}</g>` : body,
  }
}

function renderSide(doc: IbomDocument, side: Side) {
  const { board } = doc
  const out: string[] = ['<g class="l-tracks">']
  for (const z of board.zones[side]) out.push(zone(z))
  for (const t of board.tracks[side]) out.push(track(t))
  out.push('</g>', textLayer(board.fab[side], 'fab'), textLayer(board.silk[side], 'silk'), '<g class="l-pads">')
  for (const fp of doc.footprints) {
    const cls = fp.excluded ? 'pad is-excluded' : 'pad'
    for (const d of fp.drawings) if (d.layer === side) out.push(drawing(d.drawing, cls))
    for (const p of fp.pads) {
      if (doc.format === 'kicad' && onSide(p, side))
        out.push(pad(p, doc.pin1 === 'all' && p.pin1 ? `${cls} pin1` : cls))
    }
  }
  for (const p of board.pads[side]) out.push(drawing(p, 'pad'))
  for (const fp of doc.footprints) for (const p of fp.pads) if (p.type === 'th' && p.drillsize) out.push(hole(p))
  out.push('</g><g class="l-edges">')
  for (const e of board.edges) out.push(drawing(e, 'edge', 0.1))
  out.push('</g>')
  const body = out.join('')
  if (body.length > BODY_LIMIT) throw new Error('This board is too detailed to draw.')
  return frame(doc, side, body)
}

function mark(doc: IbomDocument, id: number) {
  const fp = doc.footprints[id]
  const { pos, relpos, size, angle } = fp.bbox
  const pads = fp.pads
    .filter((p) => doc.format === 'easyeda' || onSide(p, fp.side))
    .map((p) => pad(p, doc.pin1 !== 'none' && p.pin1 ? 'hl-pad pin1' : 'hl-pad'))
    .join('')
  return `<rect class="hl-box"${transform(pos, angle)} x="${f(relpos[0])}" y="${f(relpos[1])}" width="${f(size[0])}" height="${f(size[1])}"/>${pads}`
}

export function renderView(doc: IbomDocument): IbomView {
  const rowOf = new Map<number, number>()
  doc.rows.forEach((row, i) => row.ids.forEach((id) => rowOf.set(id, i)))
  const has = (items: Record<Side, Raw[]>, test: (item: Raw) => boolean = () => true) =>
    items.F.some(test) || items.B.some(test)
  const textOn = (key: 'ref' | 'val') =>
    (['silk', 'fab'] as const).filter((layer) => has(doc.board[layer], (d) => Boolean(d[key])))
  return {
    format: doc.format,
    generator: doc.generator,
    metadata: doc.metadata,
    columns: doc.columns,
    rows: doc.rows,
    parts: doc.footprints.map((fp, id) => ({
      ref: fp.ref,
      side: fp.side,
      bbox: fp.bbox,
      row: rowOf.get(id) ?? -1,
      excluded: fp.excluded || !rowOf.has(id),
      mark: mark(doc, id),
    })),
    excludedLabel: doc.excludedLabel,
    frames: { F: renderSide(doc, 'F'), B: renderSide(doc, 'B') },
    layers: {
      tracks: has(doc.board.tracks) || has(doc.board.zones),
      silk: true,
      fab: has(doc.board.fab),
      refs: textOn('ref'),
      values: textOn('val'),
    },
    fontText: doc.board.fontText,
  }
}
