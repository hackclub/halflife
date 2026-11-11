import { ShapeUtils, Vector2, Vector3 } from 'three'
import type { PartInput } from './analyze'

type Value = string | number | boolean | null | Ref | Value[]

interface Ref {
  ref: number
}

interface Entity {
  type: string
  raw: string
}

const STYLES = [
  'STYLED_ITEM',
  'PRESENTATION_STYLE_ASSIGNMENT',
  'SURFACE_STYLE_USAGE',
  'SURFACE_SIDE_STYLE',
  'SURFACE_STYLE_FILL_AREA',
  'FILL_AREA_STYLE',
  'FILL_AREA_STYLE_COLOUR',
  'COLOUR_RGB',
]
const TESSELLATED = new Set([
  'COORDINATES_LIST',
  'TRIANGULATED_FACE',
  'COMPLEX_TRIANGULATED_FACE',
  'TESSELLATED_SHELL',
  'TESSELLATED_SOLID',
  ...STYLES,
])
const FACETED = new Set([
  'SHELL_BASED_SURFACE_MODEL',
  'MANIFOLD_SOLID_BREP',
  'BREP_WITH_VOIDS',
  'OPEN_SHELL',
  'CLOSED_SHELL',
  'FACE_SURFACE',
  'ADVANCED_FACE',
  'FACE_OUTER_BOUND',
  'FACE_BOUND',
  'EDGE_LOOP',
  'POLY_LOOP',
  'ORIENTED_EDGE',
  'EDGE_CURVE',
  'VERTEX_POINT',
  'CARTESIAN_POINT',
  'PLANE',
  'LINE',
  ...STYLES,
])
const FACETED_BODY = /=\s*(?:SHELL_BASED_SURFACE_MODEL|MANIFOLD_SOLID_BREP|BREP_WITH_VOIDS)\s*\(/
const NOT_FACETED =
  /NEXT_ASSEMBLY_USAGE_OCCURRENCE|MAPPED_ITEM|B_SPLINE|BEZIER|CYLINDRICAL_SURFACE|CONICAL_SURFACE|SPHERICAL_SURFACE|TOROIDAL_SURFACE|SURFACE_OF_|OFFSET_SURFACE|SWEPT_SURFACE|CIRCLE|ELLIPSE|HYPERBOLA|PARABOLA|POLYLINE|TRIMMED_CURVE/
const FACETED_MIN_FACES = 2000
const FACETED_BODIES = new Set(['SHELL_BASED_SURFACE_MODEL', 'MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS'])
const STYLE_DEPTH = 8
const UNIT_SCALE: Record<string, number> = { '': 1000, MILLI: 1, CENTI: 10, DECI: 100, KILO: 1e6, MICRO: 0.001 }

export function hasTessellatedFaces(text: string) {
  return /=\s*(COMPLEX_)?TRIANGULATED_FACE\s*\(/.test(text)
}

function* statements(text: string) {
  const start = text.indexOf('DATA;')
  let from = start < 0 ? 0 : start + 5
  let quoted = false
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 39) quoted = !quoted
    else if (c === 59 && !quoted) {
      yield text.slice(from, i)
      from = i + 1
    }
  }
}

function readEntities(text: string, wanted: Set<string>) {
  const entities = new Map<number, Entity>()
  let lengthScale = 1000
  for (const statement of statements(text)) {
    const match = /^\s*#(\d+)\s*=\s*([A-Z_0-9]*)\s*\(/.exec(statement)
    if (!match) continue
    const type = match[2]
    if (!type && /LENGTH_UNIT/.test(statement)) {
      const si = /SI_UNIT\s*\(\s*(?:\.([A-Z]+)\.|\$)\s*,\s*\.METRE\.\s*\)/.exec(statement)
      if (si) lengthScale = UNIT_SCALE[si[1] ?? ''] ?? lengthScale
      else if (/INCH/i.test(statement)) lengthScale = 25.4
      else if (/FOOT/i.test(statement)) lengthScale = 304.8
      continue
    }
    if (wanted.has(type)) entities.set(Number(match[1]), { type, raw: statement.slice(match[0].length) })
  }
  return { entities, lengthScale }
}

