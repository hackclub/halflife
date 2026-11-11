import type { Blend, Block, Ref } from './dna'

export type Matrix = number[]

export interface MeshGeometry {
  position: Float32Array
  index: Uint32Array
  material: Int32Array | null
  bounds: number[]
}

export interface SceneObject {
  name: string
  path: string[]
  mesh: MeshGeometry
  colors: (number | null)[]
  matrix: Matrix
  hidden: boolean
}

export interface SceneData {
  name: string
  scenes: string[]
  objects: SceneObject[]
  skipped: number
  warnings: string[]
  libraries: string[]
  scale: number
}

const OB_MESH = 1
const SHAPE_TYPES = new Set([2, 3, 4, 5, 27])
const OB_DUPLICOLLECTION = 1 << 8
const LAYER_COLLECTION_EXCLUDE = 1 << 4
const COLLECTION_HIDE_VIEWPORT = 1 << 0
const OB_HIDE_VIEWPORT = 1 << 0
const BASE_HIDDEN = 1 << 8
const CD_MVERT = 0
const CD_MPOLY = 25
const CD_MLOOP = 26
const MAX_INSTANCE_DEPTH = 8
const MAX_PARENT_DEPTH = 64
const MAX_OBJECTS = 20_000
const MAX_VISITS = 200_000
const MAX_LAYERS = 4096
const MAX_SLOTS = 256
const MAX_EAR_CLIP = 256

