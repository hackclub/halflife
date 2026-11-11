import { curvePoint, curveRange, pipe, polyline, surfacePoint } from '../brep/nurbs'
import type {
  Body,
  BSplineCurve,
  BSplineSurface,
  Coedge,
  Curve,
  Edge,
  Face,
  Loop,
  Surface,
  Vec,
  Vertex,
} from '../brep/types'
import type { XtModel, XtNode, XtValue } from './xt'

const MAX_CHAIN = 1_000_000
const CURVE_SAMPLES = 48
const SPINE_SAMPLES = 96
const SPINE_MARGIN = 0.02
const OFFSET_SAMPLES = 384
const TANGENT_STEP = 1e-6
const SOLID = 'S'
const ROLLING_BALL = 'R'
const COLOUR = /^SDL\/TYSA_COLOUR/

export interface XtBody {
  body: Body
  node: number
  colour: number[] | null
  faceColours: (number[] | null)[]
}

type Evaluate = (t: number) => Vec

const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

export class XtBrep {
  readonly missing = { curves: 0, surfaces: 0 }
  private readonly curves = new Map<number, Curve | null>()
  private readonly surfaces = new Map<number, Surface | null>()
  private readonly vertices = new Map<number, Vertex>()
  private readonly edges = new Map<number, Edge | null>()
  private readonly faceColours = new Map<Face, number[] | null>()

  constructor(private readonly model: XtModel) {}

  private node(index: XtValue | undefined) {
    return typeof index === 'number' && index > 0 ? this.model.nodes.get(index) : undefined
  }

  private vector(node: XtNode, field: string) {
    const value = node.values[field]
    return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number')
      ? (value as Vec)
      : null
  }

  private number(node: XtNode, field: string) {
    const value = node.values[field]
    return typeof value === 'number' ? value : null
  }

  private chain(first: XtValue | undefined, next: string) {
    const out: XtNode[] = []
    const seen = new Set<number>()
    for (
      let node = this.node(first);
      node && !seen.has(node.index) && out.length < MAX_CHAIN;
      node = this.node(node.values[next])
    ) {
      seen.add(node.index)
      out.push(node)
    }
    return out
  }

  bodies(): XtBody[] {
    const out: XtBody[] = []
    for (const node of this.model.nodes.values()) {
      if (node.name !== 'BODY') continue
      const regions = this.chain(node.values.region, 'next')
      const lumps = regions
        .filter((region) => region.values.type === SOLID)
        .map((region) => ({ shells: this.chain(region.values.shell, 'next').map((shell) => this.faces(shell, false)) }))
      if (lumps.every((lump) => lump.shells.every((faces) => faces.length === 0))) {
        const sheets = regions.flatMap((region) =>
          this.chain(region.values.shell, 'next').map((shell) => this.faces(shell, true)),
        )
        if (sheets.some((faces) => faces.length > 0)) lumps.splice(0, lumps.length, { shells: sheets })
      }
      if (lumps.length === 0) continue
      out.push({
        body: { lumps, transform: null, attributed: true },
        node: node.index,
        colour: this.colour(node),
        faceColours: lumps.flatMap((lump) => lump.shells.flat()).map((face) => this.faceColours.get(face) ?? null),
      })
    }
    return out
  }

  private colour(owner: XtNode) {
    for (const attribute of this.chain(owner.values.attributes_features, 'next')) {
      if (attribute.name !== 'ATTRIBUTE') continue
      const id = this.node(this.node(attribute.values.definition)?.values.identifier)?.values.string
      if (typeof id !== 'string' || !COLOUR.test(id)) continue
      const fields = attribute.values.fields
      const values = Array.isArray(fields) ? this.node(fields[0] ?? undefined)?.values.values : null
      if (Array.isArray(values) && values.length >= 3 && values.slice(0, 3).every((v) => typeof v === 'number'))
        return values.slice(0, 3) as number[]
    }
    return null
  }

