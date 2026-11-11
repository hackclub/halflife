import { useMemo, useState } from 'react'
import type { ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { formatBytes, plural } from '../../core/format'
import { isZip } from '../../core/archive'
import { Failure, Gate, Toolbar } from '../../ui/parts'
import ArchiveViewer from '../ArchiveViewer'
import EasyEdaCanvas from './EasyEdaCanvas'
import ImageSheet from './ImageSheet'
import { readEasyEdaExtra, type ExtraSheet } from './easyedaExtra'
import { analyzeEasyEdaJson, extractPrimaryEasyEdaArchiveJsonDocument, tryParseJsonContent } from './inspect'
import { buildEasyEdaVisualDocument, listEasyEdaDocuments, type EasyEdaVisualDocument } from './visual'
import {
  buildEasyEdaProPcbVisual,
  buildEasyEdaProSchematicVisual,
  extractEasyEdaProArchive,
  parseProDocument,
  type ProArchive,
  type ProDocument,
} from './pro'

type Sheet = ExtraSheet

type Result =
  | { mode: 'sheets'; sheets: Sheet[]; summary: string }
  | { mode: 'json'; document: EasyEdaVisualDocument | null; preview: string; label: string }
  | { mode: 'archive' }

const EMPTY_ARCHIVE: ProArchive = {
  projectInfo: null,
  pcbs: new Map(),
  schematicSheets: new Map(),
  footprints: new Map(),
  symbols: new Map(),
}

function proSheets(archive: ProArchive): Sheet[] {
  const sheets: Sheet[] = []
  for (const [id, doc] of archive.pcbs) {
    const name = archive.projectInfo?.pcbs.find((p) => p.uuid === id)?.name ?? id
    sheets.push({ id: `pcb:${id}`, label: `PCB · ${name}`, build: () => buildEasyEdaProPcbVisual(archive, doc, name) })
  }
  const ordered: string[] = []
  for (const schematic of archive.projectInfo?.schematics ?? []) {
    for (const sheet of schematic.sheets) {
      const key = `${schematic.uuid}/${sheet.id}`
      if (archive.schematicSheets.has(key)) ordered.push(key)
    }
  }
  for (const key of archive.schematicSheets.keys()) if (!ordered.includes(key)) ordered.push(key)
  for (const key of ordered) {
    const doc = archive.schematicSheets.get(key)!
    const [uuid, sheetId] = key.split('/')
    const info = archive.projectInfo?.schematics
      .find((s) => s.uuid === uuid)
      ?.sheets.find((s) => String(s.id) === sheetId || s.uuid === sheetId)
    const name = info?.name ?? key
    sheets.push({
      id: `sch:${key}`,
      label: `Schematic · ${name}`,
      build: () => buildEasyEdaProSchematicVisual(archive, doc, name),
    })
  }
  return sheets
}

function single(doc: ProDocument, name: string, pcb: boolean, library: ProArchive): Sheet {
  return {
    id: 'single',
    label: name,
    build: () =>
      pcb ? buildEasyEdaProPcbVisual(library, doc, name) : buildEasyEdaProSchematicVisual(library, doc, name),
  }
}

const PROJECTS = new Set(['epro', 'epro2', 'eprj'])
const PROJECT_LIMIT = 64 * 1024 * 1024

async function projectLibrary({ file, source }: ViewerProps, signal: AbortSignal): Promise<ProArchive> {
  const distance = (dir: string) => (dir === file.dir ? 0 : dir === '' || file.dir.startsWith(`${dir}/`) ? 1 : 2)
  const projects = source.files
    .filter((f) => PROJECTS.has(f.ext) && f.size <= PROJECT_LIMIT)
    .sort((a, b) => distance(a.dir) - distance(b.dir))
  for (const project of projects.length === 1 ? projects : projects.filter((f) => distance(f.dir) < 2)) {
    try {
      const bytes = await source.read(project.path, { signal })
      const archive =
        (await readEasyEdaExtra(bytes, project.ext, project.name))?.archive ??
        (isZip(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength))) ? await extractEasyEdaProArchive(bytes) : null)
      if (archive && (archive.symbols.size > 0 || archive.footprints.size > 0)) return archive
    } catch (error) {
      if (signal.aborted) throw error
    }
  }
  return EMPTY_ARCHIVE
}