export function readScene(blend: Blend, readLimit: number): SceneData {
  const warnings = new Set<string>()
  const objects = new Map<bigint, Ref>()
  for (const ob of blend.ids('OB')) objects.set(ob.block.old, ob)

  const glob = blend.ref(blend.blocks.find((b) => b.code === 'GLOB'))
  const scenes = blend.ids('SC')
  const scene = glob?.at('curscene', 'Scene') ?? scenes[0]
  if (!scene) throw new Error('This .blend file has no scene in it.')

  const meshes = new Map<number, MeshGeometry | null>()
  const contents = new Map<string, MeshGeometry[]>()
  const linked = new Set<string>()
  let read = 0
  const distinct = (mesh: MeshGeometry) => {
    const key = `${hashWords(mesh.position)}|${hashWords(mesh.index)}`
    const list = contents.get(key) ?? []
    const same = list.find(
      (m) =>
        sameWords(m.position, mesh.position) &&
        sameWords(m.index, mesh.index) &&
        (m.material === mesh.material || (!!m.material && !!mesh.material && sameWords(m.material, mesh.material))),
    )
    if (same) return same
    contents.set(key, [...list, mesh])
    read += mesh.index.length / 3
    return mesh
  }
  const readMesh = (ob: Ref) => {
    const block = ob.target('data')
    if (!block) return null
    if (meshes.has(block.index)) return meshes.get(block.index)!
    let mesh: MeshGeometry | null = null
    if (block.code === 'ME') {
      const ref = blend.ref(block, 'Mesh')
      try {
        mesh = ref && meshGeometry(blend, ref)
      } catch {
        warnings.add(ref?.idName ? `The mesh ${ref.idName} could not be read.` : 'A mesh could not be read.')
      }
    } else if (block.code === 'ID') {
      linked.add(blend.ref(block, 'ID')?.str('name').slice(2) ?? '')
    }
    if (mesh) mesh = distinct(mesh)
    meshes.set(block.index, mesh)
    return mesh
  }

  const worlds = new Map<bigint, Matrix>()
  const world = (pointer: bigint, depth = 0): Matrix => {
    const cached = worlds.get(pointer)
    if (cached) return cached
    const ob = objects.get(pointer)
    let matrix = IDENTITY
    if (ob) {
      if (ob.has('obmat')) matrix = ob.floats('obmat')
      else {
        matrix = localMatrix(ob)
        const parent = ob.ptr('parent')
        if (parent && depth < MAX_PARENT_DEPTH && objects.has(parent))
          matrix = multiply(multiply(world(parent, depth + 1), ob.floats('parentinv', IDENTITY)), matrix)
      }
    }
    worlds.set(pointer, matrix)
    return matrix
  }

  const excluded = new Set<bigint>()
  const eyeHidden = new Set<bigint>()
  const layer = scene.list('view_layers', 'ViewLayer', 1)[0]
  if (layer) {
    const walked = new Set<number>()
    const walk = (lc: Ref, depth: number) => {
      if (walked.has(lc.base)) return
      walked.add(lc.base)
      if (lc.int('flag') & LAYER_COLLECTION_EXCLUDE) excluded.add(lc.ptr('collection'))
      if (depth < 64) for (const child of lc.list('layer_collections', 'LayerCollection')) walk(child, depth + 1)
    }
    for (const lc of layer.list('layer_collections', 'LayerCollection')) walk(lc, 0)
    for (const base of layer.list('object_bases', 'Base', MAX_OBJECTS))
      if (base.int('flag') & BASE_HIDDEN) eyeHidden.add(base.ptr('object'))
  }

  const candidates: { ob: Ref; matrix: Matrix; path: string[]; hidden: boolean }[] = []
  const placed = new Set<bigint>()
  let shapes = 0
  let modified = 0
  let visits = 0
  const addObject = (pointer: bigint, outer: Matrix | null, depth: number, path: string[]) => {
    const ob = objects.get(pointer)
    if (!ob || candidates.length >= MAX_OBJECTS || ++visits > MAX_VISITS) return
    if (ob.int('restrictflag') & OB_HIDE_VIEWPORT) return
    if (depth === 0) {
      if (placed.has(pointer)) return
      placed.add(pointer)
    }
    const matrix = outer ? multiply(outer, world(pointer)) : world(pointer)
    const hidden = depth === 0 && eyeHidden.has(pointer)
    const type = ob.int('type')
    if (type === OB_MESH) {
      candidates.push({ ob, matrix, path, hidden })
      if (!hidden && ob.sub('modifiers', 'ListBase')?.ptr('first')) modified++
    } else if (SHAPE_TYPES.has(type) && !hidden) shapes++
    if (ob.int('transflag') & OB_DUPLICOLLECTION && depth < MAX_INSTANCE_DEPTH) {
      const collection = ob.at('dup_group', 'Collection')
      if (collection) {
        const offset = collection.floats('dupli_ofs', [0, 0, 0])
        addCollection(collection, multiply(matrix, translation(-offset[0], -offset[1], -offset[2])), depth + 1, [
          ...path,
          ob.idName,
        ])
      }
    }
  }
  const addCollection = (
    collection: Ref,
    matrix: Matrix | null,
    depth: number,
    path: string[],
    seen = new Set<number>(),
  ) => {
    if (seen.has(collection.base) || seen.size > 4096 || visits > MAX_VISITS) return
    seen.add(collection.base)
    if (collection.int('flag') & COLLECTION_HIDE_VIEWPORT) return
    for (const item of collection.list('gobject', 'CollectionObject', MAX_OBJECTS))
      addObject(item.ptr('ob'), matrix, depth, path)
    for (const item of collection.list('children', 'CollectionChild')) {
      const pointer = item.ptr('collection')
      if (depth === 0 && excluded.has(pointer)) continue
      const child = blend.ref(blend.resolve(pointer, item.block), 'Collection')
      if (child) addCollection(child, matrix, depth, [...path, child.idName], seen)
    }
  }

  const master = scene.at('master_collection', 'Collection')
  if (master) addCollection(master, null, 0, [])
  else for (const base of scene.list('base', 'Base', MAX_OBJECTS)) addObject(base.ptr('object'), null, 0, [])

  const result: SceneObject[] = []
  let skipped = 0
  for (const candidate of [...candidates.filter((c) => !c.hidden), ...candidates.filter((c) => c.hidden)]) {
    const block = candidate.ob.target('data')
    const fresh = block !== undefined && !meshes.has(block.index)
    if (fresh && read > readLimit) {
      skipped++
      continue
    }
    const mesh = readMesh(candidate.ob)
    if (!mesh || mesh.index.length === 0) continue
    const meshRef = blend.ref(candidate.ob.target('data'), 'Mesh')!
    const slots = Math.max(1, Math.min(Math.max(meshRef.int('totcol'), candidate.ob.int('totcol')), MAX_SLOTS))
    result.push({
      name: candidate.ob.idName,
      path: candidate.path,
      mesh,
      colors: Array.from({ length: slots }, (_, i) => materialOf(blend, candidate.ob, meshRef, i)),
      matrix: candidate.matrix,
      hidden: candidate.hidden,
    })
  }

  if (modified) warnings.add("Modifiers and geometry nodes aren't applied, so this shows the base meshes.")
  if (shapes)
    warnings.add(`${shapes} curve, surface, text or metaball ${shapes === 1 ? 'object is' : 'objects are'} not shown.`)
  if (linked.size)
    warnings.add(
      `${linked.size} ${linked.size === 1 ? 'mesh is' : 'meshes are'} linked from another .blend file and not shown.`,
    )

  const unit = scene.sub('unit', 'UnitSettings')
  const scale = unit?.float('scale_length') || 1
  return {
    name: scene.idName,
    scenes: scenes.map((s) => s.idName),
    objects: result,
    skipped,
    warnings: [...warnings],
    libraries: blend.ids('LI').map((l) => l.str('filepath') || l.str('name')),
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  }
}

