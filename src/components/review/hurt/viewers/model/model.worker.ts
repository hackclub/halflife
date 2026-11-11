import occtimportjs from 'occt-import-js'
// Half Life: served by app/api/reviews/assets from the installed package, in place of Vite's `?url` import.
const occtWasm = '/api/reviews/assets/occt-import-js.wasm'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { openZip } from '../../core/archive'
import { serveWorker, transferablesOf } from '../../core/workers'
import { readBlend } from '../blender/read'
import { unescapeXml } from '../cadsource/shared'
import { readFusion, readFusionHistory, type FusionShape } from '../fusion/read'
import { readParasolid, type ParasolidModel } from '../parasolid/read'
import { readDwg } from '../dwg/read'
import { hasTessellatedFaces, isFacetedStep, readFacetedStep, readTessellatedStep } from './stepMesh'
import { stepOrigin, type StepOrigin } from './stepHeader'
import { readThreeMf, THREEMF_UNSUPPORTED, threeMfModel } from './threemf'
import { wireIndices } from './wire'
import {
  analyzePart,
  finishModel,
  packColor,
  uprightAxis,
  type ModelData,
  type ModelHistory,
  type ModelNode,
  type ModelPart,
  type ModelPreview,
  type PartInput,
} from './analyze'

interface OcctMesh {
  name?: string
  color?: number[]
  brep_faces?: { first: number; last: number; color: number[] | null }[]
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } }
  index?: { array: ArrayLike<number> }
}

interface OcctNode {
  name?: string
  meshes?: number[]
  children?: OcctNode[]
}

interface OcctResult {
  success: boolean
  root: OcctNode
  meshes: OcctMesh[]
}

interface Occt {
  ReadStepFile(content: Uint8Array, params: object | null): OcctResult
  ReadIgesFile(content: Uint8Array, params: object | null): OcctResult
  ReadBrepFile(content: Uint8Array, params: object | null): OcctResult
}

let occt: Promise<Occt> | null = null

function loadOcct() {
  occt ??= fetch(new URL(occtWasm, self.location.origin))
    .then((response) => {
      if (!response.ok) throw new Error('Could not load the STEP reader.')
      return response.arrayBuffer()
    })
    .then((wasmBinary) => (occtimportjs as unknown as (options: object) => Promise<Occt>)({ wasmBinary }))
  occt.catch(() => (occt = null))
  return occt
}

const RETRY_DEFLECTION = 0.001

function meshParams(bytes: number) {
  const coarse = bytes > 25e6 ? 2 : bytes > 8e6 ? 1 : 0
  return {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: [0.0015, 0.0025, 0.004][coarse],
    angularDeflection: [0.35, 0.45, 0.6][coarse],
  }
}

function appearance(shape: { colour: number[] | null; faceColours: (number[] | null)[] }) {
  const colors = shape.faceColours.map((colour) => packColor(colour ?? shape.colour))
  return colors.some((color) => color !== null) ? colors : null
}

function partsFromOcct(result: OcctResult, label?: string, appearance?: (number | null)[] | null) {
  const merged = mergeFaceted(result)
  const parts: ModelPart[] = []
  const remap = new Map<number, number>()
  result.meshes.forEach((mesh, i) => {
    if (merged.has(i)) return
    const position = Float32Array.from(mesh.attributes.position.array)
    if (position.length < 9) return
    const all = mesh.brep_faces ?? []
    const colors = appearance?.length === all.length ? appearance : all.map((f) => packColor(f.color))
    const faces = all.flatMap((f, k) => (f.last >= f.first ? [{ ...f, packed: colors[k] }] : []))
    const faceted = faces.length > 1 && faces.every((f) => f.first === f.last)
    const input: PartInput = {
      name: mesh.name || label || `Part ${i + 1}`,
      color: packColor(mesh.color) ?? (appearance?.every((c) => c === appearance[0]) ? appearance[0] : null),
      position,
      normal: mesh.attributes.normal ? Float32Array.from(mesh.attributes.normal.array) : null,
      index: mesh.index ? Uint32Array.from(mesh.index.array) : null,
      faces: faceted ? null : Uint32Array.from(faces.flatMap((f) => [f.first, f.last])),
      faceColors: faceted ? null : faces.map((f) => f.packed),
    }
    remap.set(i, parts.length)
    parts.push(analyzePart(input))
  })
  const convert = (node: OcctNode): ModelNode => ({
    name: node.name ?? '',
    parts: (node.meshes ?? []).map((m) => remap.get(m) ?? -1),
    children: (node.children ?? []).map(convert),
  })
  return { parts, root: convert(result.root ?? {}) }
}

