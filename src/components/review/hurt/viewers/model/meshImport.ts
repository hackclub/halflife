import * as THREE from 'three'
import type { FileSource, HurtFile } from '../../types'
import { archiveSource, resolvePath } from '../../core/source'
import { openZip } from '../../core/archive'
import { formatBytes } from '../../core/format'
import type { ModelNode, ModelUnit, PartInput } from './analyze'
import { THREEMF_MM } from './threemf'

export interface ImportOptions {
  signal?: AbortSignal
  progress?: (fraction: number | null, message?: string) => void
}

export interface ImportedScene {
  parts: PartInput[]
  materials: (THREE.Material | null)[]
  root: ModelNode
  unit: ModelUnit
  upAxis: 'y' | 'z'
}

const Y_UP = new Set(['gltf', 'glb', 'obj', 'fbx', 'dae', '3ds', 'usdz', 'usdc', 'usda', 'usd'])
const METRES = new Set(['gltf', 'glb', 'dae', 'usdz', 'usdc', 'usda', 'usd'])
const READING = 'Reading the model'
const ASSIMP_FBX = /Creator[^]{0,16}Open Asset Import Library/
const KICAD_VRML =
  /^#VRML[^\n]*\n\s*(?:WorldInfo\s*\{[^{}]*\}\s*)?(?:DEF\s+\S+\s+)?Transform\s*\{\s*scale\s+([\d.eE+-]+)/
const TEXTURE_WAIT = 20_000
const OCCT_GLTF = /Open CASCADE/i
const MTL_TEXTURES = new Set(['map_kd', 'map_ks', 'map_ke', 'norm', 'map_bump', 'bump', 'disp', 'map_d'])

