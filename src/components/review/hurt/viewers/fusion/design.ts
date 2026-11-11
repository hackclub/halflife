import type { Vec } from '../brep/types'

const COMPONENT = 'E03784ED-5E19-4E14-B9F2-3B07017018CD'
const OCCURRENCE = 'CE2913AA-CFE0-4F04-9102-24424ED3BCFA'
const CHILDREN = '904F885E-D859-4755-A7EF-6EBED8732FAD'
const BODY_LIST = 'CD57BC48-50EC-47DC-975A-FB6DEA72F4DA'
const ASSEMBLY_CONTEXT = '074F9459-89C2-4B7D-8AB4-DCE67AE944FE'
const BODY = 'D3937028-C20C-4E65-B010-94AD418A5C20'
const MESH_BODY = 'EA90DA22-556C-4C61-89BB-20C2681B7A9D'
const MESH_DATA = 'A8338A26-5436-433C-8BAC-C3CF024AD595'
const MESH_FILE = 'A1BAA3F6-4B67-4A0D-BACC-75F38A2230F3'
const MESH_PREFIX = 'ParaMeshGeometry.'
const BLOB_PREFIX = 'BREP.'
const MESH_VISIBLE = 10
const SCENE = '702B9CD2-537C-429E-8CC4-22BEEEB98C37'
const ASSET_LIBRARY = '2C54F6D6-5C2B-4C4A-89A2-2AB486EF152D'
const APPEARANCE_OVERRIDE = '10506394-5BEB-4090-9B33-CF4AC5EBF26D'
const TIMELINE = '2F4C1849-1A5A-4F6C-A086-8DD445CBF94B'
const TIMELINE_GROUP = 'A917FE80-93D6-45AD-B741-93BB1ACA5E61'
const FEATURE_CONTAINER = 'C3423E04-7E85-4B44-8E31-A5FA9C100052'
const FEATURE_OWNER = '3A6D1E62-99F8-4E32-BAAA-DBA0A2CFB27C'
const SKETCH = '8DA771B7-52ED-42FC-94E2-2353FE141373'
const CHANGE_LOG = '6CCF41D5-40BE-48ED-A834-18F3EAED6C57'
const COPIES = new Set([
  'D7015B81-AB4D-4C89-BED7-AA4411E1964A',
  'BA3059E4-4B23-4D02-9D18-E7BB95C991F3',
  'D57B1A22-9D5A-4D7D-A909-E08C579612CA',
  '64E40C8E-E564-469C-8690-5C4E77C1B02C',
])
const FEATURE_KINDS: Record<string, string> = {
  '8DA771B7-52ED-42FC-94E2-2353FE141373': 'sketch',
  'DD405BC2-D673-44F0-8833-5CB2A1C186C7': 'extrude',
  'E3849A15-2FC6-42A0-AF3A-2F1D7273B406': 'revolve',
  'FCBB1707-4450-46B3-9E65-0F61682EA8CA': 'sweep',
  '73615646-8752-4EE6-AD02-0B90804B7CD7': 'sweep',
  'B6678572-C095-4DD1-9348-614677DD0B4A': 'loft',
  'A07D5F17-68CB-464D-9935-BF68E98A865F': 'fillet',
  'F757D611-217B-4B72-9C41-B617BDCE43DA': 'chamfer',
  'E8063467-BC05-4688-8196-AECB90F0EFEE': 'shell',
  '1C037A07-4A15-43F6-ABFC-BBF61B9038D4': 'hole',
  '2A94257F-2020-4B19-9A68-103A2672F1B7': 'combine',
  '65CA3206-E33A-471E-8E40-2C72B57C6181': 'split',
  '7C5886AE-A774-4848-A89C-C3A578A9763A': 'split',
  '64E40C8E-E564-469C-8690-5C4E77C1B02C': 'move',
  '21B67709-045F-4903-B3FA-FD82E3DC3ADA': 'move',
  '359F7902-43B0-445C-8F4B-FED1D15B2680': 'move',
  'D1728651-3640-4CCF-8083-AF7703013978': 'mirror',
  '71BBEDD5-81F8-4585-816B-05908C207204': 'mirror',
  '11F1A5CE-2B57-4476-8480-6994621493C9': 'pattern',
  'AE12AD3F-BB81-4B59-9D34-A599E58E4BF6': 'pattern',
  '85B1FC69-B27E-45F0-A531-385861034644': 'pattern',
  'B0B3D9E5-1C25-47BC-ABCD-E723F193DF1B': 'pattern',
  '54F9ACE8-B5B8-4A6E-B582-64F629511DE4': 'component',
  '428B5C6E-8F2C-42D7-83B7-2C09BD91F83E': 'component',
  '8DFDD543-F823-43AA-BDAF-C638E023F0A0': 'joint',
  '8EE00B00-76BB-49AB-8C25-E837FEC5BDA5': 'joint',
  'D869265F-F339-4751-A066-91D30F81FF08': 'plane',
  '5F40832C-61AA-4A05-95B1-EFA0BA483138': 'plane',
  '4AE62DA3-1846-4C99-8B7F-41F09A397353': 'plane',
  'D7015B81-AB4D-4C89-BED7-AA4411E1964A': 'base',
  '99F6967E-ED35-4222-B906-5CCF0AC70B53': 'base',
  'C3A9ECCE-7D25-4432-A645-3A0D9687F22A': 'emboss',
  '29EF07D3-7BAF-4FA1-A28A-43A36279EA6D': 'remove',
  '2C122D9F-4F8A-6383-D14C-E00CE77B2226': 'remove',
  '4A782808-FBDD-4351-A10A-F7AE5693D330': 'remove',
  'D3DC9613-9714-4DBE-99C4-0A76DB3327F1': 'remove',
  'D57B1A22-9D5A-4D7D-A909-E08C579612CA': 'copy',
  'BA3059E4-4B23-4D02-9D18-E7BB95C991F3': 'copy',
  '82824A10-CE7C-4D87-B4A8-172E9AFFA7D9': 'copy',
  '428956BD-1956-4BAF-A4F8-D01D0C465FF1': 'component',
  '66E375EA-40F1-4115-8D83-0F23DD30593E': 'component',
  '89FB64C8-E332-4EC4-8994-F4494B486865': 'component',
  '2931E994-7A40-490D-A9E0-BE2A17EBF07D': 'component',
  '584D9526-EF22-4F6F-9FE1-5FCF1F3CE575': 'thread',
  'D45FD6C4-161B-4240-BFAC-83A7C2C97A0C': 'scale',
  '548B7CBE-2184-4DB5-8B56-24418E5005DF': 'scale',
  '0EE4A83E-464B-4235-A62F-984F15834C27': 'canvas',
  '04A353F2-AA37-4163-9D4D-A07A7AA9AFA5': 'primitive',
  'DB2E4EDC-ADC2-4220-8A0C-011B6FE41C4F': 'primitive',
  '13BE0EF0-467B-4F5A-BFFB-E0976171B678': 'primitive',
  'F193B033-8CB7-4CC9-B18E-D1E06A07D72E': 'primitive',
}
const MICROSECONDS = 1000
const EARLIEST = Date.UTC(2010, 0, 1)
const LATEST = Date.UTC(2100, 0, 1)
const GROUP_HEADER = 15
const BODY_LINK = 'D26351F0-5940-4D23-AA20-2C35475A6D9E'
const COMPONENT_STEP = '54F9ACE8-B5B8-4A6E-B582-64F629511DE4'
const COMPONENT_LINK = '2D6E13A1-BBEF-4FB3-9277-00D99F634136'
const BODY_TO_COMPONENT = '56225BC7-69B7-446A-9AEA-6AA25BC7806E'
const MAX_STEP_NAME = 64
const STATE_SIZE = 4
const STEP_NAME = /^[A-Za-z][\x20-\x7e]*$/
const OWN_COLOUR = 1
const ASSET_NAME = 1
const EARLY_NUMBER = 10
const REF = 11
const TYPED_REF = 51
const MATERIAL_APPEARANCE = '_physmat_aspects:'
const HIDDEN = '2BB3BB69-B0FD-4D56-B4CD-DEBD30847BE3'
const CAMERA = '736DEAAF-2425-405E-B871-003AAB726295'
const CAMERA_UP = 114
const PLACEMENT = '3B6814F4-D87B-46BD-AD9D-0BE07880F7BB'
const PLACEMENT_PATH = 1
const FIRST_ELEMENT = 9
const LINKED_INDEX = 69
const FOREIGN_FLAG = 18
const MIN_HIDDEN_PATH = 2
const FOREIGN_REF = 23
const BLOB = /BREP\.[0-9A-Fa-f-]{36}\.smbh?$/
const MESH_BLOB = /ParaMeshGeometry\.[0-9A-Fa-f-]{36}\.paramesh$/
const ITEM = /(?:lineage:|vf\.)([^?]+)/
const GUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/
const CLASS_ID = /^(?=(?:[^-]*-){4})[0-9A-Fa-f-]{30,40}$/
const MAX_ID = 2 ** 31
const SOLID_BODY = 2
const SHEET_BODY = 4
const LABEL = /^\d+_\d+$/
const MAX_STRING = 4096
const MIN_SCALE = 1e-12