function words(array: Float32Array | Int32Array | Uint32Array) {
  return new Uint32Array(array.buffer, array.byteOffset, array.length)
}

function hashWords(array: Float32Array | Int32Array | Uint32Array) {
  const view = words(array)
  let hash = 0x811c9dc5 ^ view.length
  for (let i = 0; i < view.length; i++) hash = Math.imul(hash ^ view[i], 0x01000193)
  return hash >>> 0
}

function sameWords(a: Float32Array | Int32Array | Uint32Array, b: Float32Array | Int32Array | Uint32Array) {
  if (a.length !== b.length) return false
  const x = words(a)
  const y = words(b)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}

interface Layer {
  type: number
  name: string
  data: Block | undefined
}

function customData(blend: Blend, mesh: Ref, field: string): Layer[] {
  const data = mesh.sub(field, 'CustomData')
  if (!data) return []
  const count = Math.min(data.int('totlayer'), MAX_LAYERS)
  const layers = blend.array(data.target('layers'), 'CustomDataLayer', count)
  if (!layers) return []
  return Array.from({ length: count }, (_, i) => {
    const layer = layers.at(i)
    return { type: layer.int('type'), name: layer.str('name'), data: layer.target('data') }
  })
}

function attributeStorage(blend: Blend, mesh: Ref): { name: string; data: Block | undefined }[] {
  const storage = mesh.sub('attribute_storage', 'AttributeStorage')
  if (!storage) return []
  const count = Math.min(storage.int('dna_attributes_num'), MAX_LAYERS)
  const list = blend.array(storage.target('dna_attributes'), 'Attribute', count)
  if (!list) return []
  return Array.from({ length: count }, (_, i) => {
    const attribute = list.at(i)
    const name = attribute.target('name')
    const holder = attribute.at('data', attribute.int('storage_type') === 0 ? 'AttributeArray' : 'AttributeSingle')
    return { name: name ? blend.cString(name.start, name.len) : '', data: holder?.target('data') }
  })
}

