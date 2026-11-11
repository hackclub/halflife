import { openZip } from '../../core/archive'

export type EasyEdaDocumentKind = 'schematic' | 'pcb' | 'library' | 'project' | 'unknown'

export interface EasyEdaJsonInspection {
  isEasyEda: boolean
  documentKind: EasyEdaDocumentKind
  topLevelKeys: string[]
  hints: string[]
}

export interface EasyEdaArchiveJsonDocument {
  name: string
  text: string
  value: unknown
  inspection: EasyEdaJsonInspection
}

interface ParsedJsonContent {
  value: unknown
  text: string
}

const MAX_ARCHIVE_JSON_SCAN_ENTRIES = 24
const MAX_ARCHIVE_JSON_SCAN_SIZE = 8 * 1024 * 1024

export function tryParseJsonContent(content: ArrayBuffer): ParsedJsonContent | null {
  const bytes = new Uint8Array(content)
  let cursor = 0

  while (cursor < bytes.length) {
    if (isWhitespaceByte(bytes[cursor])) {
      cursor += 1
      continue
    }

    // Some non-zip EasyEDA Pro files include a UTF-8 BOM prefix.
    if (
      cursor + 2 < bytes.length &&
      bytes[cursor] === 0xef &&
      bytes[cursor + 1] === 0xbb &&
      bytes[cursor + 2] === 0xbf
    ) {
      cursor += 3
      continue
    }

    break
  }

  if (cursor >= bytes.length) {
    return null
  }

  const firstToken = bytes[cursor]
  if (firstToken !== 0x7b && firstToken !== 0x5b) {
    return null
  }

  const text = new TextDecoder().decode(content)
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (trimmed.length === 0) {
    return null
  }

  try {
    return {
      value: JSON.parse(trimmed) as unknown,
      text: trimmed,
    }
  } catch {
    return null
  }
}

export function analyzeEasyEdaJson(value: unknown, filename: string): EasyEdaJsonInspection {
  const record = asRecord(value)
  const topLevelKeys = record ? Object.keys(record) : []
  const lowerKeys = new Set(topLevelKeys.map((key) => key.toLowerCase()))
  const hints: string[] = []
  const filenameLower = filename.toLowerCase()
  const baseName = filenameLower.split('/').pop() ?? filenameLower
  const isEsch = baseName.endsWith('.esch')
  const isEpcb = baseName.endsWith('.epcb')
  const isProProjectJson = baseName === 'project.json'
  const isProManifestJson = baseName === 'manifest.json'

  const head = asRecord(record?.head)
  if (head) {
    hints.push('head')
  }

  const hasCanvas = typeof record?.canvas === 'string' || typeof record?.canvas === 'object'
  if (hasCanvas) {
    hints.push('canvas')
  }

  const hasShape = Array.isArray(record?.shape) || typeof record?.shape === 'string'
  if (hasShape) {
    hints.push('shape')
  }

  if (lowerKeys.has('doctype') || typeof head?.docType !== 'undefined') {
    hints.push('docType')
  }

  if (lowerKeys.has('editorversion') || typeof head?.editorVersion === 'string') {
    hints.push('editorVersion')
  }

  const kindScores: Record<EasyEdaDocumentKind, number> = {
    schematic: 0,
    pcb: 0,
    library: 0,
    project: 0,
    unknown: 0,
  }

  if (
    hasAnyKey(lowerKeys, [
      'schematic',
      'schematics',
      'sheet',
      'sheets',
      'netlabel',
      'netlabels',
      'wires',
      'junctions',
    ]) ||
    /(?:^|[._-])(sch|schematic)(?:[._-]|$)/.test(filenameLower)
  ) {
    kindScores.schematic += 2
  }

  if (
    hasAnyKey(lowerKeys, [
      'pcb',
      'board',
      'boards',
      'layers',
      'routerrule',
      'tracks',
      'vias',
      'copperarea',
      'copperareas',
    ]) ||
    /(?:^|[._-])(pcb|board)(?:[._-]|$)/.test(filenameLower)
  ) {
    kindScores.pcb += 2
  }

  if (
    hasAnyKey(lowerKeys, [
      'library',
      'libraries',
      'lib',
      'symbol',
      'symbols',
      'footprint',
      'footprints',
      'packages',
      'components',
      'models',
    ]) ||
    /(?:^|[._-])(lib|library|symbol|footprint)(?:[._-]|$)/.test(filenameLower)
  ) {
    kindScores.library += 2
  }

  if (
    hasAnyKey(lowerKeys, ['project', 'documents', 'docs', 'schematics', 'pcbs']) ||
    /(?:^|[._-])(project|pro)(?:[._-]|$)/.test(filenameLower)
  ) {
    kindScores.project += 2
  }

  if (head && hasCanvas && hasShape) {
    kindScores.schematic += 1
    kindScores.pcb += 1
  }

  if (isEsch) {
    kindScores.schematic += 4
    hints.push('epro:.esch')
  }
  if (isEpcb) {
    kindScores.pcb += 4
    hints.push('epro:.epcb')
  }
  if (isProProjectJson) {
    kindScores.project += 4
    hints.push('epro:project.json')
  }
  if (isProManifestJson) {
    kindScores.project += 3
    hints.push('epro:manifest.json')
  }

  const normalizedDocType = normalizeDocType(record, head)
  if (normalizedDocType === 'schematic') {
    kindScores.schematic += 2
  } else if (normalizedDocType === 'pcb') {
    kindScores.pcb += 2
  } else if (normalizedDocType === 'library') {
    kindScores.library += 2
  } else if (normalizedDocType === 'project') {
    kindScores.project += 2
  }

  const documentKind = selectBestDocumentKind(kindScores)
  const likelyByStructure = head !== null && hasCanvas && hasShape
  const likelyByKeywords =
    hasAnyKey(lowerKeys, [
      'canvas',
      'shape',
      'doctype',
      'editorversion',
      'routerrule',
      'layers',
      'schematics',
      'pcbs',
    ]) || /easyeda|(?:^|[._-])(sch|schematic|pcb|lib|project|epro)(?:[._-]|$)/.test(filenameLower)
  const likelyByProSignature = isEsch || isEpcb || isProProjectJson || isProManifestJson

  return {
    isEasyEda: likelyByStructure || likelyByKeywords || likelyByProSignature || documentKind !== 'unknown',
    documentKind,
    topLevelKeys,
    hints,
  }
}

