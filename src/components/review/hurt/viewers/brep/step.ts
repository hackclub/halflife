import type { Body, BSplineCurve, BSplineSurface, Coedge, Curve, Edge, Face, Surface, Vec, Vertex } from './types'

const RATIO_TOLERANCE = 1e-9
const MAX_PLAIN_INTEGER = 1e15

function real(value: number) {
  if (!Number.isFinite(value)) return '0.'
  if (Number.isInteger(value) && Math.abs(value) < MAX_PLAIN_INTEGER) return `${value}.`
  const text = String(Number(value.toPrecision(15)))
  const exponent = text.indexOf('e')
  const mantissa = exponent < 0 ? text : text.slice(0, exponent)
  const decimal = mantissa.includes('.') ? mantissa : `${mantissa}.`
  return exponent < 0 ? decimal : `${decimal}E${text.slice(exponent + 1)}`
}

function text(value: string) {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/[^\x20-\x7e]/g, '_')}'`
}

const length = (v: Vec) => Math.hypot(v[0], v[1], v[2])

function unit(v: Vec): Vec {
  const size = length(v)
  return size > 0 ? [v[0] / size, v[1] / size, v[2] / size] : [0, 0, 1]
}

function perpendicular(v: Vec): Vec {
  const n = unit(v)
  const other: Vec = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  return unit([n[1] * other[2] - n[2] * other[1], n[2] * other[0] - n[0] * other[2], n[0] * other[1] - n[1] * other[0]])
}

function orthogonal(axis: Vec, reference: Vec): Vec {
  const n = unit(axis)
  const dot = reference[0] * n[0] + reference[1] * n[1] + reference[2] * n[2]
  const projected: Vec = [reference[0] - dot * n[0], reference[1] - dot * n[1], reference[2] - dot * n[2]]
  return length(projected) > 1e-12 ? unit(projected) : perpendicular(n)
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

type Cone = Extract<Surface, { type: 'cone' }>

const CONE_MARGIN = 0.02
const ELLIPSE_SAMPLES = 16
const CIRCLE = [
  [1, 0, 1],
  [1, 1, Math.SQRT1_2],
  [0, 1, 1],
  [-1, 1, Math.SQRT1_2],
  [-1, 0, 1],
  [-1, -1, Math.SQRT1_2],
  [0, -1, 1],
  [1, -1, Math.SQRT1_2],
  [1, 0, 1],
]

function coneHeights(cone: Cone, face: Face): [number, number] | null {
  const axis = unit(cone.axis)
  let [low, high] = [Infinity, -Infinity]
  const add = (p: ArrayLike<number>) => {
    const h = (p[0] - cone.center[0]) * axis[0] + (p[1] - cone.center[1]) * axis[1] + (p[2] - cone.center[2]) * axis[2]
    low = Math.min(low, h)
    high = Math.max(high, h)
  }
  for (const loop of face.loops)
    for (const { edge } of loop.coedges) {
      add(edge.start.point)
      add(edge.end.point)
      const curve = edge.curve
      if (curve?.type === 'ellipse') {
        const minor = cross(unit(curve.normal), curve.major).map((v) => v * curve.ratio)
        for (let i = 0; i < ELLIPSE_SAMPLES; i++) {
          const [c, s] = [Math.cos((i * 2 * Math.PI) / ELLIPSE_SAMPLES), Math.sin((i * 2 * Math.PI) / ELLIPSE_SAMPLES)]
          add([0, 1, 2].map((k) => curve.center[k] + curve.major[k] * c + minor[k] * s))
        }
      } else if (curve?.type === 'spline') {
        const dims = curve.spline.rational ? 4 : 3
        for (let at = 0; at < curve.spline.points.length; at += dims) add(curve.spline.points.subarray(at, at + 3))
      }
    }
  const slope = cone.sin / cone.cos / length(cone.major)
  const apex = -1 / slope
  const margin = (high - low) * CONE_MARGIN + 1e-9
  ;[low, high] = [low - margin, high + margin]
  if (apex < 0) low = Math.max(low, apex)
  else high = Math.min(high, apex)
  return low < high ? [low, high] : null
}

function ellipticConeSpline(cone: Cone, heights: [number, number]): BSplineSurface {
  const axis = unit(cone.axis)
  const radius = length(cone.major)
  const across = cross(axis, cone.major).map((v) => v * Math.abs(cone.ratio))
  const slope = cone.sin / cone.cos / radius
  const points = new Float64Array(heights.length * CIRCLE.length * 4)
  heights.forEach((h, v) => {
    const scale = 1 + h * slope
    CIRCLE.forEach(([x, y, w], u) => {
      const at = (v * CIRCLE.length + u) * 4
      for (let k = 0; k < 3; k++)
        points[at + k] = cone.center[k] + h * axis[k] + scale * (x * cone.major[k] + y * across[k])
      points[at + 3] = w
    })
  })
  return {
    uDegree: 2,
    vDegree: 1,
    rational: true,
    uClosed: false,
    vClosed: false,
    uKnots: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI],
    uMults: [2, 2, 2, 2, 2],
    vKnots: heights,
    vMults: [1, 1],
    uCount: CIRCLE.length,
    vCount: heights.length,
    points,
  }
}