function meshGeometry(blend: Blend, mesh: Ref): MeshGeometry | null {
  const vertices = mesh.int('totvert')
  const polygons = mesh.int('totpoly')
  const loops = mesh.int('totloop')
  if (vertices <= 0) return null
  const attributes = attributeStorage(blend, mesh)
  const vdata = customData(blend, mesh, 'vdata')
  const ldata = customData(blend, mesh, 'ldata')
  const pdata = customData(blend, mesh, 'pdata')
  const named = (name: string, layers: Layer[]) =>
    attributes.find((a) => a.name === name)?.data ?? layers.find((l) => l.name === name)?.data

  let position = blend.floats(named('position', vdata), vertices * 3)
  if (!position) {
    const legacy = blend.array(vdata.find((l) => l.type === CD_MVERT)?.data ?? mesh.target('mvert'), 'MVert', vertices)
    const co = legacy?.def.fields.get('co')
    if (legacy && co) {
      position = new Float32Array(vertices * 3)
      for (let i = 0; i < vertices; i++)
        for (let k = 0; k < 3; k++)
          position[i * 3 + k] = blend.view.getFloat32(
            legacy.block.start + i * legacy.stride + co.offset + k * 4,
            blend.header.little,
          )
    }
  }
  if (!position) throw new Error('No vertex positions')

  let offsets: Int32Array | null = null
  let corners: Int32Array | null = null
  let faceMaterial: Int32Array | null = null
  if (polygons > 0 && loops > 0) {
    const off = blend.ints(mesh.target('poly_offset_indices'), polygons + 1)
    const cv = blend.ints(named('.corner_vert', ldata), loops)
    if (off && cv) {
      offsets = off
      corners = cv
    } else {
      const polys = blend.array(pdata.find((l) => l.type === CD_MPOLY)?.data ?? mesh.target('mpoly'), 'MPoly', polygons)
      const loopList = blend.array(ldata.find((l) => l.type === CD_MLOOP)?.data ?? mesh.target('mloop'), 'MLoop', loops)
      const starts = polys?.column('loopstart')
      corners = loopList?.column('v') ?? null
      if (starts && corners) {
        offsets = new Int32Array(polygons + 1)
        offsets.set(starts)
        offsets[polygons] = loops
        faceMaterial = polys!.column('mat_nr')
      }
    }
    faceMaterial ??= blend.ints(named('material_index', pdata), polygons)
  }
  if (!offsets && mesh.int('totface') > 0) {
    const faces = blend.array(mesh.target('mface'), 'MFace', mesh.int('totface'))
    if (faces) {
      const count = mesh.int('totface')
      offsets = new Int32Array(count + 1)
      corners = new Int32Array(count * 4)
      faceMaterial = new Int32Array(count)
      let n = 0
      for (let i = 0; i < count; i++) {
        const face = faces.at(i)
        offsets[i] = n
        corners[n++] = face.int('v1')
        corners[n++] = face.int('v2')
        corners[n++] = face.int('v3')
        if (face.int('v4')) corners[n++] = face.int('v4')
        faceMaterial[i] = face.int('mat_nr')
      }
      offsets[count] = n
    }
  }
  if (!offsets || !corners) return null

  const faces = offsets.length - 1
  let total = 0
  for (let f = 0; f < faces; f++) {
    if (offsets[f] < 0 || offsets[f + 1] < offsets[f] || offsets[f + 1] > corners.length)
      throw new Error('Damaged face offsets')
    if (offsets[f + 1] - offsets[f] >= 3) total += offsets[f + 1] - offsets[f] - 2
  }
  const index = new Uint32Array(total * 3)
  const triangleMaterial = faceMaterial ? new Int32Array(total) : null
  let t = 0
  const emit = (a: number, b: number, c: number, face: number) => {
    if (triangleMaterial) triangleMaterial[t / 3] = faceMaterial![face]
    index[t++] = a
    index[t++] = b
    index[t++] = c
  }
  for (let f = 0; f < faces; f++) {
    const polygon = corners.subarray(offsets[f], offsets[f + 1])
    if (polygon.length < 3 || polygon.some((v) => v < 0 || v >= vertices)) continue
    triangulate(position, polygon, (a, b, c) => emit(a, b, c, f))
  }
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < position.length; i += 3)
    for (let k = 0; k < 3; k++) {
      bounds[k] = Math.min(bounds[k], position[i + k])
      bounds[k + 3] = Math.max(bounds[k + 3], position[i + k])
    }
  return {
    position,
    index: t === index.length ? index : index.slice(0, t),
    material: t === index.length ? triangleMaterial : (triangleMaterial?.slice(0, t / 3) ?? null),
    bounds,
  }
}