export async function importWithThree(
  source: FileSource,
  file: HurtFile,
  bytes: ArrayBuffer,
  options: ImportOptions = {},
): Promise<ImportedScene> {
  options.progress?.(null, READING)
  const base = source.rawUrl ? source.rawUrl(file.dir ? `${file.dir}/` : '') : ''
  const text = () => new TextDecoder().decode(bytes)
  let resources = loadingManager(source)
  let primitives: Map<THREE.Object3D, Set<THREE.Object3D>> | undefined
  let object: THREE.Object3D
  let unit: ModelUnit = METRES.has(file.ext) ? 'm' : 'unknown'

  try {
    switch (file.ext) {
      case 'gltf':
      case 'glb': {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
        const json = file.ext === 'gltf' ? text() : glbJson(bytes)
        resources = (json && (await gltfResources(source, file, json, base, options))) || resources
        const gltf = await new GLTFLoader(resources.manager).parseAsync(bytes, base)
        object = gltf.scene
        if (OCCT_GLTF.test(String(gltf.asset?.generator ?? ''))) primitives = primitiveGroups(gltf.parser, object)
        break
      }
      case 'obj': {
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
        const loader = new OBJLoader()
        const objText = text()
        const library = objText.match(/^mtllib\s+(.+)$/m)?.[1]?.trim()
        const mtlPath = library ? resolvePath(file.dir, library) : null
        if (mtlPath && source.byPath.has(mtlPath)) {
          const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js')
          const mtlDir = mtlPath.split('/').slice(0, -1).join('/')
          const mtlBase = source.rawUrl ? source.rawUrl(mtlDir ? `${mtlDir}/` : '') : ''
          const mtl = new MTLLoader()
            .setResourcePath(mtlBase)
            .parse(new TextDecoder().decode(await source.read(mtlPath, { signal: options.signal })), mtlBase)
          const maps = Object.values(mtl.materialsInfo).flatMap((info) =>
            Object.entries(info).flatMap(([key, value]) =>
              MTL_TEXTURES.has(key) && typeof value === 'string' ? [mtl.getTextureParams(value, {}).url] : [],
            ),
          )
          resources = await repoResources(source, mtlDir, mtlBase, maps, new Set(), options)
          mtl.setManager(resources.manager)
          mtl.preload()
          loader.setMaterials(mtl)
        }
        object = loader.parse(objText)
        break
      }
      case '3mf': {
        const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js')
        object = new ThreeMFLoader(resources.manager).parse(bytes)
        object.scale.multiplyScalar(THREEMF_MM[await threeMfUnit(bytes)] ?? 1)
        unit = 'mm'
        break
      }
      case 'ply': {
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js')
        object = meshOf(new PLYLoader().parse(bytes))
        break
      }
      case 'dae': {
        const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js')
        const collada = new ColladaLoader(resources.manager).parse(text(), base)
        if (!collada) throw new Error('This COLLADA file could not be read.')
        object = collada.scene
        break
      }
      case 'fbx': {
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
        object = new FBXLoader(resources.manager).parse(bytes, base)
        const centimetres = Number(object.userData.unitScaleFactor)
        if (Number.isFinite(centimetres) && centimetres > 0 && !writtenByAssimp(bytes)) {
          object.scale.multiplyScalar(centimetres * 10)
          unit = 'mm'
        }
        break
      }
      case 'amf': {
        const { AMFLoader } = await import('three/examples/jsm/loaders/AMFLoader.js')
        object = new AMFLoader(resources.manager).parse(bytes)
        break
      }
      case 'wrl':
      case 'vrml': {
        if (bytes.byteLength > VRML_LIMIT) throw vrmlTooLarge(bytes.byteLength)
        const { VRMLLoader } = await import('three/examples/jsm/loaders/VRMLLoader.js')
        const vrml = text()
        object = new VRMLLoader(resources.manager).parse(await expandVrml(vrml, source, file.dir, options.signal), base)
        const backgrounds: THREE.Object3D[] = []
        object.traverse((child) => {
          if (child.renderOrder === -Infinity) backgrounds.push(child)
        })
        backgrounds.forEach((child) => child.removeFromParent())
        unit = vrmlUnit(vrml, object)
        break
      }
      case '3ds': {
        const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js')
        object = new TDSLoader(resources.manager).parse(bytes, base)
        break
      }
      case 'usdz':
      case 'usdc':
      case 'usda':
      case 'usd': {
        const { USDLoader } = await import('three/examples/jsm/loaders/USDLoader.js')
        object = new USDLoader(resources.manager).parse(bytes, base)
        break
      }
      case 'pcb3d':
        return await importPcb3d(source, file, options)
      case 'vtk':
      case 'vtp': {
        const { VTKLoader } = await import('three/examples/jsm/loaders/VTKLoader.js')
        object = meshOf(new VTKLoader().parse(bytes, base))
        break
      }
      default:
        throw new Error(`.${file.ext} files are not a 3D format this viewer reads.`)
    }
    await resources.settle(options.signal)
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError)
      throw new Error(`This .${file.ext} file could not be read. It may be truncated or damaged.`)
    throw error
  } finally {
    resources.release()
  }

  return flatten(object, file.ext, unit, primitives)
}

const RESOURCE_LIMIT = 64
const LOCAL_URI = /^(blob|data):/i
const EXTERNAL_URI = /^(blob:|[a-z][a-z0-9+.-]*:\/\/|\/\/)/i
const DATA_URI = /^data:([^,]*?)(;base64)?,/i

interface GltfJson {
  buffers?: { uri?: unknown }[]
  images?: { uri?: unknown }[]
}

function writtenByAssimp(bytes: ArrayBuffer) {
  return ASSIMP_FBX.test(new TextDecoder('latin1').decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4096))))
}

