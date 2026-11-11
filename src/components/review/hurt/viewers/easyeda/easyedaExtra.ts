import { isZip, openArchive, openZip, type Archive } from '../../core/archive'
import {
  buildEasyEdaProPcbVisual,
  buildEasyEdaProSchematicVisual,
  extractEasyEdaProArchive,
  parseProDocument,
  type ProArchive,
  type ProDocument,
  type ProRecord,
} from './pro'
import type { EasyEdaVisualDocument } from './visual'
import { plural } from '../../core/format'
import { isSqlite, openSqlite, type SqlValue } from './sqlite'

export interface ExtraSheet {
  id: string
  label: string
  build?: () => EasyEdaVisualDocument | null
  image?: Blob
}

export interface EasyEdaExtra {
  archive: ProArchive
  sheets: ExtraSheet[]
  summary: string
}

type Fields = Record<string, unknown>

interface EpruDoc {
  docType: string
  uuid: string
  title: string
  records: { type: string; id: string; data: Fields }[]
}

const DOC_TYPE = { SCHEMATIC: 1, SYMBOL: 2, PCB: 3, FOOTPRINT: 4 }
const MAX_LIBRARY_SHEETS = 400
const decoder = new TextDecoder()

function emptyArchive(): ProArchive {
  return {
    projectInfo: { schematics: [], pcbs: [] },
    pcbs: new Map(),
    schematicSheets: new Map(),
    footprints: new Map(),
    symbols: new Map(),
  }
}

async function gunzip(data: Uint8Array) {
  const archive = await openArchive(data.slice().buffer as ArrayBuffer)
  return archive.read(archive.entries[0])
}

async function decodeDataStr(value: SqlValue) {
  if (typeof value !== 'string') return ''
  if (!value.startsWith('base64')) return value
  const raw = Uint8Array.from(atob(value.slice(6)), (c) => c.charCodeAt(0))
  return decoder.decode(await gunzip(raw))
}

async function readEprj(bytes: Uint8Array): Promise<{ archive: ProArchive; symbols: number }> {
  const db = openSqlite(bytes)
  const archive = emptyArchive()
  const info = archive.projectInfo!
  const names = new Map<string, string>()
  for (const s of db.rows('schematics')) names.set(String(s.uuid), String(s.display_name || s.name || s.uuid))
  const sheets = new Map<string, { id: number; name: string; uuid: string }[]>()
  for (const row of db.rows('documents')) {
    const doc = parseProDocument(await decodeDataStr(row.dataStr).catch(() => ''))
    if (!doc) continue
    const uuid = String(row.uuid)
    const name = String(row.display_title || row.title || uuid)
    if (row.docType === DOC_TYPE.PCB) {
      archive.pcbs.set(uuid, doc)
      info.pcbs.push({ uuid, name })
    } else if (row.docType === DOC_TYPE.SCHEMATIC) {
      const schematic = String(row.schematic_uuid ?? '')
      const id = Number(row.sheet_id ?? 1)
      archive.schematicSheets.set(`${schematic}/${id}`, doc)
      sheets.set(schematic, [...(sheets.get(schematic) ?? []), { id, name, uuid }])
    }
  }
  for (const [uuid, list] of sheets)
    info.schematics.push({ uuid, name: names.get(uuid) ?? uuid, sheets: list.sort((a, b) => a.id - b.id) })
  let symbols = 0
  for (const row of db.rows('components')) {
    const doc = parseProDocument(await decodeDataStr(row.dataStr).catch(() => ''))
    if (!doc) continue
    ;(row.docType === DOC_TYPE.FOOTPRINT ? archive.footprints : archive.symbols).set(String(row.uuid), doc)
    if (row.docType === DOC_TYPE.SYMBOL) symbols++
  }
  return { archive, symbols }
}

function parseEpru(text: string): EpruDoc[] {
  const docs: EpruDoc[] = []
  let current: EpruDoc | null = null
  for (const line of text.split('\n')) {
    const split = line.indexOf('||')
    if (split < 0) continue
    let head: Fields
    let data: Fields
    try {
      head = JSON.parse(line.slice(0, split))
      const body = line.slice(split + 2).replace(/\|\s*$/, '')
      data = body ? JSON.parse(body) : {}
    } catch {
      continue
    }
    if (!head || !data || typeof data !== 'object') continue
    if (head.type === 'DOCHEAD') {
      current = { docType: String(data.docType ?? ''), uuid: String(data.uuid ?? ''), title: '', records: [] }
      docs.push(current)
    } else if (current) {
      if (head.type === 'META') current.title = String(data.title ?? '')
      current.records.push({ type: String(head.type), id: String(head.id ?? ''), data })
    }
  }
  return docs
}