function mergeFaceted(result: OcctResult) {
  const merged = new Set<number>()
  const visit = (node: OcctNode) => {
    const ids = node.meshes ?? []
    const meshes = ids.map((m) => result.meshes[m])
    if (meshes.length > 1 && meshes.every((mesh) => mesh && !mesh.name && mesh.brep_faces?.length === 1)) {
      ids.forEach((m) => merged.add(m))
      result.meshes.push(mergeMeshes(meshes, node.name))
      node.meshes = [result.meshes.length - 1]
    }
    node.children?.forEach(visit)
  }
  if (result.root) visit(result.root)
  return merged
}

function mergeMeshes(meshes: OcctMesh[], name?: string): OcctMesh {
  const corners = (mesh: OcctMesh) => mesh.index?.array.length ?? mesh.attributes.position.array.length / 3
  const vertexCount = meshes.reduce((sum, mesh) => sum + mesh.attributes.position.array.length / 3, 0)
  const position = new Float32Array(vertexCount * 3)
  const normal = meshes.every((mesh) => mesh.attributes.normal) ? new Float32Array(vertexCount * 3) : null
  const index = new Uint32Array(meshes.reduce((sum, mesh) => sum + corners(mesh), 0))
  const faces: NonNullable<OcctMesh['brep_faces']> = []
  let vertices = 0
  let at = 0
  for (const mesh of meshes) {
    position.set(mesh.attributes.position.array, vertices * 3)
    if (normal) normal.set(mesh.attributes.normal!.array, vertices * 3)
    const count = corners(mesh)
    for (let k = 0; k < count; k++) index[at + k] = vertices + (mesh.index ? mesh.index.array[k] : k)
    const face = mesh.brep_faces![0]
    faces.push({ first: face.first + at / 3, last: face.last + at / 3, color: face.color ?? mesh.color ?? null })
    vertices += mesh.attributes.position.array.length / 3
    at += count
  }
  return {
    name,
    color: meshes[0].color,
    brep_faces: faces,
    attributes: { position: { array: position }, normal: normal ? { array: normal } : undefined },
    index: { array: index },
  }
}

function isUnmeshed(mesh: OcctResult['meshes'][number]) {
  return mesh.attributes.position.array.length < 9 && (mesh.brep_faces?.length ?? 0) > 0
}

function sameShape(a: OcctMesh, b: OcctMesh) {
  return a.name === b.name && a.brep_faces?.length === b.brep_faces?.length
}

function unmeshed(result: OcctResult) {
  return result.meshes.filter(isUnmeshed).length
}

const READ_MS = { base: 180, megabyte: 180, megabyteSquared: 3.2 }
const READ_MS_EACH: Record<string, number> = {
  ADVANCED_FACE: 0.43,
  FACE_SURFACE: 0.43,
  B_SPLINE_SURFACE_WITH_KNOTS: 1.4,
  B_SPLINE_SURFACE: 1.4,
  RATIONAL_B_SPLINE_SURFACE: 1.4,
  NEXT_ASSEMBLY_USAGE_OCCURRENCE: 12,
}
const COUNTED = new RegExp(`=\\s*(${Object.keys(READ_MS_EACH).join('|')})\\s*\\(`, 'g')
const TORUS =
  /#(\d+)\s*=\s*(?:DEGENERATE_)?TOROIDAL_SURFACE\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*,\s*([-+\d.Ee]+)\s*,\s*([-+\d.Ee]+)/g
