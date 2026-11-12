import * as THREE from 'three'
import { EDGE_ARC, EDGE_CIRCLE, EDGE_LINE, type ModelPart, type ModelUnit } from './analyze'

export type Entity =
  | { type: 'point'; point: THREE.Vector3; via: 'vertex' | 'edge' | 'face' }
  | { type: 'circle'; center: THREE.Vector3; normal: THREE.Vector3; radius: number; arc: number | null }
  | { type: 'line'; a: THREE.Vector3; b: THREE.Vector3 }
  | { type: 'curve'; points: THREE.Vector3[]; length: number }
  | { type: 'face'; point: THREE.Vector3; area: number; normal: THREE.Vector3 | null }

export interface Reading {
  label: string
  value: string
}

export interface Measurement {
  entities: Entity[]
  anchors: THREE.Vector3[]
  primary: string
  readings: Reading[]
}

const SCALE: Record<ModelUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, unknown: 1 }
const significant = (value: number) => String(Number(value.toPrecision(3)))

export function formatLength(value: number, unit: ModelUnit) {
  const mm = value * SCALE[unit]
  const digits = Math.abs(mm) >= 100 ? 1 : Math.abs(mm) >= 1 ? 2 : 3
  return `${mm.toFixed(digits)} mm`
}

export function formatArea(value: number, unit: ModelUnit) {
  const mm2 = value * SCALE[unit] ** 2
  return mm2 >= 100 ? `${(mm2 / 100).toFixed(2)} cm²` : `${significant(mm2)} mm²`
}

export function formatVolume(value: number, unit: ModelUnit) {
  const mm3 = Math.abs(value) * SCALE[unit] ** 3
  return mm3 >= 1000 ? `${(mm3 / 1000).toFixed(2)} cm³` : `${significant(mm3)} mm³`
}

const degrees = (radians: number) => `${((radians * 180) / Math.PI).toFixed(2)}°`

function chainPoints(part: ModelPart, chain: number, matrix: THREE.Matrix4) {
  const { points, offsets } = part.edges
  const result: THREE.Vector3[] = []
  for (let i = offsets[chain]; i < offsets[chain + 1]; i++) {
    result.push(new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).applyMatrix4(matrix))
  }
  return result
}

export function edgeEntity(part: ModelPart, chain: number, matrix: THREE.Matrix4): Entity {
  const kind = part.edges.kinds[chain]
  const pts = chainPoints(part, chain, matrix)
  if (kind === EDGE_LINE) return { type: 'line', a: pts[0], b: pts[pts.length - 1] }
  if (kind === EDGE_CIRCLE || kind === EDGE_ARC) {
    const c = part.edges.circles.subarray(chain * 7, chain * 7 + 7)
    const center = new THREE.Vector3(c[0], c[1], c[2]).applyMatrix4(matrix)
    const normal = new THREE.Vector3(c[3], c[4], c[5]).transformDirection(matrix)
    const radius = c[6] * matrix.getMaxScaleOnAxis()
    let sweep = 0
    for (let i = 1; i < pts.length; i++) sweep += pts[i - 1].clone().sub(center).angleTo(pts[i].clone().sub(center))
    return { type: 'circle', center, normal, radius, arc: kind === EDGE_ARC ? sweep : null }
  }
  return { type: 'curve', points: pts, length: polylineLength(pts) }
}

export function faceEntity(part: ModelPart, face: number, point: THREE.Vector3, matrix: THREE.Matrix4): Entity {
  const position = part.position
  const index = part.index
  const faces = part.faces!
  const first = faces[face * 2]
  const last = faces[face * 2 + 1]
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const sum = new THREE.Vector3()
  let area = 0
  let reference: THREE.Vector3 | null = null
  let planar = true
  for (let t = first; t <= last; t++) {
    const ia = index ? index[t * 3] : t * 3
    const ib = index ? index[t * 3 + 1] : t * 3 + 1
    const ic = index ? index[t * 3 + 2] : t * 3 + 2
    a.fromArray(position, ia * 3)
    b.fromArray(position, ib * 3)
    c.fromArray(position, ic * 3)
    n.subVectors(b, a).cross(c.sub(a))
    const twice = n.length()
    if (twice < 1e-12) continue
    area += twice / 2
    sum.add(n)
    n.divideScalar(twice)
    if (!reference) reference = n.clone()
    else if (reference.dot(n) < 0.9999) planar = false
  }
  return {
    type: 'face',
    point,
    area: area * matrix.getMaxScaleOnAxis() ** 2,
    normal: planar && sum.lengthSq() > 0 ? sum.transformDirection(matrix) : null,
  }
}

export function faceOfTriangle(part: ModelPart, triangle: number) {
  const faces = part.faces
  if (!faces) return -1
  let lo = 0
  let hi = faces.length / 2 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (triangle < faces[mid * 2]) hi = mid - 1
    else if (triangle > faces[mid * 2 + 1]) lo = mid + 1
    else return mid
  }
  return -1
}

function polylineLength(points: THREE.Vector3[]) {
  let length = 0
  for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1])
  return length
}

