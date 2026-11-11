import {
  analyzePart,
  DEFAULT_COLOR,
  finishModel,
  writeColor,
  type ModelNode,
  type ModelPart,
  type PartInput,
} from '../model/analyze'
import { Blend, parseHeader, unpack } from './dna'
import { readScene, type Matrix, type SceneObject } from './scene'

const RAW_LIMIT = 400 * 1024 * 1024
const MAX_TRIANGLES = 2_000_000
const MAX_DRAWN_TRIANGLES = 10_000_000
const SMOOTH = Math.cos((30 * Math.PI) / 180)
const MAX_CLUSTERS = 8
const SIMILAR = 1e-4
const BACKDROP = /backdrop|background|floor|ground|cyclorama|studio|seamless/i
const BACKDROP_TRIANGLES = 64
const FLAT = 0.01
const MAX_BACKDROPS = 16
const HUGE_METRES = 10
const BUNDLED_ASSETS = /[\\/]datafiles[\\/]assets[\\/]/i
const DAMAGED = "This .blend file is damaged or uses a layout the browser reader doesn't understand."

interface Template {
  part: ModelPart
  scale: number
}

export async function readBlend({ bytes }: Record<string, unknown>, progress: (message: string) => void) {
  try {
    return await read(new Uint8Array(bytes as ArrayBuffer), progress)
  } catch (error) {
    if (error instanceof Error && !(error instanceof TypeError || error instanceof RangeError)) throw error
    throw new Error(DAMAGED)
  }
}

async function open(bytes: Uint8Array, progress: (message: string) => void) {
  progress('Unpacking')
  const unpacked = await unpack(bytes, RAW_LIMIT).catch(() => {
    throw new Error("This .blend file's compressed data is damaged.")
  })
  const blend = new Blend(unpacked.data, parseHeader(unpacked.data), unpacked.compression, unpacked.truncated)
  const info = [{ label: 'Blender', value: blend.versionLabel }]
  const base = { unit: 'm' as const, upAxis: 'z' as const, preview: blend.thumbnail(), info }
  if (!blend.readable) return { base, scene: null }
  progress('Reading the scene')
  return { base, scene: readScene(blend, MAX_TRIANGLES * 2) }
}

async function read(bytes: Uint8Array, progress: (message: string) => void) {
  const { base, scene } = await open(bytes, progress)
  const { info } = base
  if (!scene)
    return finishModel(
      [],
      { name: '', parts: [], children: [] },
      { ...base, warnings: ['This file is too large to read its geometry in the browser.'] },
      null,
    )

  if (scene.scenes.length > 1) info.push({ label: 'Scene', value: `${scene.name} (${scene.scenes.length} in file)` })
  const libraries = new Set(
    scene.libraries.filter((l) => !BUNDLED_ASSETS.test(l)).map((l) => l.split(/[\\/]/).pop() ?? l),
  )
  if (libraries.size) info.push({ label: 'Linked files', value: [...libraries].join(', ') })

  const matrices = scene.objects.map((o) => o.matrix.map((v, i) => (i % 4 === 3 ? v : v * scene.scale)))
  const plan = planObjects(scene.objects, matrices)
  const parts: ModelPart[] = []
  const root: ModelNode = { name: '', parts: [], children: [] }
  const nodes = new Map<string, ModelNode>([['', root]])
  const nodeAt = (path: string[]) => {
    let node = root
    path.forEach((name, i) => {
      const key = path.slice(0, i + 1).join('\u0000')
      let child = nodes.get(key)
      if (!child) {
        child = { name, parts: [], children: [] }
        nodes.set(key, child)
        node.children.push(child)
      }
      node = child
    })
    return node
  }
  const templates = new Map<string, Template>()
  const total = plan.included.filter(Boolean).length
  scene.objects.forEach((object, i) => {
    if (!plan.included[i]) return
    if (parts.length % 25 === 0) progress(`Finding edges · ${parts.length} of ${total} parts`)
    nodeAt(object.path).parts.push(parts.length)
    const scale = plan.scales[i]
    if (scale === null || !plan.shared[i]) return parts.push(analyzePart(bake(object, matrices[i])))
    let template = templates.get(plan.keys[i])
    if (!template) {
      template = {
        part: analyzePart(bake(object, [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1])),
        scale,
      }
      templates.set(plan.keys[i], template)
    }
    parts.push(instance(template, object.name, matrices[i], scale))
  })

  const skipped = scene.skipped + plan.skipped
  const leftOut = (count: number, limit: string) =>
    count ? [`${count} ${count === 1 ? 'object was' : 'objects were'} left out to stay under ${limit}.`] : []
  const objects = scene.objects.filter((_, i) => plan.included[i])
  const backdrop = parts.map((p) => BACKDROP.test(p.name) || (p.triangles <= BACKDROP_TRIANGLES && isFlat(p.position)))
  const hidden = initiallyHidden(parts, objects, backdrop)
  const warnings = [
    ...(parts.length ? [] : ['No mesh in this scene has geometry to show.']),
    ...leftOut(skipped, `${MAX_TRIANGLES / 1e6} million triangles`),
    ...leftOut(plan.crowded, `${MAX_DRAWN_TRIANGLES / 1e6} million triangles on screen`),
    ...scene.warnings,
  ]
  const hiddenSet = new Set(hidden)
  const visible = boundsOf(parts, (i) => !hiddenSet.has(i) && !backdrop[i])
  if (visible && Math.max(visible[3] - visible[0], visible[4] - visible[1], visible[5] - visible[2]) > HUGE_METRES)
    warnings.push('This scene is over 10 m across, which usually means it was imported in millimetres as metres.')
  return finishModel(parts, hoistSingles(root), { ...base, warnings, hidden }, null)
}