  private faces(shell: XtNode, sheet: boolean) {
    const faces: Face[] = []
    for (const node of this.chain(shell.values.face, 'next')) {
      if (node.values.shell !== shell.index) continue
      const surfaceNode = this.node(node.values.surface)
      const surface = surfaceNode ? this.surface(surfaceNode, node) : null
      const surfaceSense = surfaceNode?.values.sense !== '-'
      const face = {
        surface,
        forward: (node.values.sense !== '-') === surfaceSense,
        sheet,
        loops: this.chain(node.values.loop, 'next').map((loop) => this.loop(loop)),
      }
      this.faceColours.set(face, this.colour(node))
      faces.push(face)
    }
    return faces
  }

  private loop(loop: XtNode): Loop {
    const coedges: Coedge[] = []
    const first = this.node(loop.values.halfedge)
    const seen = new Set<number>()
    for (
      let fin = first;
      fin && !seen.has(fin.index) && coedges.length < MAX_CHAIN;
      fin = this.node(fin.values.forward)
    ) {
      seen.add(fin.index)
      const edge = this.edge(this.node(fin.values.edge))
      if (edge) coedges.push({ edge, forward: fin.values.sense !== '-', open: this.open(fin) })
    }
    return { coedges }
  }

  private open(fin: XtNode) {
    let real = 0
    const seen = new Set<number>()
    for (let other = fin; other && !seen.has(other.index); other = this.node(other.values.other)!) {
      seen.add(other.index)
      if (this.node(other.values.loop)) real++
    }
    return real < 2
  }

  private vertex(node: XtNode | undefined) {
    if (!node) return null
    let vertex = this.vertices.get(node.index)
    if (!vertex) {
      const point = this.node(node.values.point)
      const position = point && this.vector(point, 'pvec')
      if (!position) return null
      vertex = { point: position }
      this.vertices.set(node.index, vertex)
    }
    return vertex
  }

  private edge(node: XtNode | undefined): Edge | null {
    if (!node) return null
    if (this.edges.has(node.index)) return this.edges.get(node.index)!
    const curveNode = this.node(node.values.curve)
    const curve = curveNode ? this.curve(curveNode) : null
    let [start, end]: (Vertex | null)[] = [null, null]
    const seen = new Set<number>()
    for (let fin = this.node(node.values.halfedge); fin && !seen.has(fin.index); fin = this.node(fin.values.other)) {
      seen.add(fin.index)
      const vertex = this.vertex(this.node(fin.values.vertex))
      if (fin.values.sense === '-') start ??= vertex
      else end ??= vertex
    }
    if ((!start || !end) && curve) {
      const point = curveStart(curve)
      start = end = point ? { point } : null
    }
    const edge = start && end && curve ? { start, end, curve, forward: curveNode?.values.sense !== '-' } : null
    this.edges.set(node.index, edge)
    return edge
  }

  private curve(node: XtNode): Curve | null {
    if (this.curves.has(node.index)) return this.curves.get(node.index)!
    const curve = this.readCurve(node)
    if (!curve) this.missing.curves++
    this.curves.set(node.index, curve)
    return curve
  }

  private readCurve(node: XtNode): Curve | null {
    switch (node.name) {
      case 'LINE': {
        const [root, direction] = [this.vector(node, 'pvec'), this.vector(node, 'direction')]
        return root && direction ? { type: 'line', root, direction } : null
      }
      case 'CIRCLE':
      case 'ELLIPSE': {
        const [center, normal, x] = [
          this.vector(node, 'centre'),
          this.vector(node, 'normal'),
          this.vector(node, 'x_axis'),
        ]
        const major = this.number(node, node.name === 'CIRCLE' ? 'radius' : 'major_radius')
        const minor = node.name === 'CIRCLE' ? major : this.number(node, 'minor_radius')
        if (!center || !normal || !x || !major || !minor) return null
        return { type: 'ellipse', center, normal, major: scale(x, major), ratio: minor / major }
      }
      case 'B_CURVE': {
        const spline = this.nurbsCurve(this.node(node.values.nurbs), 3)
        return spline ? { type: 'spline', spline, forward: true } : null
      }
      case 'TRIMMED_CURVE': {
        const basis = this.node(node.values.basis_curve)
        const curve = basis ? this.readCurve(basis) : null
        return curve && basis?.values.sense === '-' ? reverse(curve) : curve
      }
      case 'INTERSECTION': {
        const chart = this.node(node.values.chart)
        const values = chart?.values.Hvec ?? chart?.values.hvec
        if (!Array.isArray(values)) return null
        const points: Vec[] = []
        for (let i = 0; i + 2 < values.length; i += 3)
          if (typeof values[i] === 'number') points.push([values[i], values[i + 1], values[i + 2]] as Vec)
        const spline = polyline(points)
        return spline ? { type: 'spline', spline, forward: true } : null
      }
      case 'SP_CURVE': {
        const surfaceNode = this.node(node.values.surface)
        const evaluate = surfaceNode && this.surfaceEvaluator(surfaceNode)
        const uv = this.nurbsCurve(this.node(node.values.b_curve), 2)
        if (!evaluate || !uv) return null
        const [t0, t1] = curveRange(uv)
        const points: Vec[] = []
        const samples = Math.max(CURVE_SAMPLES, (uv.knots.length - 1) * 8)
        for (let i = 0; i <= samples; i++) {
          const [u, v] = curvePoint(uv, t0 + ((t1 - t0) * i) / samples, 2)
          points.push(evaluate(u, v))
        }
        const spline = polyline(points)
        return spline ? { type: 'spline', spline, forward: true } : null
      }
    }
    return null
  }

