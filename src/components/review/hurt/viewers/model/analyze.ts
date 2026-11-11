import { transferablesOf } from '../../core/workers'
import type { StepOrigin, UpAxis } from './stepHeader'

export const EDGE_CURVE = 0
export const EDGE_LINE = 1
export const EDGE_CIRCLE = 2
export const EDGE_ARC = 3

export interface EdgeSet {
  points: Float32Array
  offsets: Uint32Array
  kinds: Uint8Array
  circles: Float32Array
  corners: Float32Array
}

export interface ModelPart {
  name: string
  color: number | null
  position: Float32Array
  normal: Float32Array | null
  index: Uint32Array | null
  colors: Uint8Array | null
  uv?: Float32Array | null
  faces: Uint32Array | null
  edges: EdgeSet
  bounds: Float32Array
  triangles: number
  area: number
  volume: number
  matrix?: Float32Array | null
}

export interface ModelNode {
  name: string
  parts: number[]
  children: ModelNode[]
}

export type ModelUnit = 'mm' | 'cm' | 'm' | 'in' | 'unknown'

export interface ModelPreview {
  width: number
  height: number
  rgba: Uint8Array
}

export interface ModelData {
  parts: ModelPart[]
  root: ModelNode
  unit: ModelUnit
  upAxis: 'y' | 'z'
  warnings: string[]
  preview?: ModelPreview | null
  info?: { label: string; value: string }[]
  hidden?: number[]
  timeline?: ModelTimeline
}

export interface ModelTimeline {
  steps: string[]
  kinds: string[]
  times: (number | null)[]
  groups: { name: string; start: number; end: number }[]
  appear: (number | null)[]
  changed: number[][]
  keys?: string[]
}

export interface ModelHistory {
  parts: ModelPart[]
  appear: number[]
  until: (number | null)[]
  tools: number[]
  finals: Record<string, number>
}

export interface PartInput {
  name: string
  color: number | null
  position: Float32Array
  normal: Float32Array | null
  index: Uint32Array | null
  faces?: Uint32Array | null
  faceColors?: (number | null)[] | null
  colors?: Uint8Array | null
  uv?: Float32Array | null
}

export const DEFAULT_COLOR = 0xb6c0be
const FEATURE_ANGLE = Math.cos((30 * Math.PI) / 180)
const MAX_FEATURE_TRIANGLES = 3_000_000
const FLAT_NORMAL = 0.995
const UP_DOMINANCE = 2
const THIN_RATIO = 0.8

export function analyzePart(input: PartInput): ModelPart {
  const { position } = input
  const index = input.index ?? sequentialIndex(position.length / 3)
  const repaired = repairNonFinite(position, index)
  const stats = surfaceStats(position, index)
  const diagonal = Math.hypot(
    stats.bounds[3] - stats.bounds[0],
    stats.bounds[4] - stats.bounds[1],
    stats.bounds[5] - stats.bounds[2],
  )
  const weld = weldPositions(position, Math.max(diagonal * 1e-5, 1e-7))
  const triangles = index.length / 3
  const segments = input.faces
    ? faceBoundaries(index, input.faces, weld.ids, weld.count)
    : triangles <= MAX_FEATURE_TRIANGLES
      ? featureEdges(position, index, weld.ids, weld.count)
      : new Uint32Array(0)

  return {
    name: input.name,
    color: input.color,
    position,
    normal: input.normal,
    index: input.index ?? (repaired ? index : null),
    colors:
      input.colors ??
      faceVertexColors(position.length / 3, index, input.faces ?? null, input.faceColors ?? null, input.color),
    uv: input.uv ?? null,
    faces: input.faces ?? null,
    edges: buildChains(position, weld.representative, segments, diagonal),
    bounds: stats.bounds,
    triangles,
    area: stats.area,
    volume: stats.volume,
  }
}

function sequentialIndex(count: number) {
  const index = new Uint32Array(count)
  for (let i = 0; i < count; i++) index[i] = i
  return index
}