const POINT = /#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)/g
const FACE = /#(\d+)\s*=\s*(?:ADVANCED_FACE|FACE_SURFACE)\s*\(\s*'[^']*'\s*,\s*\([^)]*\)\s*,\s*#(\d+)/g
const SHELL = /(=\s*(?:CLOSED|OPEN)_SHELL\s*\(\s*'[^']*'\s*,\s*\()([^)]*)\)/g

function expectedReadMs(text: string, bytes: number) {
  const megabytes = bytes / 1e6
  let ms = READ_MS.base + READ_MS.megabyte * megabytes + READ_MS.megabyteSquared * megabytes ** 2
  for (const [, type] of text.matchAll(COUNTED)) ms += READ_MS_EACH[type]
  return ms
}

// Self-intersecting tori bigger than the whole model, trimmed to a tiny patch, take OpenCascade minutes each to mesh.
function hugeTori(text: string) {
  const tori = Array.from(text.matchAll(TORUS)).flatMap(([, id, placement, major, minor]) =>
    Number(minor) > Number(major) ? [{ id, placement, radius: Number(major) }] : [],
  )
  const huge = new Set<string>()
  const centres = new Set<string>()
  for (;;) {
    const left = tori.filter(({ id }) => !huge.has(id))
    const extent = stepExtent(
      text,
      centres,
      left.reduce((max, { radius }) => Math.max(max, radius), 0),
    )
    const found = left.filter(({ radius }) => radius > extent)
    if (found.length === 0) return huge
    for (const { id, placement } of found) {
      huge.add(id)
      const centre = text.match(
        new RegExp(`#${placement}\\s*=\\s*AXIS2_PLACEMENT_3D\\s*\\(\\s*'[^']*'\\s*,\\s*#(\\d+)`),
      )
      if (centre) centres.add(centre[1])
    }
  }
}

function stepExtent(text: string, skip: Set<string>, enough: number) {
  let extent = 0
  for (const [, id, coords] of text.matchAll(POINT)) {
    if (skip.has(id)) continue
    for (const value of coords.split(',')) extent = Math.max(extent, Math.abs(Number(value)))
    if (extent >= enough) break
  }
  return extent
}

function withoutFacesOn(text: string, surfaces: Set<string>) {
  const faces = new Set<string>()
  for (const [, face, surface] of text.matchAll(FACE)) if (surfaces.has(surface)) faces.add(face)
  let skipped = 0
  const trimmed = text.replace(SHELL, (shell, head: string, list: string) => {
    const kept = list.split(',').filter((ref) => !faces.has(ref.trim().slice(1)))
    if (kept.length === 0 || kept.length === list.split(',').length) return shell
    skipped += list.split(',').length - kept.length
    return `${head}${kept.join(',')})`
  })
  return { trimmed, skipped }
}

function readStepText(content: Uint8Array) {
  const text = new TextDecoder().decode(content)
  const origin = stepOrigin(text)
  const faceted = isFacetedStep(text) ? readFacetedStep(text) : null
  if (faceted) return { faceted, origin }
  const expect = expectedReadMs(text, content.byteLength)
  const huge = hugeTori(text)
  if (huge.size === 0) return { faceted, origin, expect }
  const { trimmed, skipped } = withoutFacesOn(text, huge)
  return { faceted, origin, expect, skipped, trimmed: skipped ? new TextEncoder().encode(trimmed) : undefined }
}

function exportedFrom(origin: StepOrigin | null | undefined) {
  return origin
    ? [{ label: 'Exported from', value: origin.version ? `${origin.system} ${origin.version}` : origin.system }]
    : undefined
}

async function readOcct({ bytes, ext }: Record<string, unknown>, progress: (message: string, expect?: number) => void) {
  const content = new Uint8Array(bytes as ArrayBuffer)
  const { faceted, origin, expect, skipped, trimmed } = ext === 'step' || ext === 'stp' ? readStepText(content) : {}
  if (faceted) {
    progress('Finding edges')
    const parts = faceted.map(analyzePart)
    return finishModel(
      parts,
      { name: '', parts: parts.map((_, i) => i), children: [] },
      { unit: 'mm', upAxis: uprightAxis(parts, origin), info: exportedFrom(origin), warnings: [] },
    )
  }
  progress('Starting the STEP reader')
  const reader = await loadOcct()
  progress('Tessellating solids', expect)
  const read = (params: ReturnType<typeof meshParams>) =>
    ext === 'iges' || ext === 'igs'
      ? reader.ReadIgesFile(content, params)
      : ext === 'brep' || ext === 'brp'
        ? reader.ReadBrepFile(content, params)
        : reader.ReadStepFile(trimmed ?? content, params)
  const params = meshParams(content.byteLength)
  const result = read(params)
  if (!result.success) throw new Error('OpenCascade could not read this file.')
  const total = result.meshes.length
  if (unmeshed(result) > 0 && unmeshed(result) < total) {
    progress('Retrying shapes that could not be meshed')
    const retry = read({ ...params, linearDeflection: RETRY_DEFLECTION })
    if (retry.success && retry.meshes.length === total)
      result.meshes = result.meshes.map((mesh, i) =>
        isUnmeshed(mesh) && !isUnmeshed(retry.meshes[i]) && sameShape(mesh, retry.meshes[i]) ? retry.meshes[i] : mesh,
      )
  }
  progress('Finding edges')
  const failed = unmeshed(result)
  const { parts, root } = partsFromOcct(result)
  if (parts.length === 0 && ext !== 'brep' && ext !== 'brp') {
    const text = new TextDecoder().decode(content)
    if (hasTessellatedFaces(text)) {
      progress('Reading tessellated bodies')
      parts.push(...readTessellatedStep(text).map(analyzePart))
      root.children = []
      root.parts = parts.map((_, i) => i)
    }
  }
  if (parts.length === 0 && failed > 0)
    throw new Error(
      `OpenCascade read ${total} ${total === 1 ? 'shape' : 'shapes'} but could not turn any into triangles. The model is probably too big for the in-browser reader; download it to open it in CAD.`,
    )
  return finishModel(
    parts,
    root,
    {
      unit: 'mm',
      upAxis: uprightAxis(parts, origin),
      info: exportedFrom(origin),
      warnings: [
        ...(failed > 0 ? [`${failed} of ${total} shapes could not be turned into triangles and are missing.`] : []),
        ...(skipped
          ? [
              `Left out ${skipped} tiny ${skipped === 1 ? 'face' : 'faces'} on curved surfaces far bigger than the model, which OpenCascade takes minutes to mesh.`,
            ]
          : []),
      ],
    },
    'This file has no solid geometry in it, so the export is empty.',
  )
}

interface FcObject {
  name: string
  type: string
  label: string
  shape?: string
  mesh?: string
  placement: Matrix4
  group: string[]
  link?: { name: string; file: string; transform: boolean; array: boolean }
}

const FC_CONTAINERS = /^(App::Part|Assembly::AssemblyObject)$/
const FC_GROUPS = /^(App::Part|Assembly::AssemblyObject|PartDesign::Body)$/
const FC_NOT_SOLID =
  /Sketcher|App::(Origin|Line|Plane|Point|Part)|Spreadsheet|PartDesign::(Body|Plane|Line|Point|CoordinateSystem)|Part::Datum/
const FC_MAX_DEPTH = 32
const FC_MAX_INSTANCES = 10_000

function* xmlElements(xml: string, open: string, close: string) {
  let at = xml.indexOf(open)
  let end = -2
  while (at >= 0) {
    const next = xml.indexOf(open, at + open.length)
    if (end !== -1 && end < at) end = xml.indexOf(close, at)
    const stop = end >= 0 && (next < 0 || end < next) ? end : next < 0 ? xml.length : next
    yield xml.slice(at, stop)
    at = next
  }
}

function xmlProperty(block: string, name: string) {
  const at = block.indexOf(`<Property name="${name}"`)
  if (at < 0) return ''
  const end = block.indexOf('</Property>', at)
  return block.slice(at, end < 0 ? undefined : end)
}

function xmlAttribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
}

