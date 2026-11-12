import type { Cfb } from '../../core/cfb'
import { readPropertySets, type PropertySet } from './propset'
import { emptyInfo, type CadFeature, type CadInfo, type CadPreview, type CadReference } from './types'
import {
  DAMAGED,
  LIBRARY_PATH,
  MAX_SECTION,
  attr,
  basename,
  crc32,
  dibToBmp,
  isPng,
  property,
  unescapeXml,
  xmlText,
} from './shared'
import { inflateTo } from '../office/inflate'

const DOC_TYPES: Record<string, string> = { sldprt: 'Part', sldasm: 'Assembly', slddrw: 'Drawing' }
const MAX_SHEETS = 24
const LENGTH_UNITS = [
  'millimeters',
  'centimeters',
  'meters',
  'inches',
  'feet',
  'feet and inches',
  'ångströms',
  'nanometers',
  'micrometers',
  'mils',
  'microinches',
]
const PLACEHOLDER_DENSITY = 1000
const DEFLATE_RATIO = 1032
const MAX_CANDIDATES = 4
const VERSION = /^_MO_VERSION_(\d+)\//
const utf16 = new TextDecoder('utf-16le')

interface Section {
  crc: number
  start: number
  csize: number
  usize: number
}

export function isSwContainer(bytes: Uint8Array) {
  if (bytes.length < 64 || bytes[4] !== 0 || bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 4) return false
  for (let i = 8; i < 64; i++) if (isMark(bytes, i)) return true
  return false
}

function isMark(bytes: Uint8Array, i: number) {
  return (
    bytes[i] === 0x14 &&
    bytes[i + 1] === 0 &&
    bytes[i + 2] === 0x06 &&
    bytes[i + 3] === 0 &&
    bytes[i + 4] === 0x08 &&
    bytes[i + 5] === 0
  )
}

function indexContainer(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sections = new Map<string, Section[]>()
  for (let i = 8; i + 26 < bytes.length; i++) {
    if (bytes[i] !== 0x14 || !isMark(bytes, i)) continue
    const csize = view.getUint32(i + 14, true)
    const usize = view.getUint32(i + 18, true)
    const nameLength = view.getUint16(i + 22, true)
    const start = i + 26 + nameLength + view.getUint16(i + 24, true)
    if (
      nameLength === 0 ||
      nameLength > 260 ||
      start + csize > bytes.length ||
      usize > MAX_SECTION ||
      usize > csize * DEFLATE_RATIO
    )
      continue
    let name = ''
    for (let k = 0; k < nameLength; k++) {
      const b = bytes[i + 26 + k]
      const c = ((b << 4) | (b >> 4)) & 0xff
      if (c < 0x20 || c > 0x7e) {
        name = ''
        break
      }
      name += String.fromCharCode(c)
    }
    if (!name) continue
    const list = sections.get(name) ?? []
    list.push({ crc: view.getUint32(i + 10, true), start, csize, usize })
    sections.set(name, list)
  }
  return sections
}

function savedWith(names: Iterable<string>) {
  let revision = 0
  for (const name of names) revision = Math.max(revision, Number(VERSION.exec(name)?.[1] ?? 0))
  if (revision < 1000) return null
  return `SOLIDWORKS ${revision >= 9000 && revision < 10000 ? 2015 : 2007 + Math.floor(revision / 1000)}`
}

function xmlProperties(xml: string) {
  const out: { name: string; value: string }[] = []
  for (const m of xml.matchAll(/<property name="([^"]*)" pid="\d+"[^>]*>\s*<vt:\w+(?:\s[^>]*)?>([^<]*)</g))
    out.push({ name: unescapeXml(m[1]), value: unescapeXml(m[2]) })
  return out
}

function massOf(value: string, material: string | null): CadInfo['mass'] {
  const parts = value.split(',').map((s) => s.trim())
  if (parts.length < 13 || parts[12] !== '1.000000') return null
  const read = (i: number) => {
    const n = Number(parts[i])
    return Number.isFinite(n) && n >= 0 ? { n, error: 0.5 * 10 ** -(parts[i].split('.')[1]?.length ?? 0) } : null
  }
  const precise = (i: number) => {
    const r = read(i)
    return r && r.n > 0 && r.error / r.n < 0.005 ? r.n : null
  }
  const mass = read(5)
  const volume = read(3)
  if (!mass || mass.n === 0) return null
  const lowest = (mass.n - mass.error) / (volume ? volume.n + volume.error : Infinity)
  const highest = volume && volume.n > volume.error ? (mass.n + mass.error) / (volume.n - volume.error) : Infinity
  const placeholder = !material && lowest <= PLACEHOLDER_DENSITY * 1.001 && highest >= PLACEHOLDER_DENSITY * 0.999
  const result = { kg: placeholder ? null : precise(5), m3: precise(3), m2: precise(4) }
  return result.kg || result.m3 || result.m2 ? result : null
}