function planObjects(objects: SceneObject[], matrices: Matrix[]) {
  const ids = new Map<SceneObject['mesh'], number>()
  const keys = objects.map((o) => {
    if (!ids.has(o.mesh)) ids.set(o.mesh, ids.size)
    return `${ids.get(o.mesh)}|${o.colors.join(',')}`
  })
  const scales = matrices.map(similarity)
  const uses = new Map<string, number>()
  keys.forEach((key, i) => {
    if (scales[i] !== null) uses.set(key, (uses.get(key) ?? 0) + 1)
  })
  const shared = keys.map((key, i) => scales[i] !== null && (uses.get(key) ?? 0) > 1)
  const size = objects.map((o, i) => diagonal(transformBox(o.mesh.bounds, matrices[i])))
  const order = objects
    .map((_, i) => i)
    .sort((a, b) => Number(objects[a].hidden) - Number(objects[b].hidden) || size[b] - size[a])
  const included = objects.map(() => false)
  const stored = new Set<string>()
  let unique = 0
  let drawn = 0
  let skipped = 0
  let crowded = 0
  for (const i of order) {
    const triangles = objects[i].mesh.index.length / 3
    const cost = shared[i] && stored.has(keys[i]) ? 0 : triangles
    if (unique + cost > MAX_TRIANGLES) skipped++
    else if (drawn + triangles > MAX_DRAWN_TRIANGLES) crowded++
    else {
      unique += cost
      drawn += triangles
      included[i] = true
      if (shared[i]) stored.add(keys[i])
    }
  }
  return { keys, scales, shared, included, skipped, crowded }
}

function similarity(m: Matrix) {
  if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) return null
  const column = (c: number) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]]
  const [a, b, c] = [column(0), column(1), column(2)]
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const scale = Math.sqrt(dot(a, a))
  if (!(scale > 0) || !Number.isFinite(scale)) return null
  const square = scale * scale
  const tolerance = SIMILAR * square
  if (Math.abs(dot(b, b) - square) > tolerance || Math.abs(dot(c, c) - square) > tolerance) return null
  if (Math.abs(dot(a, b)) > tolerance || Math.abs(dot(a, c)) > tolerance || Math.abs(dot(b, c)) > tolerance) return null
  return scale
}

function transformBox(box: number[], m: Matrix) {
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let corner = 0; corner < 8; corner++) {
    const x = box[corner & 1 ? 3 : 0]
    const y = box[corner & 2 ? 4 : 1]
    const z = box[corner & 4 ? 5 : 2]
    for (let k = 0; k < 3; k++) {
      const v = m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k]
      out[k] = Math.min(out[k], v)
      out[k + 3] = Math.max(out[k + 3], v)
    }
  }
  return out
}