function base64Bytes(body: string) {
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function percentBytes(body: string) {
  const utf8 = new TextEncoder().encode(body)
  const bytes = new Uint8Array(utf8.length)
  let length = 0
  for (let i = 0; i < utf8.length; i++) {
    const hex = utf8[i] === 0x25 ? String.fromCharCode(utf8[i + 1] ?? 0, utf8[i + 2] ?? 0) : ''
    if (/^[0-9a-f]{2}$/i.test(hex)) {
      bytes[length++] = parseInt(hex, 16)
      i += 2
    } else bytes[length++] = utf8[i]
  }
  return bytes.slice(0, length)
}

function dataUriBytes(uri: string) {
  const match = uri.match(DATA_URI)
  if (!match) return null
  try {
    const body = uri.slice(match[0].length)
    return new Blob([match[2] ? base64Bytes(body) : percentBytes(body)], { type: match[1] })
  } catch {
    return null
  }
}

function decodeUri(uri: string) {
  try {
    return decodeURIComponent(uri)
  } catch {
    return uri
  }
}

function primitiveGroups(
  parser: { associations: Map<unknown, { meshes?: number; primitives?: number }> },
  scene: THREE.Object3D,
) {
  const groups = new Map<THREE.Object3D, Set<THREE.Object3D>>()
  scene.traverse((node) => {
    const mesh = parser.associations.get(node)?.meshes
    if (mesh === undefined || (node as THREE.Mesh).isMesh) return
    const children = node.children.filter((child) => {
      const mapping = parser.associations.get(child)
      return mapping?.meshes === mesh && mapping.primitives !== undefined
    })
    if (children.length > 1) groups.set(node, new Set(children))
  })
  return groups
}

function glbJson(bytes: ArrayBuffer) {
  if (bytes.byteLength < 20) return ''
  const view = new DataView(bytes)
  if (view.getUint32(16, true) !== 0x4e4f534a) return ''
  const length = Math.min(view.getUint32(12, true), bytes.byteLength - 20)
  return new TextDecoder().decode(new Uint8Array(bytes, 20, length))
}

function loadingManager(source: FileSource, urls = new Map<string, string>()) {
  const root = source.rawUrl ? source.rawUrl('') : ''
  const manager = new THREE.LoadingManager()
  manager.setURLModifier(
    (url) => urls.get(url) ?? (LOCAL_URI.test(url) || (root && url.startsWith(root)) ? url : 'data:,'),
  )
  let started = false
  manager.onStart = () => (started = true)
  const loaded = new Promise<void>((resolve) => (manager.onLoad = resolve))
  return {
    manager,
    release: () => urls.forEach((url) => URL.revokeObjectURL(url)),
    settle: (signal?: AbortSignal) =>
      started
        ? Promise.race([
            loaded,
            new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, TEXTURE_WAIT)
              signal?.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
            }),
          ])
        : Promise.resolve(),
  }
}

async function gltfResources(source: FileSource, file: HurtFile, text: string, base: string, options: ImportOptions) {
  let json: GltfJson
  try {
    json = JSON.parse(text) as GltfJson
  } catch {
    return null
  }
  const uris = (list: { uri?: unknown }[] | undefined) =>
    (Array.isArray(list) ? list : []).map((entry) => entry?.uri).filter((uri): uri is string => typeof uri === 'string')
  const buffers = uris(json.buffers)
  return repoResources(source, file.dir, base, [...buffers, ...uris(json.images)], new Set(buffers), options)
}

async function repoResources(
  source: FileSource,
  dir: string,
  base: string,
  references: string[],
  required: Set<string>,
  { signal, progress }: ImportOptions,
) {
  const uris = [...new Set(references.filter((uri) => uri !== '' && !EXTERNAL_URI.test(uri)))].slice(0, RESOURCE_LIMIT)
  const downloads = new Map<string, [number, number]>()
  const report = (path: string, loaded: number, total: number) => {
    downloads.set(path, [loaded, total])
    let done = 0
    let size = 0
    for (const [l, t] of downloads.values()) {
      done += l
      size += t
    }
    progress?.(size ? Math.min(1, done / size) : null, 'Downloading')
  }
  const settled = await Promise.allSettled(
    uris.map(async (uri) => {
      if (DATA_URI.test(uri)) {
        const blob = dataUriBytes(uri)
        if (!blob && required.has(uri)) throw new Error('This glTF file has a damaged embedded buffer.')
        return blob ? ([uri, URL.createObjectURL(blob)] as const) : null
      }
      const path = resolvePath(dir, decodeUri(uri))
      if (!source.byPath.has(path)) {
        if (required.has(uri))
          throw new Error(`This glTF file keeps its geometry in ${path}, which is not in the repository.`)
        return null
      }
      const data = await source
        .read(path, { signal, onProgress: (l, t) => report(path, l, t) })
        .catch((error: unknown) => {
          if (required.has(uri)) throw error
          return null
        })
      return data ? ([THREE.LoaderUtils.resolveURL(uri, base), URL.createObjectURL(new Blob([data]))] as const) : null
    }),
  )
  const resources = loadingManager(
    source,
    new Map(settled.flatMap((result) => (result.status === 'fulfilled' && result.value ? [result.value] : []))),
  )
  const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed || signal?.aborted) {
    resources.release()
    signal?.throwIfAborted()
    throw failed!.reason
  }
  progress?.(null, READING)
  return resources
}