function fcPlacement(property: string) {
  const tag = property.match(/<PropertyPlacement\b[^>]*>/)?.[0] ?? ''
  const n = (name: string, fallback = 0) => Number(xmlAttribute(tag, name) ?? fallback) || fallback
  return new Matrix4().compose(
    new Vector3(n('Px'), n('Py'), n('Pz')),
    new Quaternion(n('Q0'), n('Q1'), n('Q2'), tag ? n('Q3') : 1).normalize(),
    new Vector3(1, 1, 1),
  )
}

function fcObject(block: string, types: Map<string, string>): FcObject {
  const name = xmlAttribute(block.slice(0, block.indexOf('>') + 1), 'name') ?? ''
  const label = xmlProperty(block, 'Label').match(/<String value="([^"]*)"/)?.[1]
  const shape = xmlProperty(block, 'Shape')
  const linked = xmlProperty(block, 'LinkedObject').match(/<XLink\b[^>]*>/)?.[0]
  return {
    name,
    type: types.get(name) ?? '',
    label: label ? unescapeXml(label) : name,
    shape: shape.includes('Part::PropertyPartShape') ? shape.match(/<Part [^>]*file="([^"]+)"/)?.[1] : undefined,
    mesh: xmlProperty(block, 'Mesh').match(/<Mesh file="([^"]+)"/)?.[1],
    placement: fcPlacement(xmlProperty(block, 'Placement') || xmlProperty(block, 'LinkPlacement')),
    group: [...xmlProperty(block, 'Group').matchAll(/<Link value="([^"]+)"/g)].map((m) => m[1]),
    link:
      linked && !shape.includes('Part::PropertyPartShape')
        ? {
            name: xmlAttribute(linked, 'name') ?? '',
            file: xmlAttribute(linked, 'file') ?? '',
            transform: /<Bool value="true"/.test(xmlProperty(block, 'LinkTransform')),
            array: Number(xmlProperty(block, 'ElementCount').match(/<Integer value="(\d+)"/)?.[1] ?? 0) > 0,
          }
        : undefined,
  }
}

function fcAppearance(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 4) return []
  const count = Math.min(view.getUint32(0, true), Math.floor((bytes.byteLength - 4) / 24))
  return Array.from({ length: count }, (_, i) => view.getUint32(4 + i * 24 + 4, true) >>> 8)
}