const utf16 = new TextDecoder('utf-16le')
const latin1 = new TextDecoder('latin1')

export interface DesignAppearance {
  colour: number[] | null
  asset: string
}

export interface DesignBody {
  id: number
  number: number
  name: string
  visible: boolean
  sheet: boolean | null
  centre: Vec | null
  appearance: string | null
  inherited: boolean
  overrides: Map<string, DesignAppearance>
}

export interface DesignBodies {
  blob: string
  bodies: DesignBody[]
}

export interface DesignOccurrence {
  id: number
  index: number | null
  parent: number | null
  component: number | null
  link: string | null
  revision: string | null
  matrix: number[] | null
}

export interface DesignMesh {
  id: number
  name: string
  visible: boolean
  blob: string
  matrix: number[] | null
  appearance: string | null
  inherited: boolean
}

export interface DesignComponent {
  name: string
  lists: DesignBodies[]
  meshes: DesignMesh[]
}

export interface DesignGroup {
  name: string
  start: number
  end: number
}

export interface Design {
  root: number
  components: Map<number, DesignComponent>
  occurrences: DesignOccurrence[]
  hidden: Set<string>
  placed: Map<string, number[]>
  appearances: Map<string, string>
  componentAppearances: Map<number, string>
  timeline: string[]
  states: ({ component: number; state: number } | null)[]
  sketches: Map<number, number>
  copies: Set<number>
  kinds: string[]
  times: (number | null)[]
  groups: DesignGroup[]
  bodySteps: Map<number, number[]>
  occurrenceSteps: Map<number, number>
  moved: Map<number, number>
  meshSteps: Map<string, number>
  up: 'y' | 'z'
}