export async function extractPrimaryEasyEdaArchiveJsonDocument(
  content: ArrayBuffer,
): Promise<EasyEdaArchiveJsonDocument | null> {
  const archive = openZip(content)
  const candidates = archive.entries
    .filter((entry) => !entry.dir && hasInspectableJsonExtension(entry.name))
    .sort((a, b) => rankEasyEdaName(b.name) - rankEasyEdaName(a.name))
    .slice(0, MAX_ARCHIVE_JSON_SCAN_ENTRIES)

  let fallback: EasyEdaArchiveJsonDocument | null = null
  for (const entry of candidates) {
    if (entry.size > MAX_ARCHIVE_JSON_SCAN_SIZE) continue
    try {
      const data = await archive.read(entry)
      const parsed = tryParseJsonContent(data.slice().buffer as ArrayBuffer)
      if (!parsed) continue
      const inspection = analyzeEasyEdaJson(parsed.value, entry.name)
      const candidate: EasyEdaArchiveJsonDocument = {
        name: entry.name,
        text: parsed.text,
        value: parsed.value,
        inspection,
      }
      fallback ??= candidate
      if (inspection.isEasyEda) return candidate
    } catch {
      continue
    }
  }
  return fallback
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function hasAnyKey(keys: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => keys.has(candidate))
}

function selectBestDocumentKind(scores: Record<EasyEdaDocumentKind, number>): EasyEdaDocumentKind {
  const candidates: EasyEdaDocumentKind[] = ['project', 'pcb', 'schematic', 'library']
  let selected: EasyEdaDocumentKind = 'unknown'
  let bestScore = 0

  for (const kind of candidates) {
    const score = scores[kind]
    if (score > bestScore) {
      bestScore = score
      selected = kind
    }
  }

  return selected
}

function normalizeDocType(
  record: Record<string, unknown> | null,
  head: Record<string, unknown> | null,
): EasyEdaDocumentKind | null {
  const rawDocType = head?.docType ?? record?.docType
  if (typeof rawDocType !== 'string' && typeof rawDocType !== 'number') {
    return null
  }

  const normalized = String(rawDocType).toLowerCase()
  if (normalized.includes('schematic') || normalized === 'sch') {
    return 'schematic'
  }
  if (normalized.includes('pcb') || normalized.includes('board')) {
    return 'pcb'
  }
  if (normalized.includes('lib') || normalized.includes('symbol')) {
    return 'library'
  }
  if (normalized.includes('project') || normalized.includes('pro')) {
    return 'project'
  }
  return null
}

function rankEasyEdaName(name: string): number {
  const lower = name.toLowerCase()
  let score = 0
  if (lower.includes('easyeda')) score += 5
  if (lower.endsWith('.epcb')) score += 6
  if (lower.endsWith('.esch')) score += 6
  if (lower.endsWith('/project.json') || lower === 'project.json') score += 5
  if (lower.endsWith('/manifest.json') || lower === 'manifest.json') score += 4
  if (/(?:^|[/_-])(sch|schematic)(?:[._/-]|$)/.test(lower)) score += 4
  if (/(?:^|[/_-])(pcb|board)(?:[._/-]|$)/.test(lower)) score += 4
  if (/(?:^|[/_-])(lib|library|symbol|footprint)(?:[._/-]|$)/.test(lower)) score += 3
  if (/(?:^|[/_-])(project|pro)(?:[._/-]|$)/.test(lower)) score += 2
  return score
}

function hasInspectableJsonExtension(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.json') || lower.endsWith('.esch') || lower.endsWith('.epcb')
}

function isWhitespaceByte(value: number): boolean {
  return value === 0x20 || value === 0x0a || value === 0x0d || value === 0x09
}