function triangulate(position: Float32Array, polygon: Int32Array, emit: (a: number, b: number, c: number) => void) {
  const n = polygon.length
  const fan = () => {
    for (let k = 1; k + 1 < n; k++) emit(polygon[0], polygon[k], polygon[k + 1])
  }
  if (n === 3 || n > MAX_EAR_CLIP) return fan()

  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < n; i++) {
    const a = polygon[i] * 3
    const b = polygon[(i + 1) % n] * 3
    nx += (position[a + 1] - position[b + 1]) * (position[a + 2] + position[b + 2])
    ny += (position[a + 2] - position[b + 2]) * (position[a] + position[b])
    nz += (position[a] - position[b]) * (position[a + 1] + position[b + 1])
  }
  const ax = Math.abs(nx)
  const ay = Math.abs(ny)
  const az = Math.abs(nz)
  const [u, v, sign] = az >= ax && az >= ay ? [0, 1, nz] : ax >= ay ? [1, 2, nx] : [2, 0, ny]
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = position[polygon[i] * 3 + u]
    ys[i] = position[polygon[i] * 3 + v] * (sign < 0 ? -1 : 1)
  }
  const cross = (a: number, b: number, c: number) =>
    (xs[b] - xs[a]) * (ys[c] - ys[b]) - (ys[b] - ys[a]) * (xs[c] - xs[b])

  let convex = true
  for (let i = 0; i < n && convex; i++) convex = cross(i, (i + 1) % n, (i + 2) % n) >= 0
  if (convex) return fan()

  const next = Int32Array.from({ length: n }, (_, i) => (i + 1) % n)
  const prev = Int32Array.from({ length: n }, (_, i) => (i + n - 1) % n)
  const inside = (p: number, a: number, b: number, c: number) =>
    (xs[b] - xs[a]) * (ys[p] - ys[a]) - (ys[b] - ys[a]) * (xs[p] - xs[a]) >= 0 &&
    (xs[c] - xs[b]) * (ys[p] - ys[b]) - (ys[c] - ys[b]) * (xs[p] - xs[b]) >= 0 &&
    (xs[a] - xs[c]) * (ys[p] - ys[c]) - (ys[a] - ys[c]) * (xs[p] - xs[c]) >= 0
  let remaining = n
  let current = 0
  let misses = 0
  while (remaining > 3) {
    const a = prev[current]
    const c = next[current]
    let ear = cross(a, current, c) > 0
    for (let p = next[c]; ear && p !== a; p = next[p]) ear = !inside(p, a, current, c)
    if (ear || misses >= remaining) {
      emit(polygon[a], polygon[current], polygon[c])
      next[a] = c
      prev[c] = a
      remaining--
      current = c
      misses = 0
    } else {
      current = c
      misses++
    }
  }
  emit(polygon[prev[current]], polygon[current], polygon[next[current]])
}

const materialColors = new WeakMap<Blend, Map<number, number>>()

function materialOf(blend: Blend, ob: Ref, mesh: Ref, slot: number) {
  let pointer = 0n
  let from = mesh.block
  const own = blend.resolve(ob.ptr('mat'), ob.block)
  if (
    own &&
    slot < ob.int('totcol') &&
    own.len >= (slot + 1) * blend.header.pointerSize &&
    objectSlot(blend, ob, slot)
  ) {
    pointer = blend.pointerAt(own.start + slot * blend.header.pointerSize)
    from = own
  } else {
    const list = mesh.target('mat')
    if (list && list.len >= (slot + 1) * blend.header.pointerSize)
      pointer = blend.pointerAt(list.start + slot * blend.header.pointerSize)
    from = list ?? mesh.block
  }
  const material = blend.ref(blend.resolve(pointer, from), 'Material')
  if (!material) return null
  const cache = materialColors.get(blend) ?? new Map<number, number>()
  materialColors.set(blend, cache)
  if (!cache.has(material.base)) cache.set(material.base, materialColor(blend, material))
  return cache.get(material.base)!
}

function objectSlot(blend: Blend, ob: Ref, slot: number) {
  const bits = ob.target('matbits')
  return bits !== undefined && slot < bits.len && blend.data[bits.start + slot] !== 0
}