interface Ref {
  at: number
  id: number
  end: number
}

interface Chunk {
  start: number
  end: number
  id: number
}

class Segment {
  readonly guids: string[] = []
  readonly classOf = new Map<number, number>()
  readonly chunks = new Map<number, Chunk[]>()
  private readonly order: Chunk[] = []
  readonly links = new Map<string, string>()
  private readonly view: DataView

  constructor(
    meta: Uint8Array,
    readonly bulk: Uint8Array,
  ) {
    this.view = new DataView(bulk.buffer, bulk.byteOffset, bulk.byteLength)
    this.readClasses(meta)
    this.readLinks(meta)
    this.readChunks()
  }

  private readLinks(meta: Uint8Array) {
    const view = new DataView(meta.buffer, meta.byteOffset, meta.byteLength)
    for (let at = findUtf16(meta, 'urn:', 160); at >= 0; at = findUtf16(meta, 'urn:', at + 8)) {
      const urn = string(meta, at - 4)?.value.match(ITEM)?.[1]
      const id = at - 4 - 2 * 76 - 8
      if (!urn || view.getUint32(at - 80, true) !== 36 || view.getUint32(at - 156, true) !== 36) continue
      this.links.set(key(view, id), urn)
    }
  }

  private readClasses(meta: Uint8Array) {
    const view = new DataView(meta.buffer, meta.byteOffset, meta.byteLength)
    const text = (at: number) => {
      const length = view.getUint32(at, true)
      if (at + 4 + length > meta.length || length > MAX_STRING) throw new RangeError('Bad design class table.')
      return { value: latin1.decode(meta.subarray(at + 4, at + 4 + length)), next: at + 4 + length }
    }
    let at = -1
    for (let i = 0x40; i + 40 <= meta.length; i++)
      if (view.getUint32(i, true) === 36 && CLASS_ID.test(latin1.decode(meta.subarray(i + 4, i + 40)))) {
        at = i
        break
      }
    while (at >= 0 && at + 4 <= meta.length) {
      const guid = text(at)
      if (!CLASS_ID.test(guid.value)) break
      const parent = text(guid.next)
      const module = text(parent.next + 4)
      const count = view.getUint32(module.next, true)
      let cursor = module.next + 4
      if (cursor + count * 8 > meta.length) break
      for (let i = 0; i < count; i++, cursor += 8)
        if (view.getUint32(cursor + 4, true) === 0) this.classOf.set(view.getUint32(cursor, true), this.guids.length)
      this.guids.push(guid.value.toUpperCase())
      at = cursor
    }
  }

  private readChunks() {
    const { bulk, view } = this
    let last: Chunk | null = null
    for (let i = 0; i + 15 <= bulk.length; i++) {
      if (bulk[i] !== 3 || bulk[i + 1] !== 0 || bulk[i + 2] !== 0 || bulk[i + 3] !== 0) continue
      const [a, b, c] = [bulk[i + 4] - 48, bulk[i + 5] - 48, bulk[i + 6] - 48]
      if (a < 0 || a > 9 || b < 0 || b > 9 || c < 0 || c > 9) continue
      const index = a * 100 + b * 10 + c - 256
      const id = view.getUint32(i + 7, true)
      if (index < 0 || index >= this.guids.length || view.getUint32(i + 11, true) !== 0 || id >= MAX_ID) continue
      if (last) last.end = i
      last = { start: i + 15, end: bulk.length, id }
      this.order.push(last)
      const list = this.chunks.get(id)
      if (list) list.push(last)
      else this.chunks.set(id, [last])
      i += 14
    }
  }

  chunkAt(position: number) {
    let [low, high] = [0, this.order.length - 1]
    while (low <= high) {
      const mid = (low + high) >> 1
      const chunk = this.order[mid]
      if (position < chunk.start) high = mid - 1
      else if (position >= chunk.end) low = mid + 1
      else return chunk
    }
    return null
  }

  ownerAt(position: number) {
    return this.chunkAt(position)?.id ?? null
  }

  guidOf(id: number) {
    const index = this.classOf.get(id)
    return index === undefined ? null : this.guids[index]
  }

  objects(guid: string) {
    const ids: number[] = []
    for (const [id, index] of this.classOf) if (this.guids[index] === guid && this.chunks.has(id)) ids.push(id)
    return ids.sort((a, b) => a - b)
  }

  data(id: number, chunk = 0) {
    const found = this.chunks.get(id)?.[chunk]
    return found ? this.bulk.subarray(found.start, found.end) : new Uint8Array()
  }

  all(id: number) {
    return (this.chunks.get(id) ?? []).map((chunk) => this.bulk.subarray(chunk.start, chunk.end))
  }

  refs(data: Uint8Array) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const found: Ref[] = []
    for (let i = 0; i + REF <= data.length; i++) {
      const end = refEnd(data, view, i)
      if (end < 0) continue
      const id = view.getUint32(i + 1, true)
      if (id === 0 || !this.classOf.has(id)) continue
      found.push({ at: i, id, end })
      i = end - 1
    }
    return found
  }
}

