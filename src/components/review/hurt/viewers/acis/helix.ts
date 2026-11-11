import type { BSplineCurve, BSplineSurface, Vec } from '../brep/types'

export interface Helix {
  root: Vec
  major: Vec
  minor: Vec
  pitch: Vec
}

const STEP = Math.PI / 16
const MAX_POINTS = 50_000
const CORNER = Math.SQRT1_2
const CIRCLE = [
  [-1, 0, 1],
  [-1, -1, CORNER],
  [0, -1, 1],
  [1, -1, CORNER],
  [1, 0, 1],
  [1, 1, CORNER],
  [0, 1, 1],
  [-1, 1, CORNER],
  [-1, 0, 1],
]

function spacing(from: number, to: number) {
  const first = Math.floor(Math.min(from, to) / STEP) - 1
  const count = Math.min(MAX_POINTS, Math.ceil(Math.max(from, to) / STEP) - first + 2)
  return {
    first,
    count,
    knots: Array.from({ length: count + 2 }, (_, k) => (first + k - 1) * STEP),
  }
}

function row(helix: Helix, a: Vec, b: Vec, shift: Vec, first: number, count: number, out: number[]) {
  const scale = 3 / (2 + Math.cos(STEP))
  for (let i = 0; i < count; i++) {
    const angle = (first + i) * STEP
    const [c, s, turns] = [Math.cos(angle) * scale, Math.sin(angle) * scale, angle / (2 * Math.PI)]
    for (let k = 0; k < 3; k++) out.push(helix.root[k] + shift[k] + a[k] * c + b[k] * s + helix.pitch[k] * turns)
  }
}

export function helixCurve(helix: Helix, from: number, to: number): BSplineCurve {
  const { first, count, knots } = spacing(from, to)
  const points: number[] = []
  row(helix, helix.major, helix.minor, [0, 0, 0], first, count, points)
  return {
    degree: 3,
    rational: false,
    closed: false,
    knots,
    mults: knots.map(() => 1),
    points: Float64Array.from(points),
  }
}

export function helixCircleSurface(
  helix: Helix,
  axis: Vec,
  radius: number,
  [from, to]: [number, number],
): BSplineSurface {
  const { first, count, knots } = spacing(from, to)
  const scale = 3 / (2 + Math.cos(STEP))
  const length = Math.hypot(...helix.major)
  const centres: number[] = []
  row(helix, helix.major, helix.minor, [0, 0, 0], first, count, centres)
  const points = new Float64Array(count * CIRCLE.length * 4)
  for (let v = 0; v < count; v++) {
    const angle = (first + v) * STEP
    const [c, s] = [(Math.cos(angle) * scale) / length, (Math.sin(angle) * scale) / length]
    const inward = helix.major.map((m, k) => -(m * c + helix.minor[k] * s))
    CIRCLE.forEach(([x, y, w], u) => {
      const at = (v * CIRCLE.length + u) * 4
      for (let k = 0; k < 3; k++) points[at + k] = centres[v * 3 + k] + radius * (x * inward[k] + y * axis[k])
      points[at + 3] = w
    })
  }
  return {
    uDegree: 2,
    vDegree: 3,
    rational: true,
    uClosed: false,
    vClosed: false,
    uKnots: [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI],
    uMults: [2, 2, 2, 2, 2],
    vKnots: knots,
    vMults: knots.map(() => 1),
    uCount: CIRCLE.length,
    vCount: count,
    points,
  }
}

export function helixLineSurface(
  helix: Helix,
  axis: Vec,
  line: Vec,
  [u0, u1]: [number, number],
  [from, to]: [number, number],
): BSplineSurface {
  const { first, count, knots } = spacing(from, to)
  const rows: number[][] = []
  for (const u of [u0, u1]) {
    const radial = 1 + u * line[0]
    const twist = u * line[1]
    const a = helix.major.map((m, k) => radial * m + twist * helix.minor[k]) as Vec
    const b = helix.minor.map((m, k) => radial * m - twist * helix.major[k]) as Vec
    const points: number[] = []
    row(helix, a, b, axis.map((v) => v * u * line[2]) as Vec, first, count, points)
    rows.push(points)
  }
  const points = new Float64Array(count * 6)
  for (let v = 0; v < count; v++)
    for (let u = 0; u < 2; u++) points.set(rows[u].slice(v * 3, v * 3 + 3), (v * 2 + u) * 3)
  return {
    uDegree: 1,
    vDegree: 3,
    rational: false,
    uClosed: false,
    vClosed: false,
    uKnots: [u0, u1],
    uMults: [1, 1],
    vKnots: knots,
    vMults: knots.map(() => 1),
    uCount: 2,
    vCount: count,
    points,
  }
}