async function threeMfUnit(bytes: ArrayBuffer) {
  const zip = openZip(bytes)
  const model =
    zip.entries.find((e) => e.name.toLowerCase() === '3d/3dmodel.model') ??
    zip.entries.find((e) => /\.model$/i.test(e.name))
  if (!model) return 'millimeter'
  const head = new TextDecoder().decode((await zip.read(model)).subarray(0, 4096))
  return head.match(/<model\b[^>]*?\bunit\s*=\s*["']([a-z]+)["']/i)?.[1]?.toLowerCase() ?? 'millimeter'
}

function vrmlUnit(text: string, object: THREE.Object3D): ModelUnit {
  const scale = Number(text.slice(0, 2048).match(KICAD_VRML)?.[1])
  if (scale === 0.00254) return 'm'
  if (scale === 2.54) return 'mm'
  if (scale === 0.1) return 'in'
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3())
  if (Math.max(size.x, size.y, size.z) < 0.05) return 'm'
  object.scale.multiplyScalar(2.54)
  return 'mm'
}

async function importPcb3d(source: FileSource, file: HurtFile, options: ImportOptions) {
  const { source: inner } = await archiveSource(source, file.path)
  const board =
    inner.byPath.get('pcb.wrl') ??
    inner.files.find((f) => f.ext === 'wrl' && !f.dir) ??
    inner.files.find((f) => f.ext === 'wrl')
  if (!board) throw new Error('This .pcb3d file has no board model inside.')
  if (board.size > VRML_LIMIT) throw vrmlTooLarge(board.size)
  return importWithThree(inner, board, await inner.read(board.path), options)
}

const VRML_INLINE = /Inline\s*\{\s*url\s*\[?\s*"([^"]+)"\s*\]?\s*\}/g
const VRML_INLINE_LIMIT = 300
const VRML_LIMIT = 32 * 1024 * 1024

function vrmlTooLarge(size: number) {
  return new Error(`This VRML model is ${formatBytes(size)}, too large to open in the browser.`)
}

async function expandVrml(text: string, source: FileSource, dir: string, signal?: AbortSignal) {
  const names = new Map<string, string>()
  let total = text.length
  const inline = (url: string) => {
    const path = resolvePath(dir, url)
    const name = names.get(path)
    if (name) return Promise.resolve(`USE ${name}`)
    if (!source.byPath.has(path) || names.size >= VRML_INLINE_LIMIT) return Promise.resolve('')
    const base = path
      .split('/')
      .pop()!
      .replace(/\.[^.]*$/, '')
    const id = `${base.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?![A-Za-z])/, '_')}_${names.size + 1}`
    names.set(path, id)
    return source.read(path, { signal }).then((bytes) => {
      total += bytes.byteLength
      if (total > VRML_LIMIT) throw vrmlTooLarge(total)
      return `DEF ${id} Group { children [ ${new TextDecoder().decode(bytes).replace(/^#VRML[^\n]*\n/, '')} ] }`
    })
  }
  const parts = await Promise.all(text.split(VRML_INLINE).map((chunk, i) => (i % 2 === 1 ? inline(chunk) : chunk)))
  return parts.join('').replace(/(\d)\.(?=[\s,\]}])/g, '$1.0')
}