function refEnd(data: Uint8Array, view: DataView, at: number) {
  if (data[at] !== 1 || at + REF > data.length || view.getUint32(at + 5, true) !== 0) return -1
  if (data[at + 9] === 0 && data[at + 10] === 0) return at + REF
  if (at + TYPED_REF > data.length || view.getUint32(at + 9, true) !== 36) return -1
  if (data[at + TYPED_REF - 2] !== 0 || data[at + TYPED_REF - 1] !== 0) return -1
  return CLASS_ID.test(latin1.decode(data.subarray(at + 13, at + 49))) ? at + TYPED_REF : -1
}

function key(view: DataView, at: number) {
  return `${view.getUint32(at + 4, true).toString(16)}:${view.getUint32(at, true).toString(16)}`
}

function linkOf(segment: Segment, data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let i = 0; i + 50 <= data.length; i++) {
    if (data[i] !== 1 || data[i + 9] !== 0 || view.getUint32(i + 10, true) !== 36) continue
    if (latin1.decode(data.subarray(i + 14, i + 50)).toUpperCase() !== COMPONENT) continue
    const link = segment.links.get(key(view, i + 1))
    if (link) return link
  }
  return null
}

function string(data: Uint8Array, at: number) {
  if (at + 4 > data.length) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const length = view.getUint32(at, true)
  if (length > MAX_STRING || at + 4 + length * 2 > data.length) return null
  return { value: utf16.decode(data.subarray(at + 4, at + 4 + length * 2)), next: at + 4 + length * 2 }
}

function findGuid(data: Uint8Array, from = 0) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let i = from; i + 76 <= data.length; i++) {
    if (view.getUint32(i, true) !== 36 || data[i + 5] !== 0) continue
    const found = string(data, i)
    if (found && GUID.test(found.value)) return { at: i, value: found.value, next: found.next }
  }
  return null
}

function findUtf16(data: Uint8Array, value: string, from = 0) {
  const units = new Uint8Array(value.length * 2)
  for (let i = 0; i < value.length; i++) units[i * 2] = value.charCodeAt(i)
  outer: for (let i = data.indexOf(units[0], from); i >= 0 && i + units.length <= data.length; ) {
    for (let k = 1; k < units.length; k++)
      if (data[i + k] !== units[k]) {
        i = data.indexOf(units[0], i + 1)
        continue outer
      }
    return i
  }
  return -1
}

function rigid(values: number[], scaled = false) {
  if (values[12] !== 0 || values[13] !== 0 || values[14] !== 0 || values[15] !== 1) return false
  const scale = scaled ? values[0] ** 2 + values[1] ** 2 + values[2] ** 2 : 1
  if (!(scale > MIN_SCALE)) return false
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let dot = 0
      for (let k = 0; k < 3; k++) dot += values[i * 4 + k] * values[j * 4 + k]
      if (Math.abs(dot - (i === j ? scale : 0)) > 1e-6 * scale) return false
    }
  return true
}

function findMatrix(data: Uint8Array, scaled = false) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let i = 0; i + 128 <= data.length; i++) {
    if (view.getFloat64(i + 120, true) !== 1) continue
    const values = Array.from({ length: 16 }, (_, k) => view.getFloat64(i + k * 8, true))
    if (rigid(values, scaled)) return values
  }
  return null
}

function afterMap(data: Uint8Array, view: DataView) {
  if (data.length < 10) return -1
  if (data[5] !== 1) return 6
  let at = 10
  for (let i = 0, count = view.getUint32(6, true); i < count; i++)
    for (let k = 0; k < 3; k++) {
      if (at + 4 > data.length) return -1
      if (k < 2) at += 4 + view.getUint32(at, true)
      else at = data[at] === 1 && refEnd(data, view, at) > 0 ? refEnd(data, view, at) : at + 1
    }
  return at
}

function massProperties(data: Uint8Array) {
  const unknown = { sheet: null, centre: null }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let at = afterMap(data, view)
  if (at < 0) return unknown
  const label = string(data, at)
  if (label && LABEL.test(label.value)) at = label.next
  if (at + 44 > data.length) return unknown
  const kind = view.getUint32(at, true)
  if (kind !== SOLID_BODY && kind !== SHEET_BODY) return unknown
  const centre = [0, 1, 2].map((k) => view.getFloat64(at + 20 + k * 8, true)) as Vec
  const known = kind === SOLID_BODY && centre.every(Number.isFinite) && centre.some((v) => v !== 0)
  return { sheet: kind === SHEET_BODY, centre: known ? centre : null }
}