function layerOf(id: string, data: Fields) {
  if (data.layerId != null) return data.layerId
  try {
    return (JSON.parse(id) as unknown[])[1]
  } catch {
    return null
  }
}

function toV2(doc: EpruDoc): ProDocument {
  const docType = doc.docType === 'FOOTPRINT' ? 'FOOTPRINT' : 'PCB'
  const records: ProRecord[] = [['DOCTYPE', docType, '1.8']]
  for (const { type, id, data: d } of doc.records) {
    const pad = (d.defaultPad ?? {}) as Fields
    const hole = d.hole as Fields | null
    switch (type) {
      case 'LAYER':
        records.push(['LAYER', layerOf(id, d), d.layerType, d.layerName, d.use ? 3 : 0, d.activeColor])
        break
      case 'LINE':
        records.push(['LINE', id, 0, d.netName, d.layerId, d.startX, d.startY, d.endX, d.endY, d.width])
        break
      case 'ARC':
        records.push(['ARC', id, 0, d.netName, d.layerId, d.startX, d.startY, d.endX, d.endY, d.angle, d.width])
        break
      case 'VIA':
        records.push(['VIA', id, 0, d.netName, '', d.centerX, d.centerY, d.holeDiameter, d.viaDiameter])
        break
      case 'PAD':
        records.push([
          'PAD',
          id,
          0,
          d.netName,
          d.layerId,
          d.num,
          d.centerX,
          d.centerY,
          d.padAngle,
          hole ? [hole.holeType, hole.width, hole.height] : null,
          pad.padType === 'POLYGON'
            ? ['POLYGON', pad.path ?? []]
            : [pad.padType, pad.width, pad.height, pad.radius ?? 0],
        ])
        break
      case 'FILL':
        records.push(['FILL', id, 0, d.netName, d.layerId, d.width, 0, d.path])
        break
      case 'POLY':
        records.push(['POLY', id, 0, d.netName, d.layerId, d.width, d.path])
        break
      case 'REGION':
        records.push(['REGION', id, 0, d.layerId, d.width, [], d.path])
        break
      case 'POUR':
        records.push(['POUR', id, 0, d.netName, d.layerId, d.width, d.name, d.order, d.path])
        break
      case 'POURED':
        records.push([
          'POURED',
          id,
          layerOf(id, {}),
          0,
          true,
          ((Array.isArray(d.pourFill) ? d.pourFill : []) as (Fields | null)[]).flatMap((f) =>
            Array.isArray(f?.path) ? f.path : [],
          ),
        ])
        break
      case 'STRING':
        records.push([
          'STRING',
          id,
          0,
          d.layerId,
          d.x,
          d.y,
          d.text,
          d.fontFamily,
          d.fontSize,
          d.strokeWidth,
          0,
          0,
          d.origin,
          d.angle,
        ])
        break
      case 'COMPONENT':
        records.push(['COMPONENT', id, 0, d.layerId, d.x, d.y, d.angle, d.attrs ?? {}])
        break
      case 'ATTR':
        records.push(['ATTR', id, 0, d.parentId, d.layerId, d.x, d.y, d.key, d.value])
        break
    }
  }
  return { docType, records }
}

const ALIGN: Record<string, number> = { LEFT: 0, TOP: 0, CENTER: 1, MIDDLE: 1, RIGHT: 2, BOTTOM: 2 }

function metaOf(doc: EpruDoc) {
  return (doc.records.find((r) => r.type === 'META')?.data ?? {}) as Fields
}

function v3Styles() {
  const ids = new Map<string, string>()
  const records: ProRecord[] = []
  const style = (size: unknown, halign: unknown, valign: unknown) => {
    const key = `${size}|${halign}|${valign}`
    let id = ids.get(key)
    if (!id) {
      id = `v3st${ids.size}`
      ids.set(key, id)
      records.push(['FONTSTYLE', id, null, null, null, size ?? null, null, null, null, null, valign, halign])
    }
    return id
  }
  const fromAlign = (size: unknown, align: unknown) => {
    const [h, v] = typeof align === 'string' ? align.split('_') : []
    return style(size, ALIGN[h] ?? null, ALIGN[v] ?? null)
  }
  return { records, style, fromAlign }
}

function flipY(value: unknown) {
  return typeof value === 'number' ? -value : value
}