function instance({ part, scale: baked }: Template, name: string, world: Matrix, scale: number): ModelPart {
  const m = world.map((v, i) => (i < 12 && i % 4 !== 3 ? v / baked : v))
  const relative = scale / baked
  const p = part.position
  const bounds = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = m[k] * p[i] + m[4 + k] * p[i + 1] + m[8 + k] * p[i + 2] + m[12 + k]
      if (v < bounds[k]) bounds[k] = v
      if (v > bounds[k + 3]) bounds[k + 3] = v
    }
  }
  return {
    ...part,
    name,
    matrix: Float32Array.from(m),
    bounds,
    area: part.area * relative ** 2,
    volume: part.volume * relative ** 3,
  }
}

function isFlat(p: Float32Array) {
  let normal: number[] | null = null
  let size = 0
  for (let i = 3; i < p.length; i += 3) size = Math.max(size, Math.hypot(p[i] - p[0], p[i + 1] - p[1], p[i + 2] - p[2]))
  for (let i = 0; i + 8 < p.length && !normal; i += 9) {
    const ux = p[i + 3] - p[i]
    const uy = p[i + 4] - p[i + 1]
    const uz = p[i + 5] - p[i + 2]
    const vx = p[i + 6] - p[i]
    const vy = p[i + 7] - p[i + 1]
    const vz = p[i + 8] - p[i + 2]
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    const length = Math.hypot(n[0], n[1], n[2])
    if (length > 0) normal = n.map((v) => v / length)
  }
  if (!normal) return true
  for (let i = 3; i < p.length; i += 3) {
    const distance = (p[i] - p[0]) * normal[0] + (p[i + 1] - p[1]) * normal[1] + (p[i + 2] - p[2]) * normal[2]
    if (Math.abs(distance) > size * FLAT) return false
  }
  return true
}

function boundsOf(parts: ModelPart[], include: (i: number) => boolean) {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  parts.forEach((p, i) => {
    if (!include(i)) return
    for (let k = 0; k < 3; k++) {
      box[k] = Math.min(box[k], p.bounds[k])
      box[k + 3] = Math.max(box[k + 3], p.bounds[k + 3])
    }
  })
  return Number.isFinite(box[0]) ? box : null
}

function diagonal(box: ArrayLike<number> | null) {
  return box ? Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2]) : 0
}

function hoistSingles(node: ModelNode): ModelNode {
  const parts = [...node.parts]
  const children: ModelNode[] = []
  for (const child of node.children.map(hoistSingles)) {
    if (child.children.length === 0 && child.parts.length === 1) parts.push(child.parts[0])
    else children.push(child)
  }
  return { name: node.name, parts, children }
}

function initiallyHidden(parts: ModelPart[], objects: SceneObject[], backdrop: boolean[]) {
  const hidden = new Set(objects.flatMap((o, i) => (o.hidden ? [i] : [])))
  const named = parts.map((p) => BACKDROP.test(p.name))
  const largest = parts
    .map((_, i) => i)
    .filter((i) => !hidden.has(i))
    .sort((a, b) => diagonal(parts[b].bounds) - diagonal(parts[a].bounds))
    .slice(0, MAX_BACKDROPS)
  for (const i of largest) {
    const others = (j: number) => j !== i && !hidden.has(j)
    const rest = diagonal(boundsOf(parts, (j) => others(j) && !backdrop[j])) || diagonal(boundsOf(parts, others))
    if (!rest) continue
    const ratio = diagonal(parts[i].bounds) / rest
    if (ratio > 10 || (named[i] && ratio > 1) || (backdrop[i] && ratio > 2)) hidden.add(i)
  }
  return hidden.size === parts.length ? [] : [...hidden]
}