function readBody(segment: Segment, id: number) {
  const data = segment.data(id)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const guid = findGuid(data)
  if (!guid || guid.next + 25 > data.length) return null
  if (refEnd(data, view, guid.next) > 0) return readEarlyBody(segment, id, data, view, guid.next)
  const number = view.getUint32(guid.next + 16, true)
  let at = guid.next + 21
  const count = view.getUint32(at, true)
  at += 4
  const overrides = new Map<string, DesignAppearance>()
  for (let i = 0; i < count; i++) {
    const appearance = string(data, at)
    if (!appearance || appearance.next + 16 > data.length) return null
    const rgba = [0, 1, 2].map((k) => view.getFloat32(appearance.next + k * 4, true))
    at = appearance.next + 16
    at = data[at] === 1 && refEnd(data, view, at) > 0 ? refEnd(data, view, at) : at + 1
    const own = data[at] === OWN_COLOUR
    at += 1
    const asset = string(data, at)
    for (let k = 0; k < 2; k++) {
      const next = string(data, at)
      if (!next) return null
      at = next.next
    }
    at += 4
    const kind = string(data, at)
    if (!kind) return null
    at = kind.next + 8
    overrides.set(appearance.value, { colour: own ? rgba : null, asset: assetId(asset!.value) })
  }
  if (at + 6 > data.length) return null
  const visible = data[at + 5] === 1
  const refs = segment.refs(data)
  const scene = refs.find((ref) => segment.guidOf(ref.id) === SCENE)
  const name = scene ? string(data, scene.end)?.value : ''
  return {
    id,
    number,
    visible,
    name: name || `Body${number}`,
    ...massProperties(data),
    ...bodyAppearance(segment, data, refs, at),
    overrides,
  }
}

function readEarlyBody(segment: Segment, id: number, data: Uint8Array, view: DataView, after: number): DesignBody {
  const refs = segment.refs(data)
  const scene = refs.find((ref) => segment.guidOf(ref.id) === SCENE)
  const number = view.getUint32(EARLY_NUMBER, true)
  return {
    id,
    number,
    visible: true,
    name: (scene && string(data, scene.end)?.value) || `Body${number}`,
    sheet: null,
    centre: null,
    ...bodyAppearance(segment, data, refs, after),
    overrides: new Map(),
  }
}

function bodyAppearance(segment: Segment, data: Uint8Array, refs: Ref[], after: number) {
  const library = refs.findLast((ref) => ref.at > after && segment.guidOf(ref.id) === ASSET_LIBRARY)
  const appearance = library ? string(data, library.end + ASSET_NAME) : null
  const lib = appearance && string(data, appearance.next)
  const named = lib && string(data, lib.next + 4)
  return {
    appearance: appearance ? assetId(appearance.value) : null,
    inherited: !!named?.value.includes(MATERIAL_APPEARANCE),
  }
}

function assetId(value: string) {
  return value.slice(0, 36).toUpperCase()
}

function meshFiles(segment: Segment, available: Set<string>) {
  const files = new Map<number, string>()
  for (const id of segment.objects(MESH_FILE)) {
    const data = segment.data(id)
    const at = findUtf16(data, MESH_PREFIX)
    const name = at >= 4 ? string(data, at - 4)?.value : undefined
    if (name && available.has(name)) files.set(id, name)
  }
  const blobs = new Map<number, string>()
  for (const id of segment.objects(MESH_DATA)) {
    const blob = segment
      .refs(segment.data(id))
      .map((ref) => files.get(ref.id))
      .find(Boolean)
    if (blob) blobs.set(id, blob)
  }
  return blobs
}

function readMesh(segment: Segment, id: number, data: Uint8Array, refs: Ref[], blob: string) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const at = afterMap(data, view)
  if (at < 0 || at + MESH_VISIBLE >= data.length) return null
  const scene = refs.find((ref) => segment.guidOf(ref.id) === SCENE)
  const name = scene ? string(data, scene.end)?.value : ''
  return {
    id,
    name: name || `Body${view.getUint32(at, true)}`,
    visible: data[at + MESH_VISIBLE] === 1,
    blob,
    matrix: findMatrix(data, true),
    ...bodyAppearance(segment, data, refs, at),
  }
}

function componentName(segment: Segment, id: number) {
  for (const data of segment.all(id).reverse()) {
    const children = segment.refs(data).find((ref) => segment.guidOf(ref.id) === CHILDREN)
    if (!children) continue
    const guid = findGuid(data, children.end)
    const name = guid && string(data, guid.next)
    if (name?.value) return name.value
  }
  return ''
}

function blobOwners(segment: Segment, blobs: string[]) {
  const wanted = new Set(blobs)
  const owners = new Map<number, string>()
  for (let at = findUtf16(segment.bulk, BLOB_PREFIX); at >= 0; at = findUtf16(segment.bulk, BLOB_PREFIX, at + 2)) {
    const blob = string(segment.bulk, at - 4)?.value
    if (!blob || !wanted.delete(blob)) continue
    const owner = segment.ownerAt(at)
    if (owner !== null) owners.set(owner, blob)
  }
  return owners
}

function homeUp(segment: Segment): 'y' | 'z' {
  const at = findUtf16(segment.bulk, 'HOME')
  const chunk = at < 0 ? null : segment.chunkAt(at)
  if (!chunk) return 'z'
  const camera = segment
    .refs(segment.bulk.subarray(chunk.start, chunk.end))
    .find((ref) => segment.guidOf(ref.id) === CAMERA)
  const data = camera && segment.data(camera.id)
  if (!data || data.length < CAMERA_UP + 24) return 'z'
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const [x, y, z] = [0, 8, 16].map((k) => view.getFloat64(CAMERA_UP + k, true))
  return Math.abs(Math.hypot(x, y, z) - 1) < 1e-6 && Math.abs(y) > Math.abs(z) && Math.abs(y) > Math.abs(x) ? 'y' : 'z'
}

function pathLength(data: Uint8Array) {
  return data.length < 9 ? 0 : new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(5, true)
}