function parseArgs(raw: string): Value[] {
  let at = 0
  const value = (): Value => {
    while (/\s/.test(raw[at])) at++
    const c = raw[at]
    if (c === '(') {
      at++
      const list: Value[] = []
      while (at < raw.length) {
        while (/[\s,]/.test(raw[at])) at++
        if (raw[at] === ')') {
          at++
          break
        }
        list.push(value())
      }
      return list
    }
    if (c === "'") {
      let end = at + 1
      while (end < raw.length && !(raw[end] === "'" && raw[end + 1] !== "'")) end += raw[end] === "'" ? 2 : 1
      const text = raw.slice(at + 1, end).replace(/''/g, "'")
      at = end + 1
      return text
    }
    if (c === '#') {
      const match = /^#(\d+)/.exec(raw.slice(at, at + 24))!
      at += match[0].length
      return { ref: Number(match[1]) }
    }
    const match = /^[^,()]+/.exec(raw.slice(at, at + 64))
    const token = match ? match[0].trim() : ''
    at += match ? match[0].length : 1
    if (raw[at] === '(') return value()
    if (token === '.T.' || token === '.F.') return token === '.T.'
    if (token === '$' || token === '*' || token.startsWith('.')) return null
    const number = Number(token)
    return Number.isFinite(number) ? number : null
  }
  const args: Value[] = []
  while (at < raw.length) {
    while (/[\s,]/.test(raw[at])) at++
    if (at >= raw.length || raw[at] === ')') break
    args.push(value())
  }
  return args
}

const isRef = (v: Value | undefined): v is Ref => typeof v === 'object' && v !== null && !Array.isArray(v)
const list = (v: Value | undefined) => (Array.isArray(v) ? v : [])
const numbers = (v: Value | undefined) => list(v).filter((n): n is number => typeof n === 'number')

function triangles(type: string, args: Value[]) {
  const out: number[] = []
  if (type === 'TRIANGULATED_FACE') {
    for (const tri of list(args[6])) out.push(...numbers(tri).slice(0, 3))
    return out
  }
  const push = (a: number, b: number, c: number) => {
    if (a !== b && b !== c && a !== c) out.push(a, b, c)
  }
  for (const strip of list(args[6])) {
    const v = numbers(strip)
    for (let i = 0; i + 2 < v.length; i++) i % 2 ? push(v[i + 1], v[i], v[i + 2]) : push(v[i], v[i + 1], v[i + 2])
  }
  for (const fan of list(args[7])) {
    const v = numbers(fan)
    for (let i = 1; i + 1 < v.length; i++) push(v[0], v[i], v[i + 1])
  }
  return out
}

function stepReader(text: string, wanted: Set<string>) {
  const { entities, lengthScale } = readEntities(text, wanted)
  const parsed = new Map<number, Value[]>()
  const args = (id: number) => {
    let found = parsed.get(id)
    if (!found) {
      const entity = entities.get(id)
      found = entity ? parseArgs(entity.raw) : []
      parsed.set(id, found)
    }
    return found
  }

  const colorOf = (id: number, depth = 0): number | null => {
    const entity = entities.get(id)
    if (!entity || depth > STYLE_DEPTH) return null
    const values = args(id)
    if (entity.type === 'COLOUR_RGB') {
      const [r, g, b] = values.slice(1).map((n) => Math.round(Math.min(1, Math.max(0, Number(n))) * 255))
      return (r << 16) | (g << 8) | b
    }
    const refs = values.flatMap(function collect(v): Ref[] {
      return isRef(v) ? [v] : Array.isArray(v) ? v.flatMap(collect) : []
    })
    for (const ref of refs) {
      const color = colorOf(ref.ref, depth + 1)
      if (color !== null) return color
    }
    return null
  }

  const styles = new Map<number, number>()
  for (const [id, entity] of entities) {
    if (entity.type !== 'STYLED_ITEM') continue
    const [, assignments, item] = args(id)
    if (!isRef(item) || styles.has(item.ref)) continue
    const color = list(assignments)
      .filter(isRef)
      .map((ref) => colorOf(ref.ref))
      .find((c) => c !== null)
    if (color != null) styles.set(item.ref, color)
  }
  return { entities, lengthScale, args, styles }
}