export class StepWriter {
  private readonly lines: string[] = []
  private readonly ids = new Map<object, number>()
  private next = 1
  private matrix: number[] | null = null
  readonly written: Face[] = []

  constructor(private readonly scale: number) {}

  private add(entity: string) {
    const id = this.next++
    this.lines.push(`#${id}=${entity};`)
    return id
  }

  private once(key: object, create: () => number) {
    let id = this.ids.get(key)
    if (id === undefined) {
      id = create()
      this.ids.set(key, id)
    }
    return id
  }

  private place(p: Vec): Vec {
    const m = this.matrix
    const s = this.scale
    if (!m) return [p[0] * s, p[1] * s, p[2] * s]
    return [
      (m[0] * p[0] + m[3] * p[1] + m[6] * p[2] + m[9]) * s,
      (m[1] * p[0] + m[4] * p[1] + m[7] * p[2] + m[10]) * s,
      (m[2] * p[0] + m[5] * p[1] + m[8] * p[2] + m[11]) * s,
    ]
  }

  private turn(v: Vec): Vec {
    const m = this.matrix
    if (!m) return v
    return [
      m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
      m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
      m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
    ]
  }

  private size(value: number) {
    const m = this.matrix
    return value * this.scale * (m ? Math.cbrt(Math.abs(determinant(m))) : 1)
  }

  private point(p: Vec) {
    const [x, y, z] = this.place(p)
    return this.add(`CARTESIAN_POINT('',(${real(x)},${real(y)},${real(z)}))`)
  }

  private direction(v: Vec) {
    const [x, y, z] = unit(this.turn(v))
    return this.add(`DIRECTION('',(${real(x)},${real(y)},${real(z)}))`)
  }

  private placement(origin: Vec, axis: Vec, reference: Vec) {
    const z = unit(this.turn(axis))
    const x = orthogonal(z, this.turn(reference))
    const at = this.point(origin)
    const [a, b] = [
      this.add(`DIRECTION('',(${z.map(real).join(',')}))`),
      this.add(`DIRECTION('',(${x.map(real).join(',')}))`),
    ]
    return this.add(`AXIS2_PLACEMENT_3D('',#${at},#${a},#${b})`)
  }

  private vertex(vertex: Vertex) {
    return this.once(vertex, () => this.add(`VERTEX_POINT('',#${this.point(vertex.point)})`))
  }

  private curve(curve: Curve) {
    return this.once(curve, () => {
      if (curve.type === 'line') {
        const vector = this.add(`VECTOR('',#${this.direction(curve.direction)},1.)`)
        return this.add(`LINE('',#${this.point(curve.root)},#${vector})`)
      }
      if (curve.type === 'ellipse') {
        if (Math.abs(Math.abs(curve.ratio) - 1) >= RATIO_TOLERANCE)
          return this.ellipse(curve.center, curve.normal, curve.major, curve.ratio)
        const position = this.placement(curve.center, curve.normal, curve.major)
        return this.add(`CIRCLE('',#${position},${real(this.size(length(curve.major)))})`)
      }
      return this.splineCurve(curve.spline)
    })
  }

  private ellipse(center: Vec, normal: Vec, major: Vec, ratio: number) {
    const radius = length(major)
    const minor = radius * Math.abs(ratio)
    const reference = minor > radius ? cross(normal, major) : major
    const position = this.placement(center, normal, reference)
    const [first, second] = minor > radius ? [minor, radius] : [radius, minor]
    return this.add(`ELLIPSE('',#${position},${real(this.size(first))},${real(this.size(second))})`)
  }

  private ellipticCone(cone: Cone, face: Face) {
    const flipped = cone.cos < 0
    if (Math.abs(cone.sin) < 1e-12) {
      const vector = this.add(`VECTOR('',#${this.direction(cone.axis)},1.)`)
      const ellipse = this.ellipse(cone.center, cone.axis, cone.major, cone.ratio)
      return { id: this.add(`SURFACE_OF_LINEAR_EXTRUSION('',#${ellipse},#${vector})`), flipped }
    }
    const heights = coneHeights(cone, face)
    return heights && { id: this.splineSurface(ellipticConeSpline(cone, heights)), flipped }
  }