  private nurbsCurve(node: XtNode | undefined, dims: number): BSplineCurve | null {
    if (!node) return null
    const degree = this.number(node, 'degree')
    const dimension = this.number(node, 'vertex_dim')
    const rational = node.values.rational === true
    const vertices = this.node(node.values.bspline_vertices)?.values.vertices
    const knots = this.node(node.values.knots)?.values.knots
    const mults = this.node(node.values.knot_mult)?.values.mult
    if (!degree || !dimension || !Array.isArray(vertices) || !Array.isArray(knots) || !Array.isArray(mults)) return null
    if (dimension !== dims + (rational ? 1 : 0)) return null
    const points = homogeneous(vertices as number[], dims, rational)
    const count = points.length / (dims + (rational ? 1 : 0))
    if ((mults as number[]).reduce((sum, m) => sum + m, 0) !== count + degree + 1) return null
    return {
      degree,
      rational,
      closed: node.values.closed === true,
      knots: knots as number[],
      mults: (mults as number[]).map((m, i, all) => (i === 0 || i === all.length - 1 ? m - 1 : m)),
      points,
    }
  }

  private nurbsSurface(node: XtNode | undefined): BSplineSurface | null {
    if (!node) return null
    const [uDegree, vDegree] = [this.number(node, 'u_degree'), this.number(node, 'v_degree')]
    const [uCount, vCount] = [this.number(node, 'n_u_vertices'), this.number(node, 'n_v_vertices')]
    const rational = node.values.rational === true
    const vertices = this.node(node.values.bspline_vertices)?.values.vertices
    const uKnots = this.node(node.values.u_knots)?.values.knots
    const vKnots = this.node(node.values.v_knots)?.values.knots
    const uMults = this.node(node.values.u_knot_mult)?.values.mult
    const vMults = this.node(node.values.v_knot_mult)?.values.mult
    if (!uDegree || !vDegree || !uCount || !vCount || !Array.isArray(vertices)) return null
    if (!Array.isArray(uKnots) || !Array.isArray(vKnots) || !Array.isArray(uMults) || !Array.isArray(vMults))
      return null
    const sum = (m: number[]) => m.reduce((total, value) => total + value, 0)
    if (sum(uMults as number[]) !== uCount + uDegree + 1 || sum(vMults as number[]) !== vCount + vDegree + 1)
      return null
    const stride = rational ? 4 : 3
    const raw = homogeneous(vertices as number[], 3, rational)
    if (raw.length !== uCount * vCount * stride) return null
    const points = new Float64Array(raw.length)
    for (let u = 0; u < uCount; u++)
      for (let v = 0; v < vCount; v++)
        points.set(raw.subarray((u * vCount + v) * stride, (u * vCount + v + 1) * stride), (v * uCount + u) * stride)
    const trim = (m: number[]) => m.map((value, i) => (i === 0 || i === m.length - 1 ? value - 1 : value))
    return {
      uDegree,
      vDegree,
      rational,
      uClosed: false,
      vClosed: false,
      uKnots: uKnots as number[],
      uMults: trim(uMults as number[]),
      vKnots: vKnots as number[],
      vMults: trim(vMults as number[]),
      uCount,
      vCount,
      points,
    }
  }