export function readTessellatedStep(text: string): PartInput[] {
  const { entities, lengthScale, args, styles } = stepReader(text, TESSELLATED)

  const faceMesh = (id: number) => {
    const entity = entities.get(id)
    if (!entity || !/TRIANGULATED_FACE$/.test(entity.type)) return null
    const values = args(id)
    const coordinates = isRef(values[1]) ? list(args(values[1].ref)[2]) : []
    const pnindex = numbers(values[5])
    const corners = triangles(entity.type, values)
    const point = (n: number) => numbers(coordinates[(pnindex.length ? pnindex[n - 1] : n) - 1])
    const position = new Float32Array(corners.length * 3)
    for (let i = 0; i < corners.length; i++) {
      const [x = 0, y = 0, z = 0] = point(corners[i])
      position.set([x * lengthScale, y * lengthScale, z * lengthScale], i * 3)
    }
    return position
  }

  const parts: PartInput[] = []
  const used = new Set<number>()
  const addPart = (name: string, faces: number[], color: number | null) => {
    const meshes = faces.map((face) => ({ face, position: faceMesh(face) })).filter((m) => m.position?.length)
    if (meshes.length === 0) return
    const position = new Float32Array(meshes.reduce((sum, m) => sum + m.position!.length, 0))
    const ranges: number[] = []
    const faceColors: (number | null)[] = []
    let at = 0
    for (const m of meshes) {
      position.set(m.position!, at)
      ranges.push(at / 9, (at + m.position!.length) / 9 - 1)
      faceColors.push(styles.get(m.face) ?? color)
      at += m.position!.length
    }
    const varied = faceColors.some((c) => c !== faceColors[0])
    parts.push({
      name,
      color: varied ? color : (faceColors[0] ?? color),
      position,
      normal: null,
      index: null,
      faces: varied ? Uint32Array.from(ranges) : null,
      faceColors: varied ? faceColors : null,
    })
  }

  for (const [id, entity] of entities) {
    if (entity.type !== 'TESSELLATED_SHELL' && entity.type !== 'TESSELLATED_SOLID') continue
    const [name, items] = args(id)
    const faces = list(items)
      .filter(isRef)
      .map((ref) => ref.ref)
    faces.forEach((face) => used.add(face))
    addPart(typeof name === 'string' && name ? name : `Body ${parts.length + 1}`, faces, styles.get(id) ?? null)
  }
  for (const [id, entity] of entities) {
    if (/TRIANGULATED_FACE$/.test(entity.type) && !used.has(id)) addPart(`Body ${parts.length + 1}`, [id], null)
  }
  return parts
}