  private splineCurve(spline: BSplineCurve) {
    const dims = spline.rational ? 4 : 3
    const count = spline.points.length / dims
    const points: number[] = []
    const weights: string[] = []
    for (let i = 0; i < count; i++) {
      const at = i * dims
      points.push(this.point([spline.points[at], spline.points[at + 1], spline.points[at + 2]]))
      if (spline.rational) weights.push(real(spline.points[at + 3]))
    }
    const mults = clamped(spline.mults)
    const list = points.map((p) => `#${p}`).join(',')
    if (!spline.rational)
      return this.add(
        `B_SPLINE_CURVE_WITH_KNOTS('',${spline.degree},(${list}),.UNSPECIFIED.,.F.,.F.,(${mults.join(',')}),(${spline.knots.map(real).join(',')}),.UNSPECIFIED.)`,
      )
    return this.add(
      `(BOUNDED_CURVE()B_SPLINE_CURVE(${spline.degree},(${list}),.UNSPECIFIED.,.F.,.F.)B_SPLINE_CURVE_WITH_KNOTS((${mults.join(',')}),(${spline.knots.map(real).join(',')}),.UNSPECIFIED.)CURVE()GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_CURVE((${weights.join(',')}))REPRESENTATION_ITEM(''))`,
    )
  }

  private splineSurface(spline: BSplineSurface) {
    const dims = spline.rational ? 4 : 3
    const rows: string[] = []
    const weights: string[] = []
    for (let u = 0; u < spline.uCount; u++) {
      const row: string[] = []
      const rowWeights: string[] = []
      for (let v = 0; v < spline.vCount; v++) {
        const at = (v * spline.uCount + u) * dims
        row.push(`#${this.point([spline.points[at], spline.points[at + 1], spline.points[at + 2]])}`)
        if (spline.rational) rowWeights.push(real(spline.points[at + 3]))
      }
      rows.push(`(${row.join(',')})`)
      weights.push(`(${rowWeights.join(',')})`)
    }
    const degrees = `${spline.uDegree},${spline.vDegree}`
    const knots = `(${clamped(spline.uMults).join(',')}),(${clamped(spline.vMults).join(',')}),(${spline.uKnots.map(real).join(',')}),(${spline.vKnots.map(real).join(',')}),.UNSPECIFIED.`
    if (!spline.rational)
      return this.add(
        `B_SPLINE_SURFACE_WITH_KNOTS('',${degrees},(${rows.join(',')}),.UNSPECIFIED.,.F.,.F.,.F.,${knots})`,
      )
    return this.add(
      `(BOUNDED_SURFACE()B_SPLINE_SURFACE(${degrees},(${rows.join(',')}),.UNSPECIFIED.,.F.,.F.,.F.)B_SPLINE_SURFACE_WITH_KNOTS(${knots})GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE((${weights.join(',')}))REPRESENTATION_ITEM('')SURFACE())`,
    )
  }

  private surface(surface: Surface, face: Face): { id: number; flipped: boolean } | null {
    switch (surface.type) {
      case 'plane':
        return { id: this.add(`PLANE('',#${this.placement(surface.root, surface.normal, surface.u)})`), flipped: false }
      case 'cone': {
        if (Math.abs(Math.abs(surface.ratio) - 1) > RATIO_TOLERANCE) return this.ellipticCone(surface, face)
        const radius = this.size(length(surface.major))
        const flipped = surface.cos < 0
        const slope = surface.sin / surface.cos
        if (Math.abs(surface.sin) < 1e-12) {
          const position = this.placement(surface.center, surface.axis, surface.major)
          return { id: this.add(`CYLINDRICAL_SURFACE('',#${position},${real(radius)})`), flipped }
        }
        const axis: Vec = slope > 0 ? surface.axis : [-surface.axis[0], -surface.axis[1], -surface.axis[2]]
        const position = this.placement(surface.center, axis, surface.major)
        return {
          id: this.add(`CONICAL_SURFACE('',#${position},${real(radius)},${real(Math.atan(Math.abs(slope)))})`),
          flipped,
        }
      }
      case 'sphere': {
        const position = this.placement(surface.center, surface.pole, surface.u)
        return {
          id: this.add(`SPHERICAL_SURFACE('',#${position},${real(this.size(Math.abs(surface.radius)))})`),
          flipped: surface.radius < 0,
        }
      }
      case 'torus': {
        const position = this.placement(surface.center, surface.normal, surface.u)
        const [major, minor] = [this.size(Math.abs(surface.major)), this.size(Math.abs(surface.minor))]
        return {
          id: this.add(`TOROIDAL_SURFACE('',#${position},${real(major)},${real(minor)})`),
          flipped: surface.minor < 0,
        }
      }
      case 'spline':
        return { id: this.splineSurface(surface.spline), flipped: !surface.forward }
      case 'extrusion': {
        const vector = this.add(`VECTOR('',#${this.direction(surface.direction)},1.)`)
        return {
          id: this.add(`SURFACE_OF_LINEAR_EXTRUSION('',#${this.curve(surface.curve)},#${vector})`),
          flipped: false,
        }
      }
      case 'revolution': {
        const axis = this.add(`AXIS1_PLACEMENT('',#${this.point(surface.point)},#${this.direction(surface.axis)})`)
        return { id: this.add(`SURFACE_OF_REVOLUTION('',#${this.curve(surface.curve)},#${axis})`), flipped: true }
      }
    }
  }