function meshOf(geometry: THREE.BufferGeometry) {
  const color = geometry.getAttribute('color')
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: !!color, color: color ? 0xffffff : 0xb6c0be }),
  )
}

interface Piece {
  material: THREE.Material | null
  color: number | null
  position: Float32Array
  normal: Float32Array | null
  index: Uint32Array | null
  colors: Uint8Array | null
  uv: Float32Array | null
}

function flatten(
  object: THREE.Object3D,
  ext: string,
  unit: ModelUnit,
  primitives = new Map<THREE.Object3D, Set<THREE.Object3D>>(),
): ImportedScene {
  object.updateMatrixWorld(true)
  const parts: PartInput[] = []
  const materials: (THREE.Material | null)[] = []
  const matrix = new THREE.Matrix4()
  const instanceMatrix = new THREE.Matrix4()
  const normalMatrix = new THREE.Matrix3()
  const point = new THREE.Vector3()
  let remap = new Int32Array(0)

  const gather = (
    attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    vertices: Uint32Array | null,
    size: 2 | 3,
    apply?: (v: THREE.Vector3) => void,
  ) => {
    const count = vertices?.length ?? attribute.count
    const out = new Float32Array(count * size)
    for (let i = 0; i < count; i++) {
      const v = vertices ? vertices[i] : i
      if (size === 2) {
        out[i * 2] = attribute.getX(v)
        out[i * 2 + 1] = attribute.getY(v)
        continue
      }
      point.fromBufferAttribute(attribute, v)
      apply?.(point)
      point.toArray(out, i * 3)
    }
    return out
  }

  const pieces = (mesh: THREE.Mesh, transform: THREE.Matrix4): Piece[] => {
    const geometry = mesh.geometry as THREE.BufferGeometry
    const position = geometry.getAttribute('position')
    if (!position) return []
    const normal = geometry.getAttribute('normal')
    const color = geometry.getAttribute('color')
    const uv = geometry.getAttribute('uv')
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const groups =
      Array.isArray(mesh.material) && geometry.groups.length > 0
        ? geometry.groups
        : [{ start: 0, count: Infinity, materialIndex: 0 }]
    if (geometry.index && remap.length < position.count) remap = new Int32Array(position.count).fill(-1)
    normalMatrix.getNormalMatrix(transform)
    return groups.flatMap((group) => {
      const { vertices, index } = subset(geometry, group.start, group.count, remap)
      if ((vertices?.length ?? position.count) < 3) return []
      const material = list[group.materialIndex ?? 0] ?? null
      const textured = !!material && hasTextures(material)
      return [
        {
          material: textured || color ? material : null,
          color:
            material && 'color' in material && !color ? (material as THREE.MeshStandardMaterial).color.getHex() : null,
          position: gather(position, vertices, 3, (v) => v.applyMatrix4(transform)),
          normal: normal ? gather(normal, vertices, 3, (v) => v.applyMatrix3(normalMatrix).normalize()) : null,
          index,
          colors: color ? toUint8Colors(color, vertices) : null,
          uv: textured && uv ? gather(uv, vertices, 2) : null,
        },
      ]
    })
  }

  const push = ({ material, ...piece }: Piece, name: string) => {
    parts.push({ name, ...piece })
    materials.push(material)
    return parts.length - 1
  }

  const merge = (meshes: THREE.Mesh[], name: string) => {
    const list = meshes.flatMap((mesh) => pieces(mesh, mesh.matrixWorld))
    if (list.length < 2 || list.some((piece) => piece.material)) return list.map((piece) => push(piece, name))
    const corners = list.map((piece) => {
      const count = piece.index?.length ?? piece.position.length / 3
      return count - (count % 3)
    })
    const vertexCount = list.reduce((sum, piece) => sum + piece.position.length / 3, 0)
    const position = new Float32Array(vertexCount * 3)
    const normal = list.every((piece) => piece.normal) ? new Float32Array(vertexCount * 3) : null
    const index = new Uint32Array(corners.reduce((sum, count) => sum + count, 0))
    const faces = new Uint32Array(list.length * 2)
    let vertices = 0
    let at = 0
    list.forEach((piece, i) => {
      position.set(piece.position, vertices * 3)
      normal?.set(piece.normal!, vertices * 3)
      for (let k = 0; k < corners[i]; k++) index[at + k] = vertices + (piece.index ? piece.index[k] : k)
      faces[i * 2] = at / 3
      faces[i * 2 + 1] = Math.max(at / 3, (at + corners[i]) / 3 - 1)
      vertices += piece.position.length / 3
      at += corners[i]
    })
    parts.push({
      name,
      color: list[0].color,
      position,
      normal,
      index,
      faces,
      faceColors: list.map((piece) => piece.color),
    })
    materials.push(null)
    return [parts.length - 1]
  }

  const walk = (node: THREE.Object3D): ModelNode => {
    const entry: ModelNode = { name: node.name, parts: [], children: [] }
    const merged = primitives.get(node)
    if (merged) {
      const meshes = node.children.filter((child) => merged.has(child)) as THREE.Mesh[]
      entry.parts.push(...merge(meshes, node.name || `Mesh ${parts.length + 1}`))
    } else if ((node as THREE.InstancedMesh).isInstancedMesh) {
      const instanced = node as THREE.InstancedMesh
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, instanceMatrix)
        matrix.multiplyMatrices(instanced.matrixWorld, instanceMatrix)
        const name = `${node.name || 'Instance'} ${i + 1}`
        entry.parts.push(...pieces(instanced, matrix).map((piece) => push(piece, name)))
      }
    } else if ((node as THREE.Mesh).isMesh) {
      const name = node.name || `Mesh ${parts.length + 1}`
      entry.parts.push(...pieces(node as THREE.Mesh, node.matrixWorld).map((piece) => push(piece, name)))
    }
    entry.children = node.children.filter((child) => !merged?.has(child)).map(walk)
    return entry
  }

  const root = walk(object)
  if (parts.length === 0) throw new Error('This file has no surfaces to show.')
  return { parts, materials, root, unit, upAxis: Y_UP.has(ext) ? 'y' : 'z' }
}