function previewOf(png: Uint8Array | null, dib: Uint8Array | null): CadPreview | null {
  const bmp = dib && dib.length > 48 ? dibToBmp(dib.subarray(4)) : null
  if (isPng(png) && (!bmp || area(png, 16, false) >= area(bmp, 18, true)))
    return { label: 'Preview', mime: 'image/png', bytes: png }
  return bmp ? { label: 'Preview', mime: 'image/bmp', bytes: bmp } : null
}

function area(bytes: Uint8Array, at: number, littleEndian: boolean) {
  if (bytes.length < at + 8) return 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Math.abs(view.getInt32(at, littleEndian) * view.getInt32(at + 4, littleEndian))
}

function treeOrder(id: string | undefined) {
  return id && /^\d+$/.test(id) ? Number(id) : Number.MAX_SAFE_INTEGER
}

function readKeywords(xml: string, info: CadInfo) {
  const configs = new Map<string, string>()
  const entries = [...xml.matchAll(/<Configuration\s[^<>]*>/g)]
    .map((m, i) => ({ id: attr(m[0], 'id') ?? String(i), name: attr(m[0], 'Name'), material: attr(m[0], 'Material') }))
    .sort((a, b) => treeOrder(a.id) - treeOrder(b.id))
  for (const { id, name, material } of entries) {
    if (name) configs.set(id, name)
    if (material && !info.material && !/<[^>]*>$/.test(material)) info.material = material
  }
  info.configurations = [...new Set(configs.values())]
  const features: { order: number; feature: CadFeature }[] = []
  const stack: { order: number; feature: CadFeature }[] = []
  let inDimension = false
  for (const m of xml.matchAll(/<(\/?)([\w:-]+)([^<>]*?)(\/?)>|([^<]+)/g)) {
    if (features.length >= 1000) break
    const [, closing, tag, attrs, selfClosing, text] = m
    if (text !== undefined) {
      const owner = stack[stack.length - 1]?.feature
      if (inDimension && owner && owner.dimensions.length < 12)
        owner.dimensions.push(
          unescapeXml(text)
            .replace(/<MOD-DIAM>/g, '⌀')
            .replace(/<[^<>]+>/g, ''),
        )
    } else if (tag === 'Dimension') {
      inDimension = !closing && !selfClosing
    } else if (closing) {
      const entry = stack.pop()
      if (entry && stack.length > 0 && entry.feature.name && entry.feature.dimensions.length > 0) features.push(entry)
    } else if (!selfClosing) {
      stack.push({ order: treeOrder(attr(attrs, 'id')), feature: { name: attr(attrs, 'Name') ?? '', dimensions: [] } })
    }
  }
  info.features = features.sort((a, b) => a.order - b.order).map((f) => f.feature)
  return configs
}

function mfcStrings(bytes: Uint8Array) {
  const out: string[] = []
  for (let i = 0; i + 4 <= bytes.length && out.length < MAX_SHEETS; i++) {
    if (bytes[i] !== 0xff || bytes[i + 1] !== 0xfe || bytes[i + 2] !== 0xff) continue
    let length = bytes[i + 3]
    let o = i + 4
    if (length === 0xff) {
      length = bytes[i + 4] | (bytes[i + 5] << 8)
      o = i + 6
    }
    if (o + length * 2 > bytes.length) break
    out.push(utf16.decode(bytes.subarray(o, o + length * 2)))
    i = o + length * 2 - 1
  }
  return out
}

function modelPaths(bytes: Uint8Array) {
  const found = new Map<string, CadReference>()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const char = (at: number) => (at >= 0 && at + 1 < bytes.length ? view.getUint16(at, true) : 0)
  const allowed = (c: number) => c >= 0x20 && !'"<>|*?'.includes(String.fromCharCode(c))
  for (let i = 2; i + 13 < bytes.length && found.size < 200; i++) {
    if (bytes[i] !== 0x2e || bytes[i + 1] !== 0 || (bytes[i + 2] | 0x20) !== 0x73) continue
    const end = i + 14
    if (
      !/^sld(prt|asm)$/i.test(utf16.decode(bytes.subarray(i + 2, end))) ||
      /[a-z]/i.test(String.fromCharCode(char(end)))
    )
      continue
    let start = i
    while (i - start < 520 && allowed(char(start - 2))) start -= 2
    const name = basename(utf16.decode(bytes.subarray(start, end)))
    if (start < i && name.length > 7 && !found.has(name.toLowerCase()))
      found.set(name.toLowerCase(), { name, embedded: false })
    i = end - 1
  }
  return [...found.values()]
}