function readMeshKernel(bytes: Uint8Array, name: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 272 || view.getUint32(0, true) !== 0xa0b0c0d0)
    throw new Error(`The mesh ${name} is saved in an old FreeCAD format this viewer can't read.`)
  const points = view.getUint32(264, true)
  const facets = view.getUint32(268, true)
  if (272 + points * 12 + facets * 24 > bytes.byteLength) throw new Error(`The mesh ${name} is damaged.`)
  const position = new Float32Array(points * 3)
  for (let i = 0; i < position.length; i++) position[i] = view.getFloat32(272 + i * 4, true)
  const index = new Uint32Array(facets * 3)
  const start = 272 + points * 12
  for (let f = 0; f < facets; f++)
    for (let k = 0; k < 3; k++) {
      const v = view.getUint32(start + f * 24 + k * 4, true)
      index[f * 3 + k] = v < points ? v : 0
    }
  return { position, index }
}

function placedPart(part: ModelPart, matrix: Matrix4): ModelPart {
  if (matrix.equals(IDENTITY)) return part
  const p = part.position
  const m = matrix.elements
  const bounds = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity])
  for (let i = 0; i < p.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = m[k] * p[i] + m[4 + k] * p[i + 1] + m[8 + k] * p[i + 2] + m[12 + k]
      if (v < bounds[k]) bounds[k] = v
      if (v > bounds[k + 3]) bounds[k + 3] = v
    }
  return { ...part, matrix: Float32Array.from(m), bounds }
}

const IDENTITY = new Matrix4()

