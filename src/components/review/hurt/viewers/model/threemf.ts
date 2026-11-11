import { Color, Matrix4, SRGBColorSpace } from 'three'
import { openZip } from '../../core/archive'
import { decode } from '../eagle/xml'
import type { ModelNode, PartInput } from './analyze'

export interface ThreeMfMesh {
  vertices: Float32Array
  triangles: Uint32Array
  pids: (string | null)[] | null
  props: Int32Array | null
}

export interface ThreeMfObject {
  part: string
  name: string
  pid: string | null
  pindex: number
  mesh: ThreeMfMesh | null
  components: ThreeMfRef[]
}

export interface ThreeMfRef {
  part: string
  id: string
  transform: number[] | null
}

export interface ThreeMfPart {
  objects: Map<string, ThreeMfObject>
  materials: Map<string, { name: string; color: string }[]>
  colors: Map<string, string[]>
  build: ThreeMfRef[]
  unit: string
}

export interface ThreeMfDocument {
  root: string
  parts: Map<string, ThreeMfPart>
}

export const THREEMF_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
}
export const THREEMF_UNSUPPORTED = 'This 3MF file uses textures or materials the fast 3MF reader skips.'

const TAG = /<(\/?)(?:[\w.-]+:)?([\w.-]+)([^>]*)>/g
const ATTR = /(?:[\w.-]+:)?([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const MODEL_PART = /^3D\/.+\.model$/i
const ROOT_TARGET = /<Relationship\b[^>]*\bTarget\s*=\s*["']([^"']+\.model)["']/i
const FALLBACK = new Set(['texture2d', 'texture2dgroup', 'pbmetallicdisplayproperties', 'beamlattice'])

function attributes(body: string) {
  const out: Record<string, string> = {}
  ATTR.lastIndex = 0
  for (let m = ATTR.exec(body); m; m = ATTR.exec(body)) out[m[1]] = m[2] ?? m[3]
  return out
}

function transformOf(value: string | undefined) {
  if (!value) return null
  const numbers = value.trim().split(/\s+/).map(Number)
  return numbers.length === 12 && numbers.every(Number.isFinite) ? numbers : null
}

function partName(path: string) {
  return path.replace(/^\/+/, '')
}

function readPart(name: string, text: string): ThreeMfPart | null {
  const part: ThreeMfPart = {
    objects: new Map(),
    materials: new Map(),
    colors: new Map(),
    build: [],
    unit: 'millimeter',
  }
  let object: ThreeMfObject | null = null
  let materials: { name: string; color: string }[] | null = null
  let colors: string[] | null = null
  let vertices: number[] | null = null
  let triangles: number[] = []
  let pids: (string | null)[] | null = null
  let props: number[] | null = null

  TAG.lastIndex = 0
  for (let m = TAG.exec(text); m; m = TAG.exec(text)) {
    const tag = m[2]
    if (m[1]) {
      if (tag === 'mesh' && object && vertices) {
        object.mesh = {
          vertices: Float32Array.from(vertices),
          triangles: Uint32Array.from(triangles),
          pids,
          props: props && Int32Array.from({ length: triangles.length }, (_, i) => props![i] ?? -1),
        }
        vertices = null
      } else if (tag === 'object') object = null
      else if (tag === 'basematerials') materials = null
      else if (tag === 'colorgroup') colors = null
      continue
    }
    if (FALLBACK.has(tag)) return null
    const body = m[3]
    switch (tag) {
      case 'vertex': {
        if (!vertices) break
        let x = 0
        let y = 0
        let z = 0
        ATTR.lastIndex = 0
        for (let a = ATTR.exec(body); a; a = ATTR.exec(body)) {
          if (a[1] === 'x') x = parseFloat(a[2] ?? a[3])
          else if (a[1] === 'y') y = parseFloat(a[2] ?? a[3])
          else if (a[1] === 'z') z = parseFloat(a[2] ?? a[3])
        }
        vertices.push(x, y, z)
        break
      }
      case 'triangle': {
        if (!vertices) break
        const at = triangles.length
        triangles.push(0, 0, 0)
        ATTR.lastIndex = 0
        for (let a = ATTR.exec(body); a; a = ATTR.exec(body)) {
          const key = a[1]
          const value = a[2] ?? a[3]
          if (key === 'v1' || key === 'v2' || key === 'v3') triangles[at + key.charCodeAt(1) - 49] = parseInt(value, 10)
          else if (key === 'pid') {
            pids ??= new Array<string | null>(at / 3).fill(null)
            pids[at / 3] = value
          } else if (key === 'p1' || key === 'p2' || key === 'p3') {
            props ??= new Array<number>(at).fill(-1)
            while (props.length < at + 3) props.push(-1)
            props[at + key.charCodeAt(1) - 49] = parseInt(value, 10)
          }
        }
        if (pids && pids.length < at / 3 + 1) pids.push(null)
        break
      }
      case 'model':
        part.unit = attributes(body).unit?.toLowerCase() || 'millimeter'
        break
      case 'object': {
        const a = attributes(body)
        object = {
          part: name,
          name: decode(a.name ?? ''),
          pid: a.pid || null,
          pindex: a.pindex ? parseInt(a.pindex, 10) : 0,
          mesh: null,
          components: [],
        }
        if (a.id) part.objects.set(a.id, object)
        if (body.endsWith('/')) object = null
        break
      }
      case 'mesh':
        if (!object || body.endsWith('/')) break
        vertices = []
        triangles = []
        pids = null
        props = null
        break
      case 'component':
      case 'item': {
        const a = attributes(body)
        const ref = {
          part: a.path ? partName(decode(a.path)) : name,
          id: a.objectid,
          transform: transformOf(a.transform),
        }
        if (tag === 'item') part.build.push(ref)
        else object?.components.push(ref)
        break
      }
      case 'basematerials':
        materials = []
        part.materials.set(attributes(body).id, materials)
        break
      case 'base':
        if (materials) {
          const a = attributes(body)
          materials.push({ name: decode(a.name ?? ''), color: a.displaycolor ?? '' })
        }
        break
      case 'colorgroup':
        colors = []
        part.colors.set(attributes(body).id, colors)
        break
      case 'color':
        colors?.push(attributes(body).color ?? '')
        break
    }
  }
  return part
}

export async function readThreeMf(bytes: ArrayBuffer): Promise<ThreeMfDocument | null> {
  const zip = openZip(bytes)
  const decoder = new TextDecoder()
  const byName = new Map(zip.entries.map((e) => [e.name.toLowerCase(), e]))
  const rels = byName.get('_rels/.rels')
  const target = rels ? decoder.decode(await zip.read(rels)).match(ROOT_TARGET)?.[1] : undefined
  const models = zip.entries.filter((e) => !e.dir && MODEL_PART.test(e.name))
  const root =
    (target && byName.get(partName(target).toLowerCase())) || models.find((e) => !e.name.slice(3).includes('/'))
  if (!root) return null
  const parts = new Map<string, ThreeMfPart>()
  const texts = await Promise.all(models.map(async (e) => [e.name, decoder.decode(await zip.read(e))] as const))
  for (const [name, text] of texts) {
    const part = readPart(name, text)
    if (!part) return null
    parts.set(name, part)
  }
  return { root: root.name, parts }
}

export function threeMfModel({ root, parts }: ThreeMfDocument) {
  const inputs: PartInput[] = []
  const color = new Color()
  const linear = new Map<string[], Uint8Array>()
  let remap = new Int32Array(0)
  const hex = (style?: string) => (style ? color.setStyle(style.slice(0, 7), SRGBColorSpace).getHex() : 0xffffff)
  const find = (part: string, id: string) => {
    const named = parts.get(part) ?? [...parts].find(([name]) => name.toLowerCase() === part.toLowerCase())?.[1]
    return named?.objects.get(id) ?? [...parts.values()].find((p) => p.objects.has(id))?.objects.get(id)
  }
  const placed = (world: Matrix4, t: number[] | null) =>
    t
      ? world
          .clone()
          .multiply(
            new Matrix4().set(t[0], t[3], t[6], t[9], t[1], t[4], t[7], t[10], t[2], t[5], t[8], t[11], 0, 0, 0, 1),
          )
      : world
  const transform = (position: Float32Array, world: Matrix4) => {
    const m = world.elements
    for (let i = 0; i < position.length; i += 3) {
      const [x, y, z] = [position[i], position[i + 1], position[i + 2]]
      for (let k = 0; k < 3; k++) position[i + k] = m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k]
    }
    return position
  }
  const paletteOf = (palette: string[]) => {
    let found = linear.get(palette)
    if (!found) {
      found = new Uint8Array(palette.length * 3)
      for (let i = 0; i < palette.length; i++) {
        color.setStyle(palette[i].slice(0, 7), SRGBColorSpace)
        found.set(
          [color.r, color.g, color.b].map((c) => Math.round(c * 255)),
          i * 3,
        )
      }
      linear.set(palette, found)
    }
    return found
  }

  const meshNodes = (object: ThreeMfObject, world: Matrix4): ModelNode[] => {
    const { vertices, triangles, pids, props } = object.mesh!
    const count = triangles.length / 3
    const corner = (t: number, k: number) => (props && props[t * 3 + k] >= 0 ? props[t * 3 + k] : -1)
    const push = (input: Omit<PartInput, 'name' | 'normal'>) => {
      inputs.push({ name: object.name || `Mesh ${inputs.length + 1}`, normal: null, ...input })
      return [{ name: object.name, parts: [inputs.length - 1], children: [] }]
    }
    const indexed = (list: number[] | null, packed: number): ModelNode[] => {
      const total = list ? list.length : count
      if (remap.length < vertices.length / 3) remap = new Int32Array(vertices.length / 3).fill(-1)
      const index = new Uint32Array(total * 3)
      const used: number[] = []
      for (let i = 0; i < total; i++) {
        const t = list ? list[i] : i
        for (let k = 0; k < 3; k++) {
          const v = triangles[t * 3 + k]
          if (remap[v] < 0) remap[v] = used.push(v) - 1
          index[i * 3 + k] = remap[v]
        }
      }
      const position = new Float32Array(used.length * 3)
      used.forEach((v, i) => {
        position.set(vertices.subarray(v * 3, v * 3 + 3), i * 3)
        remap[v] = -1
      })
      return used.length < 3 ? [] : push({ color: packed, position: transform(position, world), index })
    }
    if (!pids && !object.pid) return indexed(null, 0xffffff)
    const groups: Record<string, number[]> = {}
    for (let t = 0; t < count; t++) (groups[pids?.[t] ?? object.pid ?? 'default'] ??= []).push(t)
    const part = parts.get(object.part)!
    return Object.entries(groups).flatMap(([pid, list]) => {
      const base = part.materials.get(pid)
      const palette = part.colors.get(pid)
      if (pid === 'default' || base) {
        const byIndex: Record<number, number[]> = {}
        for (const t of list) (byIndex[base ? (corner(t, 0) >= 0 ? corner(t, 0) : object.pindex) : 0] ??= []).push(t)
        return Object.entries(byIndex).flatMap(([index, entry]) => indexed(entry, hex(base?.[Number(index)]?.color)))
      }
      if (!palette) return []
      const rgb = paletteOf(palette)
      const position = new Float32Array(list.length * 9)
      const colors = new Uint8Array(list.length * 9)
      list.forEach((t, i) => {
        const first = corner(t, 0) >= 0 ? corner(t, 0) : object.pindex
        for (let k = 0; k < 3; k++) {
          const v = triangles[t * 3 + k]
          position.set(vertices.subarray(v * 3, v * 3 + 3), i * 9 + k * 3)
          const entry = k > 0 && corner(t, k) >= 0 ? corner(t, k) : first
          if (entry < palette.length) colors.set(rgb.subarray(entry * 3, entry * 3 + 3), i * 9 + k * 3)
        }
      })
      return push({ color: null, position: transform(position, world), index: null, colors })
    })
  }

  const node = (object: ThreeMfObject, world: Matrix4, open: Set<ThreeMfObject>): ModelNode => {
    const entry: ModelNode = { name: object.name, parts: [], children: [] }
    if (object.mesh) entry.children = meshNodes(object, world)
    else if (!open.has(object)) {
      open.add(object)
      for (const ref of object.components) {
        const child = find(ref.part, ref.id)
        if (child) entry.children.push(node(child, placed(world, ref.transform), open))
      }
      open.delete(object)
    }
    return entry
  }

  const scale = THREEMF_MM[parts.get(root)!.unit] ?? 1
  const world = new Matrix4().makeScale(scale, scale, scale)
  const scene: ModelNode = { name: '', parts: [], children: [] }
  for (const item of parts.get(root)!.build) {
    const object = find(item.part, item.id)
    if (object) scene.children.push(node(object, placed(world, item.transform), new Set()))
  }
  return { parts: inputs, root: scene }
}