function polyPoints(points: unknown) {
  if (!Array.isArray(points)) return []
  return points.flatMap((p) => (p && typeof p === 'object' ? [(p as Fields).x, flipY((p as Fields).y)] : [p]))
}

function v3Shape(type: string, id: string, d: Fields, styles: ReturnType<typeof v3Styles>): ProRecord | null {
  switch (type) {
    case 'POLY':
      return ['POLY', id, polyPoints(d.points), d.closed ? 1 : 0]
    case 'RECT':
      return [
        'RECT',
        id,
        d.dotX1,
        flipY(d.dotY1),
        d.dotX2,
        flipY(d.dotY2),
        d.radiusX ?? 0,
        d.radiusY ?? 0,
        d.rotation ?? 0,
      ]
    case 'CIRCLE':
      return ['CIRCLE', id, d.centerX, flipY(d.centerY), d.radius]
    case 'ELLIPSE':
      return [
        'ELLIPSE',
        id,
        d.centerX,
        flipY(d.centerY),
        Math.abs(Number(d.radiusX) || 0),
        Math.abs(Number(d.radiusY) || 0),
        d.rotation ?? 0,
      ]
    case 'ARC':
      return ['ARC', id, d.startX, flipY(d.startY), d.referX, flipY(d.referY), d.endX, flipY(d.endY)]
    case 'TEXT':
      return ['TEXT', id, d.x, flipY(d.y), d.rotation ?? 0, d.value ?? d.text, styles.fromAlign(d.fontSize, d.align)]
  }
  return null
}

function v3Attr(id: string, d: Fields, styles: ReturnType<typeof v3Styles>, value = d.value): ProRecord {
  return [
    'ATTR',
    id,
    d.parentId ?? '',
    d.key,
    value,
    d.keyVisible ? 1 : 0,
    d.valueVisible ? 1 : 0,
    d.x,
    flipY(d.y),
    d.rotation ?? 0,
    styles.fromAlign(d.fontSize, d.align),
  ]
}

function symbolToV2(doc: EpruDoc): ProDocument {
  const styles = v3Styles()
  const records: ProRecord[] = [
    ['DOCTYPE', 'SYMBOL', '1.1'],
    ['HEAD', { symbolType: metaOf(doc).docType }],
  ]
  const parts = doc.records.filter((r) => r.type === 'PART')
  const byPart = new Map<string, ProRecord[]>(parts.map((p) => [p.id, []]))
  for (const { type, id, data: d } of doc.records) {
    const shape = v3Shape(type, id, d, styles)
    const converted: ProRecord[] =
      type === 'PIN'
        ? [['PIN', id, d.display === false ? 0 : 1, 0, d.x, flipY(d.y), d.length, d.rotation ?? 0]]
        : type === 'ATTR'
          ? [v3Attr(id, d, styles)]
          : type === 'TABLE'
            ? tableToV2(id, d, styles)
            : shape
              ? [shape]
              : []
    ;(byPart.get(String(d.partId ?? '')) ?? byPart.get(parts[0]?.id ?? '') ?? records).push(...converted)
  }
  for (const part of parts) records.push(['PART', part.id, { BBOX: part.data.BBOX }], ...byPart.get(part.id)!)
  return { docType: 'SYMBOL', records: [...styles.records, ...records] }
}

function tableToV2(id: string, d: Fields, styles: ReturnType<typeof v3Styles>): ProRecord[] {
  const cells = (Array.isArray(d.tableCell) ? d.tableCell : []) as Fields[]
  return [
    ['TABLE', id, d.startX, flipY(d.startY), d.rowSizes, d.colSizes],
    ...cells.map((cell): ProRecord => {
      const font = (cell.fontStyle ?? {}) as Fields
      const style = styles.style(font.fontSize, ALIGN[String(font.hAlign)] ?? null, ALIGN[String(font.vAlign)] ?? null)
      return [
        'TABEL_CELL',
        cell.id,
        id,
        cell.value,
        cell.rowIndex,
        cell.columnIndex,
        cell.rowSpan,
        cell.colSpan,
        null,
        null,
        null,
        null,
        style,
      ]
    }),
  ]
}