function repairNonFinite(position: Float32Array, index: Uint32Array) {
  let good = -1
  let bad: Uint8Array | null = null
  for (let i = 0; i < position.length; i += 3) {
    if (!Number.isFinite(position[i] + position[i + 1] + position[i + 2]))
      (bad ??= new Uint8Array(position.length / 3))[i / 3] = 1
    else if (good < 0) good = i / 3
  }
  if (!bad) return false
  for (let t = 0; t < index.length; t += 3)
    if (bad[index[t]] || bad[index[t + 1]] || bad[index[t + 2]]) index.fill(Math.max(good, 0), t, t + 3)
  for (let v = 0; v < bad.length; v++) {
    if (!bad[v]) continue
    if (good < 0) position.fill(0, v * 3, v * 3 + 3)
    else position.copyWithin(v * 3, good * 3, good * 3 + 3)
  }
  return true
}

function surfaceStats(position: Float32Array, index: Uint32Array) {
  const bounds = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
  for (let i = 0; i < position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = position[i + k]
      if (v < bounds[k]) bounds[k] = v
      if (v > bounds[k + 3]) bounds[k + 3] = v
    }
  }
  let area = 0
  let volume = 0
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3
    const b = index[t + 1] * 3
    const c = index[t + 2] * 3
    const ax = position[a],
      ay = position[a + 1],
      az = position[a + 2]
    const bx = position[b],
      by = position[b + 1],
      bz = position[b + 2]
    const cx = position[c],
      cy = position[c + 1],
      cz = position[c + 2]
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
  }
  if (!Number.isFinite(bounds[0])) bounds.fill(0)
  return { bounds, area, volume }
}

function weldPositions(position: Float32Array, tolerance: number) {
  const count = position.length / 3
  const inverse = 1 / tolerance
  let size = 1
  while (size < count * 2) size <<= 1
  const mask = size - 1
  const table = new Int32Array(size).fill(-1)
  const ids = new Uint32Array(count)
  const representative = new Uint32Array(count)
  let welded = 0
  for (let i = 0; i < count; i++) {
    const x = Math.round(position[i * 3] * inverse)
    const y = Math.round(position[i * 3 + 1] * inverse)
    const z = Math.round(position[i * 3 + 2] * inverse)
    let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask
    for (;;) {
      const id = table[slot]
      if (id < 0) {
        table[slot] = welded
        representative[welded] = i
        ids[i] = welded++
        break
      }
      const r = representative[id] * 3
      if (
        Math.round(position[r] * inverse) === x &&
        Math.round(position[r + 1] * inverse) === y &&
        Math.round(position[r + 2] * inverse) === z
      ) {
        ids[i] = id
        break
      }
      slot = (slot + 1) & mask
    }
  }
  return { ids, count: welded, representative: representative.subarray(0, welded) }
}

function faceBoundaries(index: Uint32Array, faces: Uint32Array, ids: Uint32Array, width: number) {
  const seen = new Set<number>()
  const out: number[] = []
  const local = new Map<number, number>()
  for (let f = 0; f < faces.length; f += 2) {
    local.clear()
    for (let t = faces[f]; t <= faces[f + 1]; t++) {
      for (let k = 0; k < 3; k++) {
        const a = ids[index[t * 3 + k]]
        const b = ids[index[t * 3 + ((k + 1) % 3)]]
        if (a === b) continue
        const key = a < b ? a * width + b : b * width + a
        local.set(key, (local.get(key) ?? 0) + 1)
      }
    }
    for (const [key, uses] of local) {
      if (uses !== 1 || seen.has(key)) continue
      seen.add(key)
      out.push(Math.floor(key / width), key % width)
    }
  }
  return Uint32Array.from(out)
}