function jsonResult(value: unknown, name: string, text: string): Result {
  const documents = listEasyEdaDocuments(value)
  if (documents.length > 1) {
    const pcbs = documents.filter((d) => d.kind === 'pcb').length
    return {
      mode: 'sheets',
      summary: [plural(pcbs, 'PCB'), plural(documents.length - pcbs, 'sheet')]
        .filter((p) => !p.startsWith('0 '))
        .join(' · '),
      sheets: documents.map((d, i) => ({
        id: `${d.kind === 'pcb' ? 'pcb' : 'sch'}:${i}`,
        label: `${d.kind === 'pcb' ? 'PCB' : 'Schematic'} · ${d.label}`,
        build: () => buildEasyEdaVisualDocument(d.record, name, d.kind),
      })),
    }
  }
  const inspection = analyzeEasyEdaJson(value, name)
  return {
    mode: 'json',
    document: buildEasyEdaVisualDocument(value, name, inspection.documentKind),
    preview: text.length > 20000 ? `${text.slice(0, 20000)}\n…` : text,
    label: inspection.documentKind === 'unknown' ? 'EasyEDA document' : `EasyEDA ${inspection.documentKind}`,
  }
}

export default function EasyEdaViewer(props: ViewerProps) {
  const { file, source } = props
  const state = useLoad<Result>(
    async ({ signal, progress }) => {
      const bytes = await source.read(file.path, {
        signal,
        onProgress: (l, t) => progress(t ? l / t : null, 'Downloading'),
      })
      progress(null, 'Reading the EasyEDA project')
      const extra = await readEasyEdaExtra(bytes, file.ext, file.name)
      if (extra) {
        const sheets = [...proSheets(extra.archive), ...extra.sheets]
        if (sheets.length === 0) throw new Error('This EasyEDA file has nothing the viewer can draw.')
        return { mode: 'sheets', sheets, summary: extra.summary }
      }
      if (isZip(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)))) {
        const archive = await extractEasyEdaProArchive(bytes)
        const sheets = proSheets(archive)
        if (sheets.length > 0) {
          return {
            mode: 'sheets',
            sheets,
            summary: `${archive.pcbs.size} PCB · ${archive.schematicSheets.size} sheets · ${archive.footprints.size} footprints · ${archive.symbols.size} symbols`,
          }
        }
        const json = await extractPrimaryEasyEdaArchiveJsonDocument(bytes)
        return json ? jsonResult(json.value, json.name, json.text) : { mode: 'archive' }
      }
      const parsed = tryParseJsonContent(bytes)
      if (parsed) return jsonResult(parsed.value, file.name, parsed.text)
      const doc = parseProDocument(new TextDecoder().decode(bytes))
      if (!doc) throw new Error('This file is not an EasyEDA document the viewer can read.')
      progress(null, 'Reading parts from the EasyEDA project')
      const library = await projectLibrary(props, signal)
      return {
        mode: 'sheets',
        sheets: [single(doc, file.name, file.ext === 'epcb' || /^pcb$/i.test(doc.docType), library)],
        summary: doc.docType || 'EasyEDA Pro document',
      }
    },
    [source.id, file.path],
  )

  if (state.status === 'ready' && state.value.mode === 'archive') return <ArchiveViewer {...props} />

  return (
    <div className="hurt-easyeda">
      <Gate state={state}>
        {(result) =>
          result.mode === 'sheets' ? (
            <Sheets file={file.name} size={file.size} sheets={result.sheets} summary={result.summary} />
          ) : result.mode === 'json' ? (
            <>
              <Toolbar title={file.name} meta={`${result.label} · ${formatBytes(file.size)}`} />
              {result.document ? (
                <EasyEdaCanvas document={result.document} />
              ) : (
                <pre className="hurt-doc__raw">{result.preview}</pre>
              )}
            </>
          ) : null
        }
      </Gate>
    </div>
  )
}

function Sheets({ file, size, sheets, summary }: { file: string; size: number; sheets: Sheet[]; summary: string }) {
  const built = useMemo(() => new Map<Sheet, EasyEdaVisualDocument | null>(), [sheets])
  const draw = (sheet: Sheet) => {
    if (!built.has(sheet)) built.set(sheet, sheet.build?.() ?? null)
    return built.get(sheet) ?? null
  }
  const [index, setIndex] = useState(() => {
    const drawable = (sheet: Sheet) => Boolean(sheet.image || draw(sheet))
    const pcb = sheets.findIndex((s) => s.id.startsWith('pcb:') && drawable(s))
    return pcb >= 0 ? pcb : Math.max(0, sheets.findIndex(drawable))
  })
  const sheet = sheets[index] ?? sheets[0]
  const document = draw(sheet)
  return (
    <>
      <Toolbar title={file} meta={`${summary} · ${formatBytes(size)}`}>
        {sheets.length > 1 && (
          <select
            className="hurt-select"
            aria-label="Sheet"
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {sheets.map((s, i) => (
              <option key={s.id} value={i}>
                {built.get(s) === null && !s.image ? `${s.label} (empty)` : s.label}
              </option>
            ))}
          </select>
        )}
      </Toolbar>
      {sheet.image ? (
        <ImageSheet image={sheet.image} title={sheet.label} />
      ) : document ? (
        <EasyEdaCanvas document={document} />
      ) : (
        <Failure message="This sheet has nothing the viewer can draw." />
      )}
    </>
  )
}