function hasTextures(material: THREE.Material) {
  let found = false
  for (const [key, value] of Object.entries(material)) {
    if (!(value instanceof THREE.Texture)) continue
    if (value.image) found = true
    else (material as unknown as Record<string, unknown>)[key] = null
  }
  return found
}

function subset(geometry: THREE.BufferGeometry, start: number, count: number, remap: Int32Array) {
  const index = geometry.index
  if (!index) {
    const total = geometry.getAttribute('position').count
    if (start === 0 && count >= total) return { vertices: null, index: null }
    const end = Math.min(start + count, total)
    const vertices = new Uint32Array(Math.max(0, end - start))
    for (let i = 0; i < vertices.length; i++) vertices[i] = start + i
    return { vertices, index: null }
  }
  const end = Math.min(start + count, index.count)
  const local = new Uint32Array(Math.max(0, end - start))
  const vertices: number[] = []
  for (let i = start; i < end; i++) {
    const v = index.getX(i)
    if (remap[v] < 0) {
      remap[v] = vertices.length
      vertices.push(v)
    }
    local[i - start] = remap[v]
  }
  for (const v of vertices) remap[v] = -1
  return { vertices: Uint32Array.from(vertices), index: local }
}

function toUint8Colors(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertices: Uint32Array | null,
) {
  const count = vertices?.length ?? attribute.count
  const out = new Uint8Array(count * 3)
  for (let i = 0; i < count; i++) {
    const v = vertices ? vertices[i] : i
    out[i * 3] = Math.round(attribute.getX(v) * 255)
    out[i * 3 + 1] = Math.round(attribute.getY(v) * 255)
    out[i * 3 + 2] = Math.round(attribute.getZ(v) * 255)
  }
  return out
}