function bake({ name, mesh, colors }: SceneObject, m: Matrix): PartInput {
  const flip =
    m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]) < 0
  const source = mesh.position
  const index = mesh.index
  const triangles = index.length / 3
  const vertexOf = new Uint32Array(index.length)
  for (let c = 0; c < index.length; c++) vertexOf[c] = index[flip && c % 3 ? (c % 3 === 1 ? c + 1 : c - 1) : c]
  const position = new Float32Array(triangles * 9)
  for (let c = 0; c < index.length; c++) {
    const v = vertexOf[c] * 3
    const x = source[v]
    const y = source[v + 1]
    const z = source[v + 2]
    position[c * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
    position[c * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
    position[c * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
  }
  const normal = smoothNormals(position, vertexOf, source.length / 3)

  const slot = (t: number) => Math.max(0, Math.min(mesh.material ? mesh.material[t] : 0, colors.length - 1))
  let mixed = false
  for (let t = 1; t < triangles && !mixed; t++) mixed = colors[slot(t)] !== colors[slot(0)]
  if (!mixed) return { name, color: colors[slot(0)] ?? null, position, normal, index: null }
  const vertexColors = new Uint8Array(triangles * 9)
  for (let t = 0; t < triangles; t++) {
    const color = colors[slot(t)] ?? DEFAULT_COLOR
    for (let k = 0; k < 3; k++) writeColor(vertexColors, t * 3 + k, color)
  }
  return { name, color: null, position, normal, index: null, colors: vertexColors }
}

function smoothNormals(position: Float32Array, vertexOf: Uint32Array, vertexCount: number) {
  const corners = vertexOf.length
  const face = new Float32Array(corners)
  const area = new Float32Array(corners / 3)
  for (let t = 0; t < corners / 3; t++) {
    const o = t * 9
    const ux = position[o + 3] - position[o]
    const uy = position[o + 4] - position[o + 1]
    const uz = position[o + 5] - position[o + 2]
    const vx = position[o + 6] - position[o]
    const vy = position[o + 7] - position[o + 1]
    const vz = position[o + 8] - position[o + 2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    area[t] = Math.hypot(nx, ny, nz)
    const scale = area[t] ? 1 / area[t] : 0
    face[t * 3] = nx * scale
    face[t * 3 + 1] = ny * scale
    face[t * 3 + 2] = nz * scale
  }

  const start = new Uint32Array(vertexCount + 1)
  for (let c = 0; c < corners; c++) start[vertexOf[c] + 1]++
  for (let v = 0; v < vertexCount; v++) start[v + 1] += start[v]
  const fill = start.slice(0, vertexCount)
  const order = new Uint32Array(corners)
  for (let c = 0; c < corners; c++) order[fill[vertexOf[c]]++] = c

  const normal = new Float32Array(corners * 3)
  const cluster = new Int8Array(corners)
  const sums = new Float64Array(MAX_CLUSTERS * 3)
  const reps: number[] = []
  for (let v = 0; v < vertexCount; v++) {
    reps.length = 0
    sums.fill(0)
    for (let j = start[v]; j < start[v + 1]; j++) {
      const c = order[j]
      const t = (c / 3) | 0
      let k = -1
      if (area[t]) {
        for (let r = 0; r < reps.length && k < 0; r++) {
          const f = reps[r] * 3
          if (face[t * 3] * face[f] + face[t * 3 + 1] * face[f + 1] + face[t * 3 + 2] * face[f + 2] >= SMOOTH) k = r
        }
        if (k < 0 && reps.length < MAX_CLUSTERS) k = reps.push(t) - 1
      }
      cluster[c] = k
      if (k < 0) continue
      sums[k * 3] += face[t * 3] * area[t]
      sums[k * 3 + 1] += face[t * 3 + 1] * area[t]
      sums[k * 3 + 2] += face[t * 3 + 2] * area[t]
    }
    for (let j = start[v]; j < start[v + 1]; j++) {
      const c = order[j]
      const k = cluster[c]
      const t = ((c / 3) | 0) * 3
      const length = k < 0 ? 0 : Math.hypot(sums[k * 3], sums[k * 3 + 1], sums[k * 3 + 2])
      normal[c * 3] = length ? sums[k * 3] / length : face[t]
      normal[c * 3 + 1] = length ? sums[k * 3 + 1] / length : face[t + 1]
      normal[c * 3 + 2] = length ? sums[k * 3 + 2] / length : face[t + 2]
    }
  }
  return normal
}