  private edge(edge: Edge) {
    return this.once(edge, () => {
      const curve = edge.curve!
      const sense = edge.forward === (curve.type !== 'spline' || curve.forward)
      return this.add(
        `EDGE_CURVE('',#${this.vertex(edge.start)},#${this.vertex(edge.end)},#${this.curve(curve)},${sense ? '.T.' : '.F.'})`,
      )
    })
  }

  private coedge(coedge: Coedge) {
    return this.add(`ORIENTED_EDGE('',*,*,#${this.edge(coedge.edge)},${coedge.forward ? '.T.' : '.F.'})`)
  }

  private face(face: Face) {
    if (!face.surface) return null
    const surface = this.surface(face.surface, face)
    if (!surface) return null
    const bounds: number[] = []
    for (const loop of face.loops) {
      const edges = loop.coedges.filter((coedge) => coedge.edge.curve).map((coedge) => this.coedge(coedge))
      if (edges.length === 0) continue
      const path = this.add(`EDGE_LOOP('',(${edges.map((e) => `#${e}`).join(',')}))`)
      bounds.push(this.add(`FACE_BOUND('',#${path},.T.)`))
    }
    const sense = face.forward !== surface.flipped
    this.written.push(face)
    return this.add(
      `ADVANCED_FACE('',(${bounds.map((b) => `#${b}`).join(',')}),#${surface.id},${sense ? '.T.' : '.F.'})`,
    )
  }

  body(body: Body) {
    this.matrix = body.transform
    const items: { id: number; solid: boolean }[] = []
    for (const lump of body.lumps)
      for (const shell of lump.shells) {
        const faces = shell.map((face) => this.face(face)).filter((id): id is number => id !== null)
        if (faces.length === 0) continue
        const list = faces.map((f) => `#${f}`).join(',')
        const closed =
          faces.length === shell.length &&
          shell.every((face) => !face.sheet && face.loops.every((loop) => loop.coedges.every((c) => !c.open)))
        if (closed)
          items.push({
            id: this.add(`MANIFOLD_SOLID_BREP('',#${this.add(`CLOSED_SHELL('',(${list}))`)})`),
            solid: true,
          })
        else
          items.push({
            id: this.add(`SHELL_BASED_SURFACE_MODEL('',(#${this.add(`OPEN_SHELL('',(${list}))`)}))`),
            solid: false,
          })
      }
    this.matrix = null
    return items
  }

  write(name: string, items: { id: number; solid: boolean }[]) {
    const context = this.add("APPLICATION_CONTEXT('automotive design')")
    this.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${context})`)
    const productContext = this.add(`PRODUCT_CONTEXT('',#${context},'mechanical')`)
    const product = this.add(`PRODUCT(${text(name)},${text(name)},'',(#${productContext}))`)
    const formation = this.add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`)
    const definitionContext = this.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${context},'design')`)
    const definition = this.add(`PRODUCT_DEFINITION('design','',#${formation},#${definitionContext})`)
    const shape = this.add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`)
    const millimetre = this.add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))')
    const radian = this.add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))')
    const steradian = this.add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())')
    const uncertainty = this.add(
      `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),#${millimetre},'distance_accuracy_value','')`,
    )
    const representationContext = this.add(
      `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${millimetre},#${radian},#${steradian}))REPRESENTATION_CONTEXT('',''))`,
    )
    const kind = items.every((item) => item.solid) ? 'ADVANCED_BREP_SHAPE_REPRESENTATION' : 'SHAPE_REPRESENTATION'
    const representation = this.add(
      `${kind}('',(${items.map((item) => `#${item.id}`).join(',')}),#${representationContext})`,
    )
    this.add(`SHAPE_DEFINITION_REPRESENTATION(#${shape},#${representation})`)
    return [
      'ISO-10303-21;',
      'HEADER;',
      "FILE_DESCRIPTION((''),'2;1');",
      `FILE_NAME(${text(name)},'',(''),(''),'','','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n')
  }
}

function clamped(mults: number[]) {
  return mults.map((m, i) => (i === 0 || i === mults.length - 1 ? m + 1 : m))
}

function determinant(m: number[]) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[3] * (m[1] * m[8] - m[2] * m[7]) + m[6] * (m[1] * m[5] - m[2] * m[4])
}