  private surface(node: XtNode, face: XtNode): Surface | null {
    const key = node.name === 'BLENDED_EDGE' ? -face.index : node.index
    if (this.surfaces.has(key)) return this.surfaces.get(key)!
    const surface = this.readSurface(node, face)
    if (!surface) this.missing.surfaces++
    this.surfaces.set(key, surface)
    return surface
  }

  private readSurface(node: XtNode, face: XtNode): Surface | null {
    const v = (field: string) => this.vector(node, field)
    switch (node.name) {
      case 'PLANE': {
        const [root, normal, u] = [v('pvec'), v('normal'), v('x_axis')]
        return root && normal && u ? { type: 'plane', root, normal, u } : null
      }
      case 'CYLINDER':
      case 'CONE': {
        const [center, axis, x] = [v('pvec'), v('axis'), v('x_axis')]
        const radius = this.number(node, 'radius')
        if (!center || !axis || !x || radius === null) return null
        if (node.name === 'CYLINDER')
          return { type: 'cone', center, axis, major: scale(x, radius), ratio: 1, sin: 0, cos: 1 }
        const [sin, cos] = [this.number(node, 'sin_half_angle'), this.number(node, 'cos_half_angle')]
        if (sin === null || cos === null) return null
        return { type: 'cone', center, axis, major: scale(x, radius), ratio: 1, sin, cos }
      }
      case 'SPHERE': {
        const [center, pole, u] = [v('centre'), v('axis'), v('x_axis')]
        const radius = this.number(node, 'radius')
        return center && pole && u && radius ? { type: 'sphere', center, radius, u, pole } : null
      }
      case 'TORUS': {
        const [center, normal, u] = [v('centre'), v('axis'), v('x_axis')]
        const [major, minor] = [this.number(node, 'major_radius'), this.number(node, 'minor_radius')]
        return center && normal && u && major !== null && minor
          ? { type: 'torus', center, normal, major, minor, u }
          : null
      }
      case 'B_SURFACE': {
        const spline = this.nurbsSurface(this.node(node.values.nurbs))
        return spline ? { type: 'spline', spline, forward: true } : null
      }
      case 'SWEPT_SURF': {
        const section = this.node(node.values.section)
        const curve = section && this.readCurve(section)
        const direction = v('sweep')
        return curve && direction ? { type: 'extrusion', curve, direction } : null
      }
      case 'SPUN_SURF': {
        const profile = this.node(node.values.profile)
        const curve = profile && this.readCurve(profile)
        const [point, axis] = [v('base'), v('axis')]
        return curve && point && axis ? { type: 'revolution', curve, point, axis } : null
      }
      case 'OFFSET_SURF':
        return this.offset(node, face)
      case 'BLENDED_EDGE':
        return this.blend(node, face)
    }
    return null
  }

  private offset(node: XtNode, face: XtNode): Surface | null {
    const baseNode = this.node(node.values.surface)
    const distance = this.number(node, 'offset')
    const base = baseNode && this.readSurface(baseNode, face)
    if (!base || distance === null) return null
    switch (base.type) {
      case 'plane':
        return { ...base, root: add(base.root, scale(normalize(base.normal), distance)) }
      case 'sphere':
        return { ...base, radius: base.radius + distance }
      case 'torus':
        return { ...base, minor: base.minor + distance }
      case 'extrusion':
        return offsetExtrusion(base, distance)
      case 'cone': {
        if (base.sin !== 0) return null
        const radius = Math.hypot(...base.major)
        const next = radius + distance * Math.sign(base.cos)
        return next > 0 ? { ...base, major: scale(base.major, next / radius) } : null
      }
    }
    return null
  }

