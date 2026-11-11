import type { BSplineCurve, BSplineSurface, Vec } from './types'

const CORNER = Math.SQRT1_2
const CIRCLE = [
  [1, 0, 1],
  [1, 1, CORNER],
  [0, 1, 1],
  [-1, 1, CORNER],
  [-1, 0, 1],
  [-1, -1, CORNER],
  [0, -1, 1],
  [1, -1, CORNER],
  [1, 0, 1],
]

export function expand(knots: number[], mults: number[]) {
  const out: number[] = []
  knots.forEach((knot, i) => {
    const count = mults[i] + (i === 0 || i === knots.length - 1 ? 1 : 0)
    for (let k = 0; k < count; k++) out.push(knot)
  })
  return out
}

function span(knots: number[], degree: number, count: number, t: number) {
  const low = degree
  const high = count
  if (t <= knots[low]) return low
  if (t >= knots[high]) return high - 1
  let lo = low
  let hi = high
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (t < knots[mid]) hi = mid
    else lo = mid
  }
  return lo
}

function basis(knots: number[], degree: number, index: number, t: number) {
  const values = new Float64Array(degree + 1)
  const left = new Float64Array(degree + 1)
  const right = new Float64Array(degree + 1)
  values[0] = 1
  for (let j = 1; j <= degree; j++) {
    left[j] = t - knots[index + 1 - j]
    right[j] = knots[index + j] - t
    let saved = 0
    for (let r = 0; r < j; r++) {
      const denominator = right[r + 1] + left[j - r]
      const temp = denominator === 0 ? 0 : values[r] / denominator
      values[r] = saved + right[r + 1] * temp
      saved = left[j - r] * temp
    }
    values[j] = saved
  }
  return values
}

export function curveRange(curve: BSplineCurve): [number, number] {
  const knots = expand(curve.knots, curve.mults)
  const count = curve.points.length / (curve.rational ? 4 : 3)
  return [knots[curve.degree], knots[count]]
}

export function curvePoint(curve: BSplineCurve, t: number, dims = 3): number[] {
  const knots = expand(curve.knots, curve.mults)
  const stride = curve.rational ? dims + 1 : dims
  const count = curve.points.length / stride
  const index = span(knots, curve.degree, count, t)
  const values = basis(knots, curve.degree, index, t)
  const sum = new Array<number>(dims).fill(0)
  let weight = 0
  for (let j = 0; j <= curve.degree; j++) {
    const at = (index - curve.degree + j) * stride
    const w = curve.rational ? curve.points[at + dims] : 1
    for (let k = 0; k < dims; k++) sum[k] += values[j] * w * curve.points[at + k]
    weight += values[j] * w
  }
  return sum.map((v) => v / (weight || 1))
}

export function surfacePoint(surface: BSplineSurface, u: number, v: number): Vec {
  const uKnots = expand(surface.uKnots, surface.uMults)
  const vKnots = expand(surface.vKnots, surface.vMults)
  const uIndex = span(uKnots, surface.uDegree, surface.uCount, u)
  const vIndex = span(vKnots, surface.vDegree, surface.vCount, v)
  const uValues = basis(uKnots, surface.uDegree, uIndex, u)
  const vValues = basis(vKnots, surface.vDegree, vIndex, v)
  const stride = surface.rational ? 4 : 3
  const sum = [0, 0, 0]
  let weight = 0
  for (let j = 0; j <= surface.vDegree; j++)
    for (let i = 0; i <= surface.uDegree; i++) {
      const at = ((vIndex - surface.vDegree + j) * surface.uCount + uIndex - surface.uDegree + i) * stride
      const w = surface.rational ? surface.points[at + 3] : 1
      const factor = uValues[i] * vValues[j] * w
      for (let k = 0; k < 3; k++) sum[k] += factor * surface.points[at + k]
      weight += factor
    }
  return sum.map((value) => value / (weight || 1)) as Vec
}

export function polyline(points: Vec[]): BSplineCurve | null {
  const kept: Vec[] = []
  for (const point of points)
    if (kept.length === 0 || Math.hypot(...point.map((v, k) => v - kept[kept.length - 1][k])) > 0) kept.push(point)
  if (kept.length < 2) return null
  const knots = kept.map((_, i) => i)
  return {
    degree: 1,
    rational: false,
    closed: false,
    knots,
    mults: knots.map(() => 1),
    points: Float64Array.from(kept.flat()),
  }
}

const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const unit = (v: Vec): Vec => {
  const size = Math.hypot(...v) || 1
  return [v[0] / size, v[1] / size, v[2] / size]
}

export function pipe(spine: Vec[], radius: number): BSplineSurface | null {
  if (spine.length < 2 || !(radius > 0)) return null
  const tangents = spine.map((_, i) => {
    const a = spine[Math.max(0, i - 1)]
    const b = spine[Math.min(spine.length - 1, i + 1)]
    return unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]])
  })
  const reference: Vec = Math.abs(tangents[0][0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const normals: Vec[] = [unit(cross(tangents[0], reference))]
  for (let i = 1; i < spine.length; i++) {
    const v1 = spine[i].map((v, k) => v - spine[i - 1][k]) as Vec
    const c1 = dot(v1, v1)
    if (c1 === 0) {
      normals.push(normals[i - 1])
      continue
    }
    const previous = normals[i - 1]
    const left = previous.map((v, k) => v - (2 / c1) * dot(v1, previous) * v1[k]) as Vec
    const tangent = tangents[i - 1].map((v, k) => v - (2 / c1) * dot(v1, tangents[i - 1]) * v1[k]) as Vec
    const v2 = tangents[i].map((v, k) => v - tangent[k]) as Vec
    const c2 = dot(v2, v2)
    normals.push(unit(c2 === 0 ? left : (left.map((v, k) => v - (2 / c2) * dot(v2, left) * v2[k]) as Vec)))
  }
  const points = new Float64Array(spine.length * CIRCLE.length * 4)
  spine.forEach((centre, v) => {
    const normal = normals[v]
    const binormal = unit(cross(tangents[v], normal))
    CIRCLE.forEach(([x, y, w], u) => {
      const at = (v * CIRCLE.length + u) * 4
      for (let k = 0; k < 3; k++) points[at + k] = centre[k] + radius * (x * normal[k] + y * binormal[k])
      points[at + 3] = w
    })
  })
  const vKnots = spine.map((_, i) => i)
  return {
    uDegree: 2,
    vDegree: 1,
    rational: true,
    uClosed: false,
    vClosed: false,
    uKnots: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI],
    uMults: [2, 2, 2, 2, 2],
    vKnots,
    vMults: vKnots.map(() => 1),
    uCount: CIRCLE.length,
    vCount: spine.length,
    points,
  }
}