async function readFcstd({ bytes }: Record<string, unknown>, progress: (message: string) => void) {
  const zip = openZip(bytes as ArrayBuffer)
  const entry = (name: string) => zip.entries.find((e) => e.name === name)
  const text = async (name: string) => {
    const found = entry(name)
    return found ? new TextDecoder().decode(await zip.read(found)) : ''
  }
  const [doc, gui] = await Promise.all([text('Document.xml'), text('GuiDocument.xml')])
  const types = new Map(
    [...doc.matchAll(/<Object type="([^"<>]{1,200})" name="([^"<>]{1,200})"/g)].map((m) => [m[2], m[1]]),
  )
  const visible = new Set<string>()
  const colors = new Map<string, number>()
  const appearances = new Map<string, string>()
  for (const block of xmlElements(gui, '<ViewProvider name="', '</ViewProvider>')) {
    const name = xmlAttribute(block.slice(0, block.indexOf('>') + 1), 'name') ?? ''
    if (/<Bool value="true"/.test(xmlProperty(block, 'Visibility'))) visible.add(name)
    const color = xmlProperty(block, 'ShapeColor').match(/<PropertyColor value="(\d+)"/)?.[1]
    if (color) colors.set(name, Number(color) >>> 8)
    const appearance = xmlProperty(block, 'ShapeAppearance').match(/<MaterialList file="([^"]+)"/)?.[1]
    if (appearance) appearances.set(name, appearance)
  }
  const objects = new Map<string, FcObject>()
  for (const block of xmlElements(doc, '<Object name="', '</Object>')) {
    const object = fcObject(block, types)
    objects.set(object.name, object)
  }
  const parent = new Map<string, string>()
  for (const object of objects.values())
    if (FC_GROUPS.test(object.type)) for (const child of object.group) parent.set(child, object.name)
  const ancestors = (name: string) => {
    const chain: FcObject[] = []
    for (let p = parent.get(name); p && chain.length < FC_MAX_DEPTH; p = parent.get(p)) chain.push(objects.get(p)!)
    return chain
  }
  const shown = (name: string) => visible.has(name) && ancestors(name).every((a) => visible.has(a.name))
  const worldOf = (name: string) =>
    ancestors(name).reduce(
      (matrix, a) => (FC_CONTAINERS.test(a.type) ? a.placement.clone().multiply(matrix) : matrix),
      new Matrix4(),
    )

  const instances: { object: FcObject; matrix: Matrix4; label: string }[] = []
  const externals = new Set<string>()
  let arrays = 0
  const place = (name: string, base: Matrix4, transform: boolean, depth: number, label?: string) => {
    const target = objects.get(name)
    if (!target || depth > FC_MAX_DEPTH || instances.length >= FC_MAX_INSTANCES) return
    if (target.link) return follow(target, transform ? base.clone().multiply(target.placement) : base, depth + 1, label)
    if (target.mesh || (target.shape && (target.type === 'PartDesign::Body' || !FC_NOT_SOLID.test(target.type)))) {
      const own = target.mesh ? target.placement : IDENTITY
      const matrix = transform
        ? base.clone().multiply(own)
        : base.clone().multiply(target.mesh ? IDENTITY : target.placement.clone().invert())
      return instances.push({ object: target, matrix, label: label ?? target.label })
    }
    const inner = transform ? base.clone().multiply(target.placement) : base
    for (const child of target.group) if (visible.has(child)) place(child, inner, true, depth + 1)
  }
  const follow = (link: FcObject, base: Matrix4, depth: number, label = link.label) => {
    const target = link.link!
    if (target.file) externals.add(target.file)
    else if (target.array) arrays++
    else place(target.name, base, target.transform, depth, label)
  }

  for (const object of objects.values()) {
    if (!shown(object.name)) continue
    if (object.link) follow(object, worldOf(object.name).multiply(object.placement), 0)
    else if ((object.shape && !FC_NOT_SOLID.test(object.type)) || object.mesh) {
      const matrix = worldOf(object.name)
      instances.push({ object, matrix: object.mesh ? matrix.multiply(object.placement) : matrix, label: object.label })
    }
  }
  if (instances.length === 0)
    for (const object of objects.values())
      if (object.shape && object.type === 'PartDesign::Body')
        instances.push({ object, matrix: worldOf(object.name), label: object.label })

  const reader = await loadOcct()
  const parts: ModelPart[] = []
  const root: ModelNode = { name: '', parts: [], children: [] }
  const shapes = new Map<string, ModelPart[]>()
  const warnings: string[] = []
  let failed = 0
  for (const { object, matrix, label } of instances) {
    const file = object.shape ?? object.mesh!
    let shapeParts = shapes.get(file)
    if (!shapeParts) {
      shapeParts = []
      shapes.set(file, shapeParts)
      const found = entry(file)
      if (!found || found.size === 0) continue
      progress(`Tessellating ${object.label}`)
      const data = await zip.read(found)
      if (object.mesh) {
        try {
          const { position, index } = readMeshKernel(data, object.label)
          shapeParts.push(analyzePart({ name: object.label, color: null, position, normal: null, index }))
        } catch (error) {
          warnings.push((error as Error).message)
        }
      } else {
        const result = reader.ReadBrepFile(data, meshParams(found.size))
        if (!result.success) continue
        failed += unmeshed(result)
        const appearanceFile = appearances.get(object.name)
        const appearanceEntry = appearanceFile ? entry(appearanceFile) : undefined
        const appearance = appearanceEntry ? fcAppearance(await zip.read(appearanceEntry)) : null
        shapeParts.push(...partsFromOcct(result, object.label, appearance).parts)
      }
    }
    const color = colors.get(object.name)
    const indices = shapeParts.map((part) => {
      parts.push(placedPart({ ...part, name: label, color: part.color ?? color ?? null }, matrix))
      return parts.length - 1
    })
    if (indices.length) root.children.push({ name: label, parts: indices, children: [] })
  }
  if (failed > 0) warnings.push(`${failed} shapes could not be turned into triangles and are missing.`)
  if (arrays > 0) warnings.push(`${arrays} link ${arrays === 1 ? 'array is' : 'arrays are'} not shown.`)
  if (parts.length === 0 && externals.size > 0)
    throw new Error(
      `This FreeCAD assembly links its parts from other files (${[...externals].join(', ')}), which this viewer can't follow.`,
    )
  return finishModel(
    parts,
    root,
    { unit: 'mm', upAxis: 'z', warnings },
    'No visible solid in this FreeCAD file has geometry.',
  )
}

const TESSELLATE_MS = { shape: 3, megabyte: 150, face: 0.43, spline: 1.4 }
const MAX_SPLINE_SPANS = 1024

function tessellateMs(shape: { step: string | null; faces: number; splines: number }) {
  if (!shape.step) return 0
  return (
    TESSELLATE_MS.shape +
    (TESSELLATE_MS.megabyte * shape.step.length) / 1e6 +
    TESSELLATE_MS.face * shape.faces +
    TESSELLATE_MS.spline * shape.splines
  )
}

async function savedPreview(png: Uint8Array | null): Promise<ModelPreview | null> {
  if (!png || typeof OffscreenCanvas === 'undefined') return null
  try {
    const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
    const words = new Uint32Array(pixels.data.buffer)
    if (words.every((word) => word === words[0])) return null
    return { width: pixels.width, height: pixels.height, rgba: new Uint8Array(pixels.data.buffer) }
  } catch {
    return null
  }
}