function assemblyReferences(xml: string, embeddedSections: Set<string>) {
  const references = new Map<string, CadReference>()
  for (const m of [...xml.matchAll(/<swFile\s[^<>]*>/g)].slice(1)) {
    const path = attr(m[0], 'swPath')
    if (!path) continue
    const name = basename(path)
    if (references.has(name.toLowerCase())) continue
    const imported = attr(m[0], 'swImportedPath')
    references.set(name.toLowerCase(), {
      name,
      embedded: /\\IC~~\\|\^/.test(path) || embeddedSections.has(name.toLowerCase()),
      library: LIBRARY_PATH.test(path),
      importedFrom: imported ? basename(imported) : undefined,
    })
    if (references.size >= 1000) break
  }
  const instances = [...xml.matchAll(/<swReference\s/g)].length
  return { references: [...references.values()], instances }
}

async function readSection(bytes: Uint8Array, sections: Map<string, Section[]>, name: string) {
  for (const section of (sections.get(name) ?? []).slice(-MAX_CANDIDATES).reverse()) {
    try {
      const out = await inflateTo(
        bytes.subarray(section.start, section.start + section.csize),
        section.usize,
        'deflate-raw',
      )
      if (crc32(out) === section.crc) return out
    } catch {
      continue
    }
  }
  return null
}

export function solidworksSections(bytes: Uint8Array) {
  const sections = indexContainer(bytes)
  return { names: [...sections.keys()], read: (name: string) => readSection(bytes, sections, name) }
}

export async function solidworksContainer(bytes: Uint8Array, ext: string): Promise<CadInfo> {
  const sections = indexContainer(bytes)
  if (!sections.has('docProps/core.xml') && !savedWith(sections.keys())) throw new Error(DAMAGED)
  const info = emptyInfo('SolidWorks', DOC_TYPES[ext] ?? 'Document', 'SOLIDWORKS 2015+ container')
  info.savedWith = savedWith(sections.keys())

  const get = (name: string) => readSection(bytes, sections, name)
  const getXml = async (name: string) => {
    const section = await get(name)
    return section ? xmlText(section) : null
  }

  const preview = previewOf(await get('PreviewPNG'), await get('Preview'))
  if (preview) info.previews.push(preview)

  const core = await getXml('docProps/core.xml')
  if (core) {
    const tag = (name: string) => {
      const value = new RegExp(`<${name}[^<>]*>([^<]*)<`).exec(core)?.[1]
      return value ? unescapeXml(value).trim() || null : null
    }
    info.created = tag('dcterms:created')
    info.modified = tag('dcterms:modified')
    info.lastSavedBy = tag('cp:lastModifiedBy') ?? tag('dc:lastModifiedBy')
    info.author = tag('dc:creator')
    info.title = tag('dc:title')
  }

  const keywords = await getXml('swXmlContents/KeyWords')
  const configs = keywords ? readKeywords(keywords, info) : new Map<string, string>()

  const custom = await getXml('docProps/custom.xml')
  if (custom) for (const p of xmlProperties(custom)) pushProperty(info, p.name, p.value)
  for (const name of [...sections.keys()]
    .filter((n) => /^docProps\/Config-\d+-Properties\.xml$/.test(n))
    .slice(0, 32)) {
    const xml = await getXml(name)
    const id = /Config-(\d+)/.exec(name)![1]
    if (xml)
      for (const p of xmlProperties(xml)) pushProperty(info, p.name, p.value, configs.get(id) ?? `Configuration ${id}`)
  }

  const swInfo = await getXml('docProps/ISolidWorksInformation.xml')
  for (const { name, value } of swInfo ? xmlProperties(swInfo) : []) {
    if (name === 'SW-MassProp-Config-0') info.mass = massOf(value, info.material)
    if (name === 'SW_UnitsLinear') info.lengthUnit = LENGTH_UNITS[Number(value)] ?? null
  }

  if (info.docType === 'Assembly') {
    const tree = await getXml('swXmlContents/COMPINSTANCETREE')
    if (tree) {
      const embedded = new Set(
        [...sections.keys()].filter((n) => n.startsWith('ImportedComp/')).map((n) => basename(n).toLowerCase()),
      )
      const { references, instances } = assemblyReferences(tree, embedded)
      info.references = references
      info.instances = instances
    }
  }

  if (info.docType === 'Drawing') {
    const definition = await get('Contents/Definition')
    if (definition) info.references = modelPaths(definition)
    const names = await get('SheetPreviews/SheetNames')
    const labels = names ? mfcStrings(names) : []
    const sheets: CadPreview[] = []
    for (let i = 0; i < Math.max(labels.length, 1) && i < MAX_SHEETS; i++) {
      const png = await get(`Images/Sheet_${i}`)
      if (isPng(png)) sheets.push({ label: labels[i] || `Sheet ${i + 1}`, mime: 'image/png', bytes: png })
    }
    if (sheets.length > 0) info.previews = [...info.previews.filter((p) => p.mime === 'image/bmp'), ...sheets]
  }
  return info
}