function featureEdges(position: Float32Array, index: Uint32Array, ids: Uint32Array, width: number) {
  const triangles = index.length / 3
  const normals = new Float32Array(triangles * 3)
  for (let t = 0; t < triangles; t++) {
    const a = index[t * 3] * 3
    const b = index[t * 3 + 1] * 3
    const c = index[t * 3 + 2] * 3
    const ux = position[b] - position[a],
      uy = position[b + 1] - position[a + 1],
      uz = position[b + 2] - position[a + 2]
    const vx = position[c] - position[a],
      vy = position[c + 1] - position[a + 1],
      vz = position[c + 2] - position[a + 2]
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx
    const length = Math.hypot(nx, ny, nz) || 1
    normals[t * 3] = nx / length
    normals[t * 3 + 1] = ny / length
    normals[t * 3 + 2] = nz / length
  }
  const SMOOTH = -1
  const SHARP = -2
  const edges = new Map<number, number>()
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const a = ids[index[t * 3 + k]]
      const b = ids[index[t * 3 + ((k + 1) % 3)]]
      if (a === b) continue
      const key = a < b ? a * width + b : b * width + a
      const other = edges.get(key)
      if (other === undefined) {
        edges.set(key, t)
      } else if (other >= 0) {
        const dot =
          normals[t * 3] * normals[other * 3] +
          normals[t * 3 + 1] * normals[other * 3 + 1] +
          normals[t * 3 + 2] * normals[other * 3 + 2]
        edges.set(key, dot < FEATURE_ANGLE ? SHARP : SMOOTH)
      }
    }
  }
  const out: number[] = []
  for (const [key, state] of edges) {
    if (state !== SMOOTH) out.push(Math.floor(key / width), key % width)
  }
  return Uint32Array.from(out)
}

function faceVertexColors(
  vertexCount: number,
  index: Uint32Array,
  faces: Uint32Array | null,
  faceColors: (number | null)[] | null,
  base: number | null,
) {
  if (!faces || !faceColors || !faceColors.some((c) => c !== null && c !== base)) return null
  const colors = new Uint8Array(vertexCount * 3)
  const fill = base ?? DEFAULT_COLOR
  for (let v = 0; v < vertexCount; v++) writeColor(colors, v, fill)
  for (let f = 0; f < faceColors.length; f++) {
    const color = faceColors[f]
    if (color === null) continue
    for (let t = faces[f * 2]; t <= faces[f * 2 + 1]; t++)
      for (let k = 0; k < 3; k++) writeColor(colors, index[t * 3 + k], color)
  }
  return colors
}

export function writeColor(colors: Uint8Array, vertex: number, color: number) {
  colors[vertex * 3] = (color >> 16) & 255
  colors[vertex * 3 + 1] = (color >> 8) & 255
  colors[vertex * 3 + 2] = color & 255
}

function buildChains(
  position: Float32Array,
  representative: Uint32Array,
  segments: Uint32Array,
  diagonal: number,
): EdgeSet {
  const segmentCount = segments.length / 2
  const degree = new Map<number, number[]>()
  for (let s = 0; s < segmentCount; s++) {
    for (const node of [segments[s * 2], segments[s * 2 + 1]]) {
      const list = degree.get(node)
      if (list) list.push(s)
      else degree.set(node, [s])
    }
  }

  const used = new Uint8Array(segmentCount)
  const points: number[] = []
  const offsets: number[] = [0]
  const kinds: number[] = []
  const circles: number[] = []
  const corners: number[] = []
  const at = (node: number) => {
    const v = representative[node] * 3
    return [position[v], position[v + 1], position[v + 2]] as const
  }

  const walk = (start: number, first: number) => {
    const chain: number[] = [start]
    let node = start
    let segment = first
    for (;;) {
      used[segment] = 1
      const next = segments[segment * 2] === node ? segments[segment * 2 + 1] : segments[segment * 2]
      chain.push(next)
      node = next
      const links = degree.get(node)!
      if (links.length !== 2 || node === start) break
      const onward = links[0] === segment ? links[1] : links[0]
      if (used[onward]) break
      segment = onward
    }
    const flat = new Float32Array(chain.length * 3)
    chain.forEach((n, i) => flat.set(at(n), i * 3))
    const closed = chain[0] === chain[chain.length - 1]
    const shape = classifyChain(flat, closed, diagonal)
    for (let i = 0; i < flat.length; i++) points.push(flat[i])
    offsets.push(points.length / 3)
    kinds.push(shape.kind)
    circles.push(...shape.circle)
  }

  for (const [node, links] of degree) {
    if (links.length === 2) continue
    corners.push(...at(node))
    for (const s of links) if (!used[s]) walk(node, s)
  }
  for (let s = 0; s < segmentCount; s++) if (!used[s]) walk(segments[s * 2], s)

  return {
    points: Float32Array.from(points),
    offsets: Uint32Array.from(offsets),
    kinds: Uint8Array.from(kinds),
    circles: Float32Array.from(circles),
    corners: Float32Array.from(corners),
  }
}