function pageToV2(doc: EpruDoc, devices: Map<string, Fields>): ProDocument {
  const styles = v3Styles()
  const records: ProRecord[] = []
  const wires = new Map<string, unknown[][]>()
  const componentDevice = new Map<string, Fields>()
  for (const { data: d } of doc.records)
    if (d.key === 'Device' && typeof d.value === 'string' && devices.has(d.value))
      componentDevice.set(String(d.parentId), devices.get(d.value)!)
  const deviceValue = (d: Fields) => {
    const attributes = componentDevice.get(String(d.parentId))
    const raw = attributes?.[String(d.key)]
    if (typeof raw !== 'string') return d.value
    return raw.startsWith('=')
      ? raw.slice(1).replace(/\{([^}]*)\}/g, (_, key: string) => String(attributes?.[key] ?? ''))
      : raw
  }
  for (const { type, id, data: d } of doc.records) {
    if (type === 'COMPONENT')
      records.push(['COMPONENT', id, d.partId, d.x, flipY(d.y), d.rotation ?? 0, d.isMirror ? 1 : 0])
    else if (type === 'ATTR') records.push(v3Attr(id, d, styles, d.value ?? deviceValue(d)))
    else if (type === 'LINE' && typeof d.lineGroup === 'string' && d.lineGroup) {
      const segments = wires.get(d.lineGroup) ?? []
      segments.push([d.startX, flipY(d.startY), d.endX, flipY(d.endY)])
      wires.set(d.lineGroup, segments)
    } else if (type === 'LINE') records.push(['LINE', id, [d.startX, flipY(d.startY), d.endX, flipY(d.endY)]])
    else {
      const shape = v3Shape(type, id, d, styles)
      if (shape) records.push(shape)
    }
  }
  for (const [id, segments] of wires) records.push(['WIRE', id, segments])
  return { docType: 'SCH', records: [['DOCTYPE', 'SCH', '1.1'], ...styles.records, ...records] }
}

async function readEpro2(zip: Archive): Promise<EasyEdaExtra> {
  const archive = emptyArchive()
  const docs: EpruDoc[] = []
  for (const entry of zip.entries)
    if (/\.epru$/i.test(entry.name))
      docs.push(...parseEpru(decoder.decode(await zip.read(entry).catch(() => undefined))))
  const devices = new Map<string, Fields>()
  for (const doc of docs) {
    if (doc.docType === 'DEVICE') devices.set(doc.uuid, (metaOf(doc).attributes ?? {}) as Fields)
    if (doc.docType === 'SYMBOL') archive.symbols.set(doc.uuid, symbolToV2(doc))
    if (doc.docType === 'FOOTPRINT') archive.footprints.set(doc.uuid, toV2(doc))
    if (doc.docType !== 'PCB') continue
    archive.pcbs.set(doc.uuid, toV2(doc))
    archive.projectInfo!.pcbs.push({ uuid: doc.uuid, name: doc.title || doc.uuid })
  }
  const converted = new Set<string>()
  for (const doc of docs) {
    if (doc.docType !== 'SCH_PAGE') continue
    const page = pageToV2(doc, devices)
    if (!page.records.some((r) => r[0] === 'COMPONENT' || r[0] === 'WIRE')) continue
    const schematicId = String(metaOf(doc).schematic ?? '')
    let schematic = archive.projectInfo!.schematics.find((s) => s.uuid === schematicId)
    if (!schematic) {
      const owner = docs.find((d) => d.docType === 'SCH' && d.uuid === schematicId)
      schematic = { uuid: schematicId, name: owner?.title || 'Schematic', sheets: [] }
      archive.projectInfo!.schematics.push(schematic)
    }
    schematic.sheets.push({ id: schematic.sheets.length + 1, name: doc.title || doc.uuid, uuid: doc.uuid })
    archive.schematicSheets.set(`${schematicId}/${doc.uuid}`, page)
    converted.add(doc.uuid)
  }
  const byUuid = new Map(docs.map((d) => [d.uuid, d]))
  const sheets: ExtraSheet[] = []
  for (const entry of zip.entries) {
    const uuid = /^IMAGE\/([^/]+)\.webp$/i.exec(entry.name)?.[1]
    if (!uuid || converted.has(uuid)) continue
    const doc = byUuid.get(uuid)
    const label =
      doc?.docType === 'SCH_PAGE'
        ? `Schematic · ${doc.title || uuid}`
        : doc?.docType === 'PCB'
          ? `PCB render · ${doc.title || uuid}`
          : `Preview · ${doc?.title || uuid}`
    const data = await zip.read(entry).catch(() => null)
    if (data) sheets.push({ id: `image:${uuid}`, label, image: new Blob([data as BlobPart], { type: 'image/webp' }) })
  }
  const counts = [
    plural(archive.pcbs.size, 'PCB'),
    plural(archive.schematicSheets.size, 'sheet'),
    plural(sheets.length, 'preview'),
  ]
  return { archive, sheets, summary: counts.filter((count) => !count.startsWith('0 ')).join(' · ') }
}