async function meshShapes(shapes: Map<string, FusionShape>, progress: (message: string, expect?: number) => void) {
  const reader = [...shapes.values()].some((shape) => shape.step) ? await loadOcct() : null
  let expect = 0
  for (const shape of shapes.values()) if (shape.spans <= MAX_SPLINE_SPANS) expect += tessellateMs(shape)
  progress('Tessellating solids', expect)
  const meshed = new Map<string, ModelPart[]>()
  const skipped = new Set<string>()
  let failed = 0
  for (const [key, shape] of shapes) {
    if (shape.mesh) {
      const { positions: position, indices: index } = shape.mesh
      meshed.set(key, [analyzePart({ name: '', color: packColor(shape.colour), position, normal: null, index })])
      continue
    }
    if (!shape.step || !reader) continue
    if (shape.spans > MAX_SPLINE_SPANS) {
      skipped.add(key)
      continue
    }
    const content = new TextEncoder().encode(shape.step)
    const result = reader.ReadStepFile(content, meshParams(content.byteLength))
    if (!result.success) {
      failed++
      continue
    }
    failed += unmeshed(result)
    meshed.set(key, partsFromOcct(result, undefined, appearance(shape)).parts)
  }
  return { meshed, failed, skipped }
}

async function readF3d({ bytes, name }: Record<string, unknown>, progress: (message: string, expect?: number) => void) {
  progress('Reading the Fusion design')
  const fusion = await readFusion(bytes as ArrayBuffer, String(name ?? ''))
  const preview = await savedPreview(fusion.preview)
  const warnings = [...fusion.warnings]
  const parts: ModelPart[] = []
  const hidden: number[] = []
  const appear: (number | null)[] = []
  const changed: number[][] = []
  const keys: string[] = []
  const root: ModelNode = { name: '', parts: [], children: [] }
  if (fusion.instances.length > 0) {
    const { meshed, failed, skipped } = await meshShapes(fusion.shapes, progress)
    progress('Placing components')
    const nodes = new Map<string, ModelNode>([['', root]])
    const nodeFor = (path: string[]) => {
      let key = ''
      let node = root
      for (const label of path) {
        key += `/${label}`
        let next = nodes.get(key)
        if (!next) {
          next = { name: label, parts: [], children: [] }
          node.children.push(next)
          nodes.set(key, next)
        }
        node = next
      }
      return node
    }
    for (const instance of fusion.instances) {
      const matrix = instance.matrix ? new Matrix4().fromArray(instance.matrix) : IDENTITY
      for (const part of meshed.get(instance.shape) ?? []) {
        if (!instance.visible) hidden.push(parts.length)
        appear.push(instance.appear)
        changed.push(instance.changed)
        keys.push(instance.shape)
        nodeFor(instance.path).parts.push(parts.length)
        parts.push(placedPart({ ...part, name: instance.name }, matrix))
      }
    }
    if (failed > 0) warnings.push(`${failed} bodies could not be turned into triangles and are missing.`)
    const tooDetailed = [...new Set(fusion.instances.filter((i) => skipped.has(i.shape)).map((i) => i.name))]
    if (tooDetailed.length > 0)
      warnings.push(
        `Left out ${tooDetailed.slice(0, 3).join(', ')}${tooDetailed.length > 3 ? ` and ${tooDetailed.length - 3} more` : ''}: ${tooDetailed.length === 1 ? 'it has' : 'they have'} curved faces so long, like a modelled thread, that OpenCascade takes minutes to mesh them.`,
      )
  }
  if (parts.length === 0) {
    const reason =
      warnings[0] ??
      (fusion.shapes.size
        ? 'None of the bodies in this design could be shown.'
        : 'This Fusion design has no bodies in it.')
    if (!preview) throw new Error(reason)
    if (warnings.length === 0) warnings.push(reason)
  }
  const timeline =
    fusion.timeline.length > 1
      ? {
          steps: fusion.timeline,
          kinds: fusion.kinds,
          times: fusion.times,
          groups: fusion.groups,
          appear,
          changed,
          ...(fusion.history ? { keys } : {}),
        }
      : undefined
  return finishModel(parts, root, { unit: 'mm', upAxis: fusion.up, warnings, preview, hidden, timeline }, null)
}

async function readF3dHistory(
  { bytes, name }: Record<string, unknown>,
  progress: (message: string, expect?: number) => void,
) {
  progress('Rebuilding the design history')
  const fusion = await readFusionHistory(bytes as ArrayBuffer, String(name ?? ''))
  const { meshed } = await meshShapes(fusion.shapes, progress)
  const history: ModelHistory = {
    parts: [],
    appear: [],
    until: [],
    tools: [],
    finals: Object.fromEntries(fusion.finals),
  }
  for (const instance of fusion.instances) {
    const matrix = instance.matrix ? new Matrix4().fromArray(instance.matrix) : IDENTITY
    for (const part of meshed.get(instance.shape) ?? []) {
      if (instance.ghost) history.tools.push(history.parts.length)
      history.parts.push(placedPart({ ...part, name: instance.name }, matrix))
      history.appear.push(instance.appear ?? 0)
      history.until.push(instance.until)
    }
  }
  return { result: history, transfer: transferablesOf(history) }
}