  private blend(node: XtNode, face: XtNode): Surface | null {
    if (node.values.blend_type !== ROLLING_BALL) return null
    const range = node.values.range
    const radius = Array.isArray(range) && typeof range[0] === 'number' ? Math.abs(range[0]) : 0
    const spineNode = this.node(node.values.spine)
    const evaluate = spineNode && this.curveEvaluator(spineNode)
    if (!evaluate || !radius) return null
    const targets: Vec[] = []
    for (const loop of this.chain(face.values.loop, 'next')) {
      const { coedges } = this.loop(loop)
      for (const { edge } of coedges)
        targets.push(edge.start.point, edge.end.point, ...(edge.curve ? sampleCurve(edge.curve) : []))
    }
    if (targets.length === 0) return null
    if (evaluate.line) {
      const [root, direction] = evaluate.line
      const size = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2
      const ts = targets.map(
        (p) =>
          ((p[0] - root[0]) * direction[0] + (p[1] - root[1]) * direction[1] + (p[2] - root[2]) * direction[2]) / size,
      )
      const [low, high] = [Math.min(...ts), Math.max(...ts)]
      const margin = (high - low) * SPINE_MARGIN
      const spline = pipe([evaluate.at(low - margin), evaluate.at(high + margin)], radius)
      return spline ? { type: 'spline', spline, forward: true } : null
    }
    const [t0, t1] = evaluate.range
    const samples: { t: number; point: Vec }[] = []
    for (let i = 0; i <= SPINE_SAMPLES * 4; i++) {
      const t = t0 + ((t1 - t0) * i) / (SPINE_SAMPLES * 4)
      samples.push({ t, point: evaluate.at(t) })
    }
    let [low, high] = [Infinity, -Infinity]
    for (const target of targets) {
      let best = samples[0]
      for (const sample of samples) if (distance(sample.point, target) < distance(best.point, target)) best = sample
      low = Math.min(low, best.t)
      high = Math.max(high, best.t)
    }
    const margin = ((t1 - t0) * SPINE_MARGIN) / 4 + (high - low) * SPINE_MARGIN
    ;[low, high] = [Math.max(t0, low - margin), Math.min(t1, high + margin)]
    if (!(high > low)) return null
    const spine: Vec[] = []
    for (let i = 0; i <= SPINE_SAMPLES; i++) spine.push(evaluate.at(low + ((high - low) * i) / SPINE_SAMPLES))
    const spline = pipe(spine, radius)
    return spline ? { type: 'spline', spline, forward: true } : null
  }

  private curveEvaluator(node: XtNode) {
    const curve = this.readCurve(node)
    return curve && evaluator(curve)
  }

  private surfaceEvaluator(node: XtNode): ((u: number, v: number) => Vec) | null {
    const v = (field: string) => this.vector(node, field)
    switch (node.name) {
      case 'PLANE': {
        const [p, n, x] = [v('pvec'), v('normal'), v('x_axis')]
        if (!p || !n || !x) return null
        const y = cross(n, x)
        return (a, b) => add(p, add(scale(x, a), scale(y, b)))
      }
      case 'CYLINDER':
      case 'CONE': {
        const [p, axis, x] = [v('pvec'), v('axis'), v('x_axis')]
        const r = this.number(node, 'radius')
        if (!p || !axis || !x || r === null) return null
        const y = cross(axis, x)
        const tan =
          node.name === 'CONE'
            ? (this.number(node, 'sin_half_angle') ?? 0) / (this.number(node, 'cos_half_angle') ?? 1)
            : 0
        return (a, b) =>
          add(add(p, scale(axis, b)), scale(add(scale(x, Math.cos(a)), scale(y, Math.sin(a))), r + b * tan))
      }
      case 'SPHERE': {
        const [c, axis, x] = [v('centre'), v('axis'), v('x_axis')]
        const r = this.number(node, 'radius')
        if (!c || !axis || !x || r === null) return null
        const y = cross(axis, x)
        return (a, b) =>
          add(
            add(c, scale(add(scale(x, Math.cos(a)), scale(y, Math.sin(a))), r * Math.cos(b))),
            scale(axis, r * Math.sin(b)),
          )
      }
      case 'TORUS': {
        const [c, axis, x] = [v('centre'), v('axis'), v('x_axis')]
        const [major, minor] = [this.number(node, 'major_radius'), this.number(node, 'minor_radius')]
        if (!c || !axis || !x || major === null || minor === null) return null
        const y = cross(axis, x)
        return (a, b) =>
          add(
            add(c, scale(add(scale(x, Math.cos(a)), scale(y, Math.sin(a))), major + minor * Math.cos(b))),
            scale(axis, minor * Math.sin(b)),
          )
      }
      case 'B_SURFACE': {
        const spline = this.nurbsSurface(this.node(node.values.nurbs))
        return spline ? (a, b) => surfacePoint(spline, a, b) : null
      }
      case 'SWEPT_SURF': {
        const section = this.node(node.values.section)
        const evaluate = section && this.curveEvaluator(section)
        const d = v('sweep')
        return evaluate && d ? (a, b) => add(evaluate.at(a), scale(d, b)) : null
      }
    }
    return null
  }
}