const NO_CIRCLE = [NaN, NaN, NaN, NaN, NaN, NaN, NaN]

function classifyChain(p: Float32Array, closed: boolean, diagonal: number): { kind: number; circle: number[] } {
  const n = p.length / 3
  const tolerance = Math.max(diagonal * 1e-5, 1e-6)
  if (!closed && isStraight(p, tolerance)) return { kind: EDGE_LINE, circle: NO_CIRCLE }
  if (n < (closed ? 6 : 4)) return { kind: EDGE_CURVE, circle: NO_CIRCLE }
  const circle = circumcircle(p, 0, Math.floor(n / 3), Math.floor((2 * n) / 3))
  if (!circle) return { kind: EDGE_CURVE, circle: NO_CIRCLE }
  const [cx, cy, cz, nx, ny, nz, r] = circle
  const limit = Math.max(r * 2e-3, tolerance)
  let sweep = 0
  let px = p[0] - cx,
    py = p[1] - cy,
    pz = p[2] - cz
  for (let i = 0; i < n; i++) {
    const dx = p[i * 3] - cx,
      dy = p[i * 3 + 1] - cy,
      dz = p[i * 3 + 2] - cz
    if (Math.abs(Math.hypot(dx, dy, dz) - r) > limit || Math.abs(dx * nx + dy * ny + dz * nz) > limit) {
      return { kind: EDGE_CURVE, circle: NO_CIRCLE }
    }
    if (i > 0) sweep += Math.acos(Math.min(1, Math.max(-1, (dx * px + dy * py + dz * pz) / (r * r))))
    px = dx
    py = dy
    pz = dz
  }
  if (closed) return { kind: EDGE_CIRCLE, circle }
  return sweep > (10 * Math.PI) / 180 ? { kind: EDGE_ARC, circle } : { kind: EDGE_CURVE, circle: NO_CIRCLE }
}

function isStraight(p: Float32Array, tolerance: number) {
  const n = p.length / 3
  const dx = p[n * 3 - 3] - p[0],
    dy = p[n * 3 - 2] - p[1],
    dz = p[n * 3 - 1] - p[2]
  const length = Math.hypot(dx, dy, dz)
  if (length < tolerance) return false
  for (let i = 1; i < n - 1; i++) {
    const vx = p[i * 3] - p[0],
      vy = p[i * 3 + 1] - p[1],
      vz = p[i * 3 + 2] - p[2]
    const cross = Math.hypot(vy * dz - vz * dy, vz * dx - vx * dz, vx * dy - vy * dx) / length
    if (cross > tolerance * 10) return false
  }
  return true
}

function circumcircle(p: Float32Array, i0: number, i1: number, i2: number) {
  const ax = p[i1 * 3] - p[i0 * 3],
    ay = p[i1 * 3 + 1] - p[i0 * 3 + 1],
    az = p[i1 * 3 + 2] - p[i0 * 3 + 2]
  const bx = p[i2 * 3] - p[i0 * 3],
    by = p[i2 * 3 + 1] - p[i0 * 3 + 1],
    bz = p[i2 * 3 + 2] - p[i0 * 3 + 2]
  const wx = ay * bz - az * by,
    wy = az * bx - ax * bz,
    wz = ax * by - ay * bx
  const w2 = wx * wx + wy * wy + wz * wz
  if (w2 < 1e-18) return null
  const a2 = ax * ax + ay * ay + az * az
  const b2 = bx * bx + by * by + bz * bz
  const ux = (a2 * (by * wz - bz * wy) + b2 * (wy * az - wz * ay)) / (2 * w2)
  const uy = (a2 * (bz * wx - bx * wz) + b2 * (wz * ax - wx * az)) / (2 * w2)
  const uz = (a2 * (bx * wy - by * wx) + b2 * (wx * ay - wy * ax)) / (2 * w2)
  const w = Math.sqrt(w2)
  return [p[i0 * 3] + ux, p[i0 * 3 + 1] + uy, p[i0 * 3 + 2] + uz, wx / w, wy / w, wz / w, Math.hypot(ux, uy, uz)]
}