function footprintSheet(doc: ProDocument, key: string, name: string): ExtraSheet {
  return {
    id: `footprint:${key}`,
    label: `Footprint · ${name}`,
    build: () => buildEasyEdaProPcbVisual(emptyArchive(), doc, name),
  }
}

function symbolSheet(doc: ProDocument, key: string, name: string): ExtraSheet {
  const placed: ProDocument = {
    docType: 'SCH',
    records: [
      ['COMPONENT', 'symbol', '', 0, 0, 0, 0],
      ['ATTR', 'symbol-ref', 'symbol', 'Symbol', key, 0, 0],
    ],
  }
  return {
    id: `symbol:${key}`,
    label: `Symbol · ${name}`,
    build: () => buildEasyEdaProSchematicVisual({ ...emptyArchive(), symbols: new Map([[key, doc]]) }, placed, name),
  }
}

function attrValue(doc: ProDocument, key: string) {
  const attr = doc.records.find((r) => r[0] === 'ATTR' && (r[7] === key || r[3] === key))
  const value = attr?.[7] === key ? attr[8] : attr?.[4]
  return typeof value === 'string' && value ? value : null
}

function library(archive: ProArchive, titles: Map<string, string>): EasyEdaExtra {
  const sheets: ExtraSheet[] = []
  for (const [key, doc] of archive.footprints)
    sheets.push(footprintSheet(doc, key, titles.get(key) ?? attrValue(doc, 'Footprint') ?? key))
  for (const [key, doc] of archive.symbols)
    sheets.push(symbolSheet(doc, key, titles.get(key) ?? attrValue(doc, 'Symbol') ?? key))
  return {
    archive: emptyArchive(),
    sheets: sheets.slice(0, MAX_LIBRARY_SHEETS),
    summary: [
      archive.footprints.size && plural(archive.footprints.size, 'footprint'),
      archive.symbols.size && plural(archive.symbols.size, 'symbol'),
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

async function libraryTitles(zip: Archive) {
  const titles = new Map<string, string>()
  const entry = zip.entries.find((e) => /(^|\/)device\.json$/i.test(e.name))
  if (!entry) return titles
  try {
    const json = JSON.parse(decoder.decode(await zip.read(entry))) as Record<string, Record<string, Fields>>
    for (const group of [json.footprints, json.symbols])
      for (const [uuid, item] of Object.entries(group ?? {}))
        if (typeof item?.display_title === 'string') titles.set(uuid, item.display_title)
  } catch {
    return titles
  }
  return titles
}

export async function readEasyEdaExtra(bytes: ArrayBuffer, ext: string, name: string): Promise<EasyEdaExtra | null> {
  try {
    return await readExtra(bytes, ext, name)
  } catch (error) {
    if (error instanceof Error && error.constructor === Error) throw error
    throw new Error('This EasyEDA file is damaged or uses a layout the viewer does not know.')
  }
}

async function readExtra(bytes: ArrayBuffer, ext: string, name: string): Promise<EasyEdaExtra | null> {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 100))
  if (isSqlite(head)) {
    const { archive, symbols } = await readEprj(new Uint8Array(bytes))
    const summary = [
      plural(archive.pcbs.size, 'PCB'),
      plural(archive.schematicSheets.size, 'sheet'),
      plural(archive.footprints.size, 'footprint'),
      plural(symbols, 'symbol'),
    ].join(' · ')
    return { archive, sheets: [], summary }
  }
  if (isZip(head)) {
    const zip = openZip(bytes)
    if (zip.entries.some((e) => /\.epru$/i.test(e.name))) return readEpro2(zip)
    if (ext !== 'elibz') return null
    const archive = await extractEasyEdaProArchive(bytes)
    return library(archive, await libraryTitles(zip))
  }
  if (ext !== 'efoo' && ext !== 'esym') return null
  const text = decoder.decode(bytes)
  const v3 = text.trimStart().startsWith('{') ? parseEpru(text)[0] : null
  if (v3 && v3.docType !== 'FOOTPRINT') return null
  const doc = v3 ? toV2(v3) : parseProDocument(text)
  if (!doc) return null
  const archive = emptyArchive()
  ;(/FOOTPRINT/i.test(doc.docType) ? archive.footprints : archive.symbols).set(name, doc)
  return library(archive, new Map())
}