function occurrenceIndex(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const at = data[FOREIGN_FLAG] === 1 ? LINKED_INDEX : refEnd(data, view, FIRST_ELEMENT)
  if (data[4] !== 1 || at < 0 || at + 4 > data.length) return null
  const index = view.getUint32(at, true)
  return index < MAX_ID ? index : null
}

function treePath(ids: number[], occurrences: Map<number, DesignOccurrence>, root: number) {
  const path: number[] = []
  let parent: number | null = root
  while (parent !== null && path.length < ids.length) {
    const next = ids.find((id) => occurrences.get(id)?.parent === parent && !path.includes(id))
    if (next === undefined) break
    path.push(next)
    parent = occurrences.get(next)!.component
  }
  return path.length > 0 && path.length === ids.length ? path : null
}

function foreignOccurrences(segment: Segment, data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const groups = new Map<string, number[]>()
  for (let i = 0; i + FOREIGN_REF + 36 <= data.length; i++) {
    if (data[i] !== 1 || view.getUint32(i + 5, true) !== 0 || data[i + 9] !== 1 || data[i + 18] !== 0) continue
    if (view.getUint32(i + 19, true) !== 36) continue
    if (latin1.decode(data.subarray(i + FOREIGN_REF, i + FOREIGN_REF + 36)).toUpperCase() !== OCCURRENCE) continue
    const link = segment.links.get(key(view, i + 10))
    const id = view.getUint32(i + 1, true)
    if (!link) return null
    const ids = groups.get(link) ?? []
    if (!ids.includes(id)) groups.set(link, [...ids, id])
  }
  return groups
}

export function contextKey(local: number[], groups: Map<string, number[]>) {
  const linked = [...groups]
    .filter(([, ids]) => ids.length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([link, ids]) => `${link}:${[...ids].sort((a, b) => a - b).join(',')}`)
  return [local.join('/'), ...linked].join('>')
}

function targetKey(
  segment: Segment,
  data: Uint8Array,
  refs: Ref[],
  occurrences: Map<number, DesignOccurrence>,
  root: number,
) {
  const ids = [...new Set(refs.filter((ref) => occurrences.has(ref.id)).map((ref) => ref.id))]
  const local = treePath(ids, occurrences, root)
  const groups = local && foreignOccurrences(segment, data)
  if (!local || !groups) return null
  if (groups.size > 0 && occurrences.get(local[local.length - 1])!.component !== null) return null
  return contextKey(local, groups)
}

function readAppearances(
  segment: Segment,
  components: Map<number, DesignComponent>,
  byId: Map<number, DesignOccurrence>,
  root: number,
) {
  const appearances = new Map<string, string>()
  const componentAppearances = new Map<number, string>()
  for (const id of segment.objects(APPEARANCE_OVERRIDE)) {
    const data = segment.data(id)
    const refs = segment.refs(data)
    const library = refs.findIndex((ref) => segment.guidOf(ref.id) === ASSET_LIBRARY)
    const asset = library >= 0 ? string(data, refs[library].end + ASSET_NAME)?.value : null
    if (!asset) continue
    const target = refs.slice(0, library)
    const path = targetKey(segment, data.subarray(0, refs[library].at), target, byId, root)
    const component = target.find((ref) => components.has(ref.id))
    if (path) appearances.set(path, assetId(asset))
    else if (!target.some((ref) => byId.has(ref.id)) && component)
      componentAppearances.set(component.id, assetId(asset))
  }
  return { appearances, componentAppearances }
}