export function pruneTree(node: ModelNode, partCount: number): ModelNode | null {
  const children = node.children.map((c) => pruneTree(c, partCount)).filter((c): c is ModelNode => c !== null)
  const parts = node.parts.filter((p) => p >= 0 && p < partCount)
  if (parts.length === 0 && children.length === 0) return null
  if (parts.length === 0 && children.length === 1 && !node.name) return children[0]
  return { name: node.name, parts, children }
}

const METRES_HINT = 'The whole model is under 1 mm across, so it was probably exported in metres.'

function looksLikeMetres(parts: ModelPart[]) {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const { bounds } of parts)
    for (let k = 0; k < 3; k++) {
      box[k] = Math.min(box[k], bounds[k])
      box[k + 3] = Math.max(box[k + 3], bounds[k + 3])
    }
  const largest = Math.max(box[3] - box[0], box[4] - box[1], box[5] - box[2])
  return largest > 0 && largest < 1
}

export function uprightAxis(parts: ModelPart[], origin?: StepOrigin | null): UpAxis {
  if (origin?.fixed && origin.up) return origin.up
  const flat = [0, 0, 0]
  for (const { position, index, triangles } of parts)
    for (let t = 0; t < triangles; t++) {
      const a = (index ? index[t * 3] : t * 3) * 3
      const b = (index ? index[t * 3 + 1] : t * 3 + 1) * 3
      const c = (index ? index[t * 3 + 2] : t * 3 + 2) * 3
      const ux = position[b] - position[a],
        uy = position[b + 1] - position[a + 1],
        uz = position[b + 2] - position[a + 2]
      const vx = position[c] - position[a],
        vy = position[c + 1] - position[a + 1],
        vz = position[c + 2] - position[a + 2]
      const nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz)
      const limit = FLAT_NORMAL * length
      if (Math.abs(nx) >= limit) flat[0] += length
      else if (Math.abs(ny) >= limit) flat[1] += length
      else if (Math.abs(nz) >= limit) flat[2] += length
    }
  if (flat[1] > UP_DOMINANCE * Math.max(flat[0], flat[2])) return 'y'
  if (flat[2] > UP_DOMINANCE * Math.max(flat[0], flat[1])) return 'z'
  if (origin?.up) return origin.up
  const box = [Infinity, Infinity, -Infinity, -Infinity]
  for (const { bounds } of parts) {
    box[0] = Math.min(box[0], bounds[1])
    box[1] = Math.min(box[1], bounds[2])
    box[2] = Math.max(box[2], bounds[4])
    box[3] = Math.max(box[3], bounds[5])
  }
  return box[2] - box[0] < THIN_RATIO * (box[3] - box[1]) ? 'y' : 'z'
}

export function finishModel(
  parts: ModelPart[],
  root: ModelNode,
  data: Omit<ModelData, 'parts' | 'root'>,
  empty: string | null = 'This file has no surfaces to show.',
) {
  if (parts.length === 0 && empty !== null) throw new Error(empty)
  const tree = pruneTree(root, parts.length) ?? { name: '', parts: parts.map((_, i) => i), children: [] }
  const warnings = data.unit === 'unknown' && looksLikeMetres(parts) ? [...data.warnings, METRES_HINT] : data.warnings
  const model: ModelData = { ...data, warnings, parts, root: tree }
  return { result: model, transfer: transferablesOf(model) }
}

export function packColor(rgb: number[] | null | undefined) {
  if (!rgb || rgb.length < 3) return null
  return (Math.round(rgb[0] * 255) << 16) | (Math.round(rgb[1] * 255) << 8) | Math.round(rgb[2] * 255)
}