async function readXt({ bytes, name }: Record<string, unknown>, progress: (message: string, expect?: number) => void) {
  progress('Reading the Parasolid bodies')
  return solidModel(await readParasolid(new Uint8Array(bytes as ArrayBuffer), String(name ?? '')), progress)
}

async function readAutocad(
  { bytes, name }: Record<string, unknown>,
  progress: (message: string, expect?: number) => void,
) {
  progress('Reading the AutoCAD solids')
  return solidModel(await readDwg(new Uint8Array(bytes as ArrayBuffer), String(name ?? '')), progress)
}

async function solidModel(model: ParasolidModel, progress: (message: string, expect?: number) => void) {
  const preview = await savedPreview(model.preview)
  const warnings = [...model.warnings]
  const parts: ModelPart[] = []
  const root: ModelNode = { name: '', parts: [], children: [] }
  if (model.shapes.length > 0) {
    const reader = await loadOcct()
    progress(
      'Tessellating solids',
      model.shapes.reduce((sum, shape) => sum + tessellateMs(shape), 0),
    )
    let failed = 0
    for (const shape of model.shapes) {
      const content = new TextEncoder().encode(shape.step)
      const result = reader.ReadStepFile(content, meshParams(content.byteLength))
      if (!result.success) {
        failed++
        continue
      }
      failed += unmeshed(result)
      for (const part of partsFromOcct(result, shape.name, appearance(shape)).parts) {
        root.parts.push(parts.length)
        parts.push({ ...part, name: shape.name })
      }
    }
    if (failed > 0) warnings.push(`${failed} bodies could not be turned into triangles and are missing.`)
  }
  if (parts.length === 0) {
    const reason =
      warnings[0] ??
      (model.shapes.length ? 'None of the bodies in this file could be shown.' : 'This file has no solid bodies in it.')
    if (!preview) throw new Error(reason)
    if (warnings.length === 0) warnings.push(reason)
  }
  return finishModel(parts, root, { unit: 'mm', upAxis: model.up, warnings, preview }, null)
}

async function readStl({ bytes }: Record<string, unknown>, progress: (message: string) => void) {
  progress('Reading triangles')
  let geometry: import('three').BufferGeometry & { hasColors?: boolean }
  try {
    geometry = new STLLoader().parse(bytes as ArrayBuffer)
  } catch {
    throw new Error('This STL file could not be read. It may be truncated or damaged.')
  }
  const position = geometry.getAttribute('position').array as Float32Array
  if (position.length < 9) throw new Error('This STL file has no triangles. It may be truncated or damaged.')
  const color = geometry.getAttribute('color')
  let colors: Uint8Array | null = null
  if (geometry.hasColors && color) {
    colors = new Uint8Array(color.array.length)
    for (let i = 0; i < colors.length; i++) colors[i] = Math.round((color.array[i] as number) * 255)
  }
  progress('Finding edges')
  const part = analyzePart({ name: 'Mesh', color: null, position, normal: null, index: null, colors })
  return finishModel([part], { name: '', parts: [0], children: [] }, { unit: 'unknown', upAxis: 'z', warnings: [] })
}

async function read3mf({ bytes }: Record<string, unknown>, progress: (message: string) => void) {
  progress('Reading the model')
  const document = await readThreeMf(bytes as ArrayBuffer)
  if (!document) throw new Error(THREEMF_UNSUPPORTED)
  const { parts, root } = threeMfModel(document)
  progress('Finding edges')
  return finishModel(parts.map(analyzePart), root, { unit: 'mm', upAxis: 'z', warnings: [] })
}

async function analyze(payload: Record<string, unknown>, progress: (message: string) => void) {
  progress('Finding edges')
  const inputs = payload.parts as PartInput[]
  const parts = inputs.map(analyzePart)
  const data = payload.meta as Omit<ModelData, 'parts' | 'root'>
  return finishModel(parts, payload.root as ModelNode, data)
}

serveWorker({
  occt: readOcct,
  fcstd: readFcstd,
  fusion: readF3d,
  fusionHistory: readF3dHistory,
  parasolid: readXt,
  dwg: readAutocad,
  stl: readStl,
  '3mf': read3mf,
  blend: readBlend,
  analyze,
  wire: wireIndices,
})