export function isFacetedStep(text: string) {
  if (!FACETED_BODY.test(text) || NOT_FACETED.test(text)) return false
  const face = /=\s*(?:ADVANCED_FACE|FACE_SURFACE)\s*\(/g
  for (let count = 0; face.test(text); ) if (++count >= FACETED_MIN_FACES) return true
  return false
}

export function readFacetedStep(text: string): PartInput[] | null {
  const { entities, lengthScale, args, styles } = stepReader(text, FACETED)
  const typeOf = (v: Value | undefined) => (isRef(v) ? entities.get(v.ref)?.type : undefined)
  const pointOf = (v: Value | undefined) => {
    const p = isRef(v) && typeOf(v) === 'CARTESIAN_POINT' ? numbers(args(v.ref)[1]) : []
    return p.length === 3 ? new Vector3(p[0], p[1], p[2]).multiplyScalar(lengthScale) : null
  }

  const loopPoints = (loop: Value | undefined) => {
    if (!isRef(loop)) return null
    const values = args(loop.ref)
    if (typeOf(loop) === 'POLY_LOOP') {
      const points = list(values[1]).map(pointOf)
      return points.every((p) => p) ? (points as Vector3[]) : null
    }
    if (typeOf(loop) !== 'EDGE_LOOP') return null
    const points: Vector3[] = []
    for (const oriented of list(values[1])) {
      if (typeOf(oriented) !== 'ORIENTED_EDGE') return null
      const [, , , edge, forward] = args((oriented as Ref).ref)
      if (typeOf(edge) !== 'EDGE_CURVE') return null
      const [, start, end, curve] = args((edge as Ref).ref)
      const vertex = forward === false ? end : start
      if (typeOf(curve) !== 'LINE' || typeOf(vertex) !== 'VERTEX_POINT') return null
      const point = pointOf(args((vertex as Ref).ref)[1])
      if (!point) return null
      points.push(point)
    }
    return points
  }

  const faceTriangles = (face: Value | undefined, out: number[]) => {
    const type = typeOf(face)
    if (type !== 'FACE_SURFACE' && type !== 'ADVANCED_FACE') return false
    const [, bounds, surface] = args((face as Ref).ref)
    if (typeOf(surface) !== 'PLANE') return false
    const loops: Vector3[][] = []
    for (const bound of list(bounds)) {
      const boundType = typeOf(bound)
      if (boundType !== 'FACE_OUTER_BOUND' && boundType !== 'FACE_BOUND') return false
      const [, loop, sense] = args((bound as Ref).ref)
      const points = loopPoints(loop)
      if (!points) return false
      if (points.length > 1 && points[0].equals(points[points.length - 1])) points.pop()
      if (points.length < 3) continue
      if (sense === false) points.reverse()
      if (boundType === 'FACE_OUTER_BOUND') loops.unshift(points)
      else loops.push(points)
    }
    if (loops.length === 0) return true
    const push = (...points: Vector3[]) => points.forEach((p) => out.push(p.x, p.y, p.z))
    if (loops.length === 1 && loops[0].length === 3) {
      push(...loops[0])
      return true
    }
    const normal = new Vector3()
    const outer = loops[0]
    outer.forEach((p, i) => {
      const q = outer[(i + 1) % outer.length]
      normal.x += (p.y - q.y) * (p.z + q.z)
      normal.y += (p.z - q.z) * (p.x + q.x)
      normal.z += (p.x - q.x) * (p.y + q.y)
    })
    if (normal.lengthSq() === 0) return true
    normal.normalize()
    const u = new Vector3(1, 0, 0).cross(normal)
    if (u.lengthSq() < 1e-6) u.set(0, 1, 0).cross(normal)
    u.normalize()
    const v = normal.clone().cross(u)
    const flat = loops.map((loop) => loop.map((p) => new Vector2(p.dot(u), p.dot(v))))
    const all = loops.flat()
    const edgeA = new Vector3()
    const edgeB = new Vector3()
    for (const [a, b, c] of ShapeUtils.triangulateShape(flat[0], flat.slice(1))) {
      edgeA.subVectors(all[b], all[a])
      edgeB.subVectors(all[c], all[a])
      if (edgeA.cross(edgeB).dot(normal) < 0) push(all[a], all[c], all[b])
      else push(all[a], all[b], all[c])
    }
    return true
  }

  const bodies = [...entities].flatMap(([id, entity]) => {
    if (!FACETED_BODIES.has(entity.type)) return []
    const [name, first, voids] = args(id)
    return [{ id, name, shells: entity.type === 'SHELL_BASED_SURFACE_MODEL' ? list(first) : [first, ...list(voids)] }]
  })

  const parts: PartInput[] = []
  for (const { id, name: bodyName, shells } of bodies) {
    for (const shell of shells) {
      if (typeOf(shell) !== 'OPEN_SHELL' && typeOf(shell) !== 'CLOSED_SHELL') return null
      const [shellName, faces] = args((shell as Ref).ref)
      const color = styles.get((shell as Ref).ref) ?? styles.get(id) ?? null
      const out: number[] = []
      const ranges: number[] = []
      const faceColors: (number | null)[] = []
      for (const face of list(faces)) {
        const at = out.length
        if (!faceTriangles(face, out)) return null
        if (out.length === at) continue
        ranges.push(at / 9, out.length / 9 - 1)
        faceColors.push(styles.get((face as Ref).ref) ?? color)
      }
      if (out.length === 0) continue
      const varied = faceColors.some((c) => c !== faceColors[0])
      const name = [shellName, bodyName].find((n) => typeof n === 'string' && n) as string | undefined
      parts.push({
        name: name ?? `Body ${parts.length + 1}`,
        color: varied ? color : (faceColors[0] ?? color),
        position: Float32Array.from(out),
        normal: null,
        index: null,
        faces: varied ? Uint32Array.from(ranges) : null,
        faceColors: varied ? faceColors : null,
      })
    }
  }
  return parts.length ? parts : null
}