export function readDesign(meta: Uint8Array, bulk: Uint8Array, blobs: string[]): Design | null {
  const segment = new Segment(meta, bulk)
  const names = blobs.map((blob) => blob.slice(blob.lastIndexOf('/') + 1))
  const owners = blobOwners(
    segment,
    names.filter((blob) => BLOB.test(blob)),
  )
  const components = new Map<number, DesignComponent>()
  for (const id of segment.objects(COMPONENT))
    components.set(id, { name: componentName(segment, id), lists: [], meshes: [] })
  if (components.size === 0) return null

  const members = new Map<number, DesignBody[]>()
  for (const id of segment.objects(BODY)) {
    const body = readBody(segment, id)
    const list = segment.refs(segment.data(id)).find((ref) => segment.guidOf(ref.id) === BODY_LIST)
    if (!body || !list) continue
    const bodies = members.get(list.id)
    if (bodies) bodies.push(body)
    else members.set(list.id, [body])
  }
  const contexts = new Map<string, DesignBody[]>()
  for (const id of segment.objects(BODY_LIST)) {
    const refs = segment.refs(segment.data(id))
    const blob = refs.map((ref) => owners.get(ref.id)).find(Boolean)
    if (!blob) continue
    const bodies = (members.get(id) ?? []).sort((a, b) => a.number - b.number)
    const owner = refs.findLast((ref) => components.has(ref.id))
    if (owner) components.get(owner.id)!.lists.push({ blob, bodies })
    else if (refs.some((ref) => segment.guidOf(ref.id) === ASSEMBLY_CONTEXT))
      contexts.set(blob, [...(contexts.get(blob) ?? []), ...bodies.map((body) => ({ ...body, visible: false }))])
  }
  for (const component of components.values())
    for (const list of component.lists) list.bodies = [...(contexts.get(list.blob) ?? []), ...list.bodies]

  const meshBlobs = meshFiles(segment, new Set(names.filter((blob) => MESH_BLOB.test(blob))))
  for (const id of segment.objects(MESH_BODY)) {
    const data = segment.data(id)
    const refs = segment.refs(data)
    const list = refs.find((ref) => segment.guidOf(ref.id) === BODY_LIST)
    const owner = list && segment.refs(segment.data(list.id)).findLast((ref) => components.has(ref.id))
    const blob = refs.map((ref) => meshBlobs.get(ref.id)).find(Boolean)
    const mesh = owner && blob ? readMesh(segment, id, data, refs, blob) : null
    if (owner && mesh) components.get(owner.id)!.meshes.push(mesh)
  }

  const childrenOf = new Map<number, number>()
  for (const id of components.keys())
    for (const data of segment.all(id))
      for (const ref of segment.refs(data)) if (segment.guidOf(ref.id) === CHILDREN) childrenOf.set(ref.id, id)

  const occurrences: DesignOccurrence[] = []
  let root: number | null = null
  for (const id of segment.objects(OCCURRENCE)) {
    const data = segment.data(id)
    const refs = segment.refs(data)
    const parent = refs.map((ref) => childrenOf.get(ref.id)).find((owner) => owner !== undefined) ?? null
    const component = refs.find((ref) => components.has(ref.id))?.id ?? null
    if (parent === null) {
      if (component !== null) root ??= component
      continue
    }
    const link = component === null ? linkOf(segment, data) : null
    const revision = component === null ? (findGuid(data)?.value.toLowerCase() ?? null) : null
    occurrences.push({ id, index: occurrenceIndex(data), parent, component, link, revision, matrix: findMatrix(data) })
  }

  const top = root ?? components.keys().next().value!
  const byId = new Map(occurrences.map((occurrence) => [occurrence.id, occurrence]))
  const hidden = new Set<string>()
  for (const id of segment.objects(HIDDEN)) {
    const data = segment.data(id)
    if (pathLength(data) < MIN_HIDDEN_PATH) continue
    const path = targetKey(segment, data, segment.refs(data), byId, top)
    if (path) hidden.add(path)
  }
  const placed = new Map<string, number[]>()
  for (const id of segment.objects(PLACEMENT)) {
    const data = segment.data(id)
    if (data.length < 9 || data[4] !== PLACEMENT_PATH) continue
    const path = targetKey(segment, data, segment.refs(data), byId, top)
    const matrix = findMatrix(data)
    if (path && matrix) placed.set(path, matrix)
  }
  return {
    root: top,
    components,
    occurrences,
    hidden,
    placed,
    ...readAppearances(segment, components, byId, top),
    ...readTimeline(segment, components, byId),
    up: homeUp(segment),
  }
}

function stepName(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  for (let at = 0; at + 8 <= data.length; at++) {
    const length = view.getUint32(at, true)
    if (length < 2 || length > MAX_STEP_NAME) continue
    const found = string(data, at)
    if (found && STEP_NAME.test(found.value) && !GUID.test(found.value)) {
      const state = at >= STATE_SIZE ? view.getInt32(at - STATE_SIZE, true) : -1
      return { name: found.value, state: state > 0 ? state : null }
    }
  }
  return null
}

function featureOwners(segment: Segment, components: Map<number, DesignComponent>) {
  const owners = new Map<number, number>()
  for (const id of components.keys())
    for (const ref of segment.refs(segment.data(id))) {
      if (segment.guidOf(ref.id) !== FEATURE_CONTAINER) continue
      for (const data of segment.all(ref.id))
        for (const inner of segment.refs(data)) if (segment.guidOf(inner.id) === FEATURE_OWNER) owners.set(inner.id, id)
    }
  return owners
}

function changedAt(segment: Segment, id: number) {
  let latest: number | null = null
  for (const chunk of segment.all(id))
    for (const log of segment.refs(chunk)) {
      if (segment.guidOf(log.id) !== CHANGE_LOG) continue
      const data = segment.data(log.id)
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      for (const ref of segment.refs(data)) {
        if (ref.id !== id || ref.end + 8 > data.length) continue
        const time = Number(view.getBigUint64(ref.end, true)) / MICROSECONDS
        if (time > EARLIEST && time < LATEST) latest = Math.max(latest ?? 0, time)
      }
    }
  return latest
}

function timelineGroups(segment: Segment, index: Map<number, number>) {
  const groups: DesignGroup[] = []
  for (const id of segment.objects(TIMELINE_GROUP)) {
    const data = segment.data(id)
    const members = segment.refs(data)
    const steps = members.map((ref) => index.get(ref.id)).filter((step) => step !== undefined)
    if (!steps.length) continue
    const tail = members.length ? members[members.length - 1].end : GROUP_HEADER
    groups.push({ name: stepName(data.subarray(tail))?.name ?? '', start: Math.min(...steps), end: Math.max(...steps) })
  }
  return groups.sort((a, b) => a.start - b.start).map((group, i) => ({ ...group, name: group.name || `Group${i + 1}` }))
}