function materialColor(blend: Blend, material: Ref) {
  let rgb = [material.float('r'), material.float('g'), material.float('b')]
  const tree = material.at('nodetree', 'bNodeTree')
  if (tree && (!material.has('use_nodes') || material.int('use_nodes'))) {
    for (const node of tree.list('nodes', 'bNode', 2000)) {
      const kind = node.str('idname')
      if (kind !== 'ShaderNodeBsdfPrincipled' && kind !== 'ShaderNodeBsdfDiffuse') continue
      const socket = node
        .list('inputs', 'bNodeSocket', 200)
        .find((s) => s.str('identifier') === 'Base Color' || s.str('identifier') === 'Color')
      const link = socket?.ptr('link') ? socket.at('link', 'bNodeLink') : null
      const input = !link
        ? socket
        : link.at('fromnode', 'bNode')?.str('idname') === 'ShaderNodeRGB'
          ? link.at('fromsock', 'bNodeSocket')
          : null
      const value = input?.at('default_value', 'bNodeSocketValueRGBA')
      if (value) rgb = value.floats('value').slice(0, 3)
      break
    }
  }
  return (srgb(rgb[0]) << 16) | (srgb(rgb[1]) << 8) | srgb(rgb[2])
}

function srgb(linear: number) {
  const value = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055
  return Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value * 255))) : 0
}

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function translation(x: number, y: number, z: number): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}

function multiply3(a: number[], b: number[]) {
  const out = new Array<number>(9).fill(0)
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) out[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k]
  return out
}

const EULER_ORDERS = ['XYZ', 'XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX']

function eulerMatrix([x, y, z]: number[], mode: number) {
  const axes: Record<string, number[]> = {
    X: [1, 0, 0, 0, Math.cos(x), Math.sin(x), 0, -Math.sin(x), Math.cos(x)],
    Y: [Math.cos(y), 0, -Math.sin(y), 0, 1, 0, Math.sin(y), 0, Math.cos(y)],
    Z: [Math.cos(z), Math.sin(z), 0, -Math.sin(z), Math.cos(z), 0, 0, 0, 1],
  }
  const order = EULER_ORDERS[mode] ?? 'XYZ'
  let m = axes[order[0]]
  for (let i = 1; i < 3; i++) m = multiply3(axes[order[i]], m)
  return m
}

function quaternionMatrix([w, x, y, z]: number[]) {
  const n = Math.hypot(w, x, y, z) || 1
  w /= n
  x /= n
  y /= n
  z /= n
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y + w * z),
    2 * (x * z - w * y),
    2 * (x * y - w * z),
    1 - 2 * (x * x + z * z),
    2 * (y * z + w * x),
    2 * (x * z + w * y),
    2 * (y * z - w * x),
    1 - 2 * (x * x + y * y),
  ]
}

function axisAngleMatrix(axis: number[], angle: number) {
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1
  const s = Math.sin(angle / 2)
  return quaternionMatrix([Math.cos(angle / 2), (axis[0] / n) * s, (axis[1] / n) * s, (axis[2] / n) * s])
}

function localMatrix(ob: Ref): Matrix {
  const add = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] ?? 0))
  const location = add(ob.floats('loc', [0, 0, 0]), ob.floats('dloc', [0, 0, 0]))
  const base = ob.floats('scale', ob.floats('size', [1, 1, 1]))
  const delta = ob.floats('dscale', ob.floats('dsize', [1, 1, 1]))
  const size = base.map((v, i) => v * (delta[i] ?? 1))
  const mode = ob.int('rotmode')
  const r =
    mode === 0
      ? multiply3(quaternionMatrix(ob.floats('dquat', [1, 0, 0, 0])), quaternionMatrix(ob.floats('quat', [1, 0, 0, 0])))
      : mode === -1
        ? multiply3(
            axisAngleMatrix(ob.floats('drotAxis', [0, 1, 0]), ob.float('drotAngle')),
            axisAngleMatrix(ob.floats('rotAxis', [0, 1, 0]), ob.float('rotAngle')),
          )
        : multiply3(eulerMatrix(ob.floats('drot', [0, 0, 0]), mode), eulerMatrix(ob.floats('rot', [0, 0, 0]), mode))
  return [
    r[0] * size[0],
    r[1] * size[0],
    r[2] * size[0],
    0,
    r[3] * size[1],
    r[4] * size[1],
    r[5] * size[1],
    0,
    r[6] * size[2],
    r[7] * size[2],
    r[8] * size[2],
    0,
    location[0],
    location[1],
    location[2],
    1,
  ]
}