function pushProperty(info: CadInfo, name: string, value: string, config?: string) {
  if (info.properties.length >= 200) return
  const p = property(name, value, config)
  if (p) info.properties.push(p)
}

function pushPropertySets(info: CadInfo, cfb: Cfb, path: string, config?: string) {
  for (const set of propertySets(cfb, path)) {
    for (const [pid, name] of set.names) {
      const value = set.props.get(pid)
      if (typeof value === 'string' || typeof value === 'number') pushProperty(info, name, String(value), config)
    }
  }
}

function propertySets(cfb: Cfb, path: string): PropertySet[] {
  try {
    const stream = cfb.read(path, 4 * 1024 * 1024)
    return stream ? readPropertySets(stream) : []
  } catch {
    return []
  }
}

const SUMMARY = 'F29F85E0-4FF9-1068-AB91-08002B27B3D9'

export async function solidworksOle(cfb: Cfb, ext: string): Promise<CadInfo> {
  const info = emptyInfo('SolidWorks', DOC_TYPES[ext] ?? 'Document', 'OLE compound file (before SOLIDWORKS 2015)')
  info.savedWith = savedWith(cfb.paths) ?? 'SOLIDWORKS 2014 or older'
  const preview = previewOf(cfb.read('PreviewPNG', MAX_SECTION), cfb.read('Preview', MAX_SECTION))
  if (preview) info.previews.push(preview)

  const summary = propertySets(cfb, '\u0005SummaryInformation').find((s) => s.fmtid === SUMMARY)
  if (summary) {
    const text = (pid: number) => {
      const value = summary.props.get(pid)
      return typeof value === 'string' && value.trim() ? value.trim() : null
    }
    const date = (pid: number) => {
      const value = summary.props.get(pid)
      return value instanceof Date ? value.toISOString() : null
    }
    info.title = text(2)
    info.author = text(4)
    info.lastSavedBy = text(8)
    info.created = date(12)
    info.modified = date(13)
  }
  const zlb = cfb.read('swXmlContents/KeyWords__ZLB', MAX_SECTION)
  let configs = new Map<string, string>()
  if (zlb && zlb.length > 24) {
    const view = new DataView(zlb.buffer, zlb.byteOffset, zlb.byteLength)
    const usize = view.getUint32(16, true)
    const csize = view.getUint32(20, true)
    const xml = await inflateTo(zlb.subarray(24, 24 + csize), Math.min(usize, MAX_SECTION)).catch(() => null)
    if (xml) configs = readKeywords(xmlText(xml), info)
  }

  pushPropertySets(info, cfb, '\u0005DocumentSummaryInformation')
  for (const path of cfb.paths.filter((p) => /^Config-\d+-Properties$/.test(p)).slice(0, 32)) {
    const id = /\d+/.exec(path)![0]
    pushPropertySets(info, cfb, path, configs.get(id) ?? `Configuration ${id}`)
  }
  for (const set of propertySets(cfb, 'ISolidWorksInformation')) {
    for (const [pid, name] of set.names) {
      const value = set.props.get(pid)
      if (name === 'SW-MassProp-Config-0' && typeof value === 'string') info.mass = massOf(value, info.material)
      if (name === 'SW_UnitsLinear') info.lengthUnit = LENGTH_UNITS[Number(value)] ?? null
    }
  }
  return info
}