function evaluator(curve: Curve): { at: Evaluate; range: [number, number]; line?: [Vec, Vec] } {
  if (curve.type === 'line')
    return {
      at: (t) => add(curve.root, scale(curve.direction, t)),
      range: [-1, 1],
      line: [curve.root, curve.direction],
    }
  if (curve.type === 'ellipse') return { at: (t) => ellipsePoint(curve, t), range: [0, 2 * Math.PI] }
  return { at: (t) => curvePoint(curve.spline, t) as Vec, range: curveRange(curve.spline) }
}

function offsetExtrusion(base: Extract<Surface, { type: 'extrusion' }>, distance: number): Surface | null {
  const { at, range, line } = evaluator(base.curve)
  if (line) {
    const shift = scale(normalize(cross(line[1], base.direction)), distance)
    return { ...base, curve: { type: 'line', root: add(line[0], shift), direction: line[1] } }
  }
  const [t0, t1] = range
  const step = (t1 - t0) * TANGENT_STEP
  const points: Vec[] = []
  for (let i = 0; i <= OFFSET_SAMPLES; i++) {
    const t = t0 + ((t1 - t0) * i) / OFFSET_SAMPLES
    const [a, b] = [at(Math.max(t0, t - step)), at(Math.min(t1, t + step))]
    const normal = normalize(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], base.direction))
    points.push(add(at(t), scale(normal, distance)))
  }
  const spline = polyline(points)
  return spline && { ...base, curve: { type: 'spline', spline, forward: true } }
}

function reverse(curve: Curve): Curve {
  if (curve.type === 'line') return { ...curve, direction: scale(curve.direction, -1) }
  if (curve.type === 'ellipse') return { ...curve, normal: scale(curve.normal, -1) }
  return { ...curve, forward: !curve.forward }
}

function normalize(v: Vec): Vec {
  const size = Math.hypot(...v) || 1
  return [v[0] / size, v[1] / size, v[2] / size]
}

function homogeneous(values: number[], dims: number, rational: boolean) {
  if (!rational) return Float64Array.from(values)
  const out = Float64Array.from(values)
  for (let at = 0; at + dims < out.length; at += dims + 1) {
    const w = out[at + dims] || 1
    for (let k = 0; k < dims; k++) out[at + k] /= w
  }
  return out
}

function ellipsePoint(curve: Extract<Curve, { type: 'ellipse' }>, t: number): Vec {
  const minor = scale(cross(normalize(curve.normal), curve.major), curve.ratio)
  return add(add(curve.center, scale(curve.major, Math.cos(t))), scale(minor, Math.sin(t)))
}

function curveStart(curve: Curve): Vec | null {
  if (curve.type === 'line') return curve.root
  if (curve.type === 'ellipse') return ellipsePoint(curve, 0)
  return curvePoint(curve.spline, curveRange(curve.spline)[0]) as Vec
}

function sampleCurve(curve: Curve): Vec[] {
  if (curve.type === 'line') return []
  if (curve.type === 'ellipse') return Array.from({ length: 16 }, (_, i) => ellipsePoint(curve, (i * Math.PI) / 8))
  const [t0, t1] = curveRange(curve.spline)
  return Array.from({ length: 9 }, (_, i) => curvePoint(curve.spline, t0 + ((t1 - t0) * i) / 8) as Vec)
}