function anchorOf(entity: Entity) {
  switch (entity.type) {
    case 'point':
    case 'face':
      return entity.point
    case 'circle':
      return entity.center
    case 'line':
      return entity.a.clone().add(entity.b).multiplyScalar(0.5)
    case 'curve':
      return entity.points[Math.floor(entity.points.length / 2)]
  }
}

export function describe(entity: Entity, unit: ModelUnit): { title: string; readings: Reading[] } {
  switch (entity.type) {
    case 'point':
      return {
        title: entity.via === 'vertex' ? 'Vertex' : entity.via === 'edge' ? 'Point on edge' : 'Point on face',
        readings: [{ label: 'Position', value: formatPoint(entity.point, unit) }],
      }
    case 'circle':
      return entity.arc === null
        ? {
            title: 'Circle',
            readings: [
              { label: 'Diameter', value: formatLength(entity.radius * 2, unit) },
              { label: 'Radius', value: formatLength(entity.radius, unit) },
              { label: 'Center', value: formatPoint(entity.center, unit) },
            ],
          }
        : {
            title: 'Arc',
            readings: [
              { label: 'Radius', value: formatLength(entity.radius, unit) },
              { label: 'Angle', value: degrees(entity.arc) },
              { label: 'Length', value: formatLength(entity.radius * entity.arc, unit) },
            ],
          }
    case 'line':
      return {
        title: 'Straight edge',
        readings: [{ label: 'Length', value: formatLength(entity.a.distanceTo(entity.b), unit) }],
      }
    case 'curve':
      return { title: 'Edge', readings: [{ label: 'Length', value: formatLength(entity.length, unit) }] }
    case 'face':
      return {
        title: entity.normal ? 'Flat face' : 'Face',
        readings: [
          { label: 'Area', value: formatArea(entity.area, unit) },
          ...(entity.normal ? [{ label: 'Normal', value: formatDirection(entity.normal) }] : []),
        ],
      }
  }
}

const PARALLEL = 0.0087

function lineDirection(e: Entity) {
  return e.type === 'line' ? e.b.clone().sub(e.a).normalize() : null
}

function planeNormal(e: Entity) {
  return e.type === 'face' || e.type === 'circle' ? e.normal : null
}

export function relate(first: Entity, second: Entity, unit: ModelUnit): Measurement {
  const a = anchorOf(first)
  const b = anchorOf(second)
  const ab = b.clone().sub(a)
  const readings: Reading[] = []
  let primary: string | null = null
  const add = (label: string, value: string, main = false) => {
    readings.push({ label, value })
    if (main && !primary) primary = value
  }

  const [la, lb] = [lineDirection(first), lineDirection(second)]
  const [na, nb] = [planeNormal(first), planeNormal(second)]

  if (first.type === 'circle' && second.type === 'circle') {
    add('Center to center', formatLength(ab.length(), unit), true)
  } else if (na && nb) {
    const angle = Math.acos(Math.min(1, Math.abs(na.dot(nb))))
    if (angle < PARALLEL) add('Distance between planes', formatLength(Math.abs(ab.dot(na)), unit), true)
    add('Angle between planes', degrees(angle), true)
  } else if (la && lb) {
    const angle = Math.acos(Math.min(1, Math.abs(la.dot(lb))))
    if (angle < PARALLEL)
      add(
        'Distance between lines',
        formatLength(
          ab
            .clone()
            .sub(la.clone().multiplyScalar(ab.dot(la)))
            .length(),
          unit,
        ),
        true,
      )
    add('Angle between lines', degrees(angle), true)
  } else if ((la && nb) || (lb && na)) {
    const line = (la ?? lb)!
    const normal = (na ?? nb)!
    const angle = Math.asin(Math.min(1, Math.abs(line.dot(normal))))
    if (angle < PARALLEL) add('Distance to plane', formatLength(Math.abs(ab.dot(normal)), unit), true)
    add('Angle to plane', degrees(angle), true)
  } else if (na || nb) {
    add('Distance to plane', formatLength(Math.abs(ab.dot((na ?? nb)!)), unit), true)
  } else if (la || lb) {
    const line = (la ?? lb)!
    add(
      'Distance to line',
      formatLength(
        ab
          .clone()
          .sub(line.clone().multiplyScalar(ab.dot(line)))
          .length(),
        unit,
      ),
      true,
    )
  }

  const distance = formatLength(ab.length(), unit)
  if (!(first.type === 'circle' && second.type === 'circle')) add('Point to point', distance)
  add('Δx', formatLength(Math.abs(ab.x), unit))
  add('Δy', formatLength(Math.abs(ab.y), unit))
  add('Δz', formatLength(Math.abs(ab.z), unit))
  return { entities: [first, second], anchors: [a, b], primary: primary ?? distance, readings }
}

export function single(entity: Entity, unit: ModelUnit): Measurement {
  const { readings } = describe(entity, unit)
  return { entities: [entity], anchors: [anchorOf(entity)], primary: readings[0].value, readings }
}

function formatPoint(p: THREE.Vector3, unit: ModelUnit) {
  const f = (v: number) => (v * SCALE[unit]).toFixed(2)
  return `${f(p.x)}, ${f(p.y)}, ${f(p.z)}`
}

function formatDirection(n: THREE.Vector3) {
  return `${n.x.toFixed(3)}, ${n.y.toFixed(3)}, ${n.z.toFixed(3)}`
}