function sketchSteps(segment: Segment, entries: number[], index: Map<number, number>) {
  const refs = (id: number) => segment.all(id).flatMap((chunk) => segment.refs(chunk))
  const sketches = new Map<number, number>()
  entries.forEach((id, step) => {
    if (segment.guidOf(id) === SKETCH) return
    let found = -1
    for (const near of refs(id)) {
      if (segment.guidOf(near.id) === FEATURE_OWNER) continue
      for (const link of refs(near.id)) {
        if (segment.guidOf(link.id) !== CHANGE_LOG) continue
        for (const target of refs(link.id)) {
          const at = index.get(target.id)
          if (at !== undefined && at < step && segment.guidOf(target.id) === SKETCH) found = Math.max(found, at)
        }
      }
    }
    if (found >= 0) sketches.set(step, found)
  })
  return sketches
}

function readTimeline(
  segment: Segment,
  components: Map<number, DesignComponent>,
  occurrences: Map<number, DesignOccurrence>,
) {
  const lists = segment.objects(TIMELINE).map((id) => segment.refs(segment.data(id)).map((ref) => ref.id))
  const entries = [...new Set(lists.sort((a, b) => b.length - a.length)[0] ?? [])].filter(
    (id) => segment.guidOf(id) !== FEATURE_CONTAINER && segment.guidOf(id) !== TIMELINE_GROUP,
  )
  const index = new Map(entries.map((id, i) => [id, i]))
  const occurrenceSteps = new Map<number, number>()
  const counts = new Map<string, number>()
  const owners = featureOwners(segment, components)
  const states: Design['states'] = []
  const timeline = entries.map((id, i) => {
    states.push(null)
    const data = segment.data(id)
    const occurrence = segment
      .refs(data)
      .filter((ref) => segment.guidOf(ref.id) === COMPONENT_LINK)
      .map((link) => segment.refs(segment.data(link.id)).find((ref) => occurrences.has(ref.id)))
      .find(Boolean)
    if (occurrence) occurrenceSteps.set(occurrence.id, i)
    if (segment.guidOf(id) === COMPONENT_STEP) {
      const component = occurrence ? occurrences.get(occurrence.id)!.component : null
      return (component !== null && components.get(component)?.name) || 'Component'
    }
    const step = stepName(data)
    const component = segment
      .all(id)
      .flatMap((chunk) => segment.refs(chunk))
      .map((ref) => owners.get(ref.id))
      .find((owner) => owner !== undefined)
    if (step?.state && component !== undefined) states[i] = { component, state: step.state }
    const name = step?.name ?? 'Feature'
    if (/\d$/.test(name)) return name
    const count = (counts.get(name) ?? 0) + 1
    counts.set(name, count)
    return `${name}${count}`
  })
  const bodySteps = new Map<number, number[]>()
  for (const id of segment.objects(BODY_LINK)) {
    const refs = segment.refs(segment.data(id))
    const body = refs.find((ref) => segment.guidOf(ref.id) === BODY)
    const step = refs.map((ref) => index.get(ref.id)).find((i) => i !== undefined)
    if (body && step !== undefined) bodySteps.set(body.id, [...(bodySteps.get(body.id) ?? []), step])
  }
  const { moved, meshSteps } = movedBodies(segment, entries, components, occurrences, occurrenceSteps)
  const copies = new Set(entries.flatMap((id, step) => (COPIES.has(segment.guidOf(id) ?? '') ? [step] : [])))
  return {
    timeline,
    states,
    sketches: sketchSteps(segment, entries, index),
    copies,
    kinds: entries.map((id) => FEATURE_KINDS[segment.guidOf(id) ?? ''] ?? 'feature'),
    times: entries.map((id) => changedAt(segment, id)),
    groups: timelineGroups(segment, index),
    bodySteps,
    occurrenceSteps,
    moved,
    meshSteps,
  }
}

function movedBodies(
  segment: Segment,
  entries: number[],
  components: Map<number, DesignComponent>,
  occurrences: Map<number, DesignOccurrence>,
  occurrenceSteps: Map<number, number>,
) {
  const ownerOf = new Map<number, number>()
  const meshBlobs = new Map<number, string>()
  for (const [id, component] of components) {
    for (const list of component.lists) for (const body of list.bodies) ownerOf.set(body.id, id)
    for (const mesh of component.meshes) meshBlobs.set(mesh.id, mesh.blob)
  }
  const moved = new Map<number, number>()
  const meshSteps = new Map<string, number>()
  entries.forEach((id, step) => {
    const refs = segment.all(id).flatMap((chunk) => segment.refs(chunk))
    for (const ref of refs) {
      const blob = meshBlobs.get(ref.id)
      if (blob && !meshSteps.has(blob)) meshSteps.set(blob, step)
    }
    if (segment.guidOf(id) !== BODY_TO_COMPONENT) return
    const sources = refs.filter((ref) => segment.guidOf(ref.id) === BODY).map((ref) => ref.id)
    for (const body of sources) moved.set(body, step)
    const from = new Set(sources.map((body) => ownerOf.get(body)))
    const targets = new Set(
      refs
        .filter((ref) => segment.guidOf(ref.id) !== COMPONENT)
        .flatMap((ref) => segment.all(ref.id).flatMap((chunk) => segment.refs(chunk)))
        .map((near) => ownerOf.get(near.id))
        .filter((owner) => owner !== undefined && !from.has(owner)),
    )
    for (const occurrence of occurrences.values())
      if (occurrence.component !== null && targets.has(occurrence.component) && !occurrenceSteps.has(occurrence.id))
        occurrenceSteps.set(occurrence.id, step)
  })
  return { moved, meshSteps }
}
