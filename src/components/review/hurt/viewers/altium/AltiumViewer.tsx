import { useMemo, useState } from 'react'
import type { ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { formatBytes, plural } from '../../core/format'
import { Failure, Gate, TextToggle, Toolbar } from '../../ui/parts'
import HurtIcon from '../../ui/HurtIcon'
import { kindIcon } from '../../explorer/icons'
import EasyEdaCanvas from '../easyeda/EasyEdaCanvas'
import PartsTable from './PartsTable'
import { loadAltium, type AltiumResult } from './load'
import { buildPcb, type PcbModel, type PcbSide } from './pcb'
import { parseProject, type AltiumProject } from './project'
import type { SchResult } from './schematic'

type Tab = 'drawing' | 'parts'

const SIDES: { value: PcbSide; label: string }[] = [
  { value: 'all', label: 'All layers' },
  { value: 'top', label: 'Top side' },
  { value: 'bottom', label: 'Bottom side' },
  { value: 'copper', label: 'Copper only' },
]

export default function AltiumViewer(props: ViewerProps) {
  return props.file.ext === 'prjpcb' ? <Project {...props} /> : <Document {...props} />
}

function Document({ file, source }: ViewerProps) {
  const [tab, setTab] = useState<Tab>('drawing')
  const [side, setSide] = useState<PcbSide>('all')
  const state = useLoad<AltiumResult>(
    ({ signal, progress }) => loadAltium(source, file, { signal, onProgress: progress }),
    [source.id, file.path],
  )
  const result = state.status === 'ready' ? state.value : null

  const meta = result
    ? [
        result.kind === 'pcb' ? 'Altium PCB' : 'Altium schematic',
        plural(result.components.length, 'component'),
        plural(result.nets.filter(Boolean).length, 'net'),
        formatBytes(file.size),
      ].join(' · ')
    : formatBytes(file.size)

  return (
    <div className="hurt-altium">
      <Toolbar title={file.name} meta={meta}>
        {result && (
          <>
            {result.kind === 'pcb' && tab === 'drawing' && (
              <select
                className="hurt-select"
                aria-label="Layers"
                value={side}
                onChange={(e) => setSide(e.target.value as PcbSide)}
              >
                {SIDES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            <TextToggle active={tab === 'drawing'} onClick={() => setTab('drawing')}>
              {result.kind === 'pcb' ? 'Board' : 'Schematic'}
            </TextToggle>
            <TextToggle active={tab === 'parts'} onClick={() => setTab('parts')}>
              Components
            </TextToggle>
          </>
        )}
      </Toolbar>
      <Gate state={state}>
        {(value) =>
          value.kind === 'pcb' ? (
            <Board model={value} title={file.name} side={side} tab={tab} />
          ) : (
            <Schematic result={value} tab={tab} />
          )
        }
      </Gate>
    </div>
  )
}

const MPN = /^(manufacturer[ _]?part([ _]?(number|no\.?))?|mpn|part[ _]?number)$/i
const SUPPLIER = /^(supplier[ _]?part|lcsc([ _]?part)?|digi-?key([ _]?part)?|mouser([ _]?part)?)$/i

function pickParameter(parameters: Record<string, string>, pattern: RegExp) {
  return Object.entries(parameters).find(([k]) => pattern.test(k.trim()))?.[1] ?? ''
}

function Schematic({ result, tab }: { result: SchResult; tab: Tab }) {
  const rows = useMemo(
    () =>
      result.components.map((c) => [
        c.designator,
        c.parameters.Value ?? c.parameters.Comment ?? c.libReference,
        c.footprint,
        c.description,
        pickParameter(c.parameters, MPN),
        pickParameter(c.parameters, SUPPLIER),
      ]),
    [result],
  )
  if (tab === 'parts')
    return (
      <PartsTable
        columns={['Designator', 'Value', 'Footprint', 'Description', 'Manufacturer part', 'Supplier part']}
        rows={rows}
      />
    )
  return result.document ? (
    <EasyEdaCanvas document={result.document} />
  ) : (
    <Failure message="This schematic has nothing the viewer can draw." />
  )
}

function Board({ model, title, side, tab }: { model: PcbModel; title: string; side: PcbSide; tab: Tab }) {
  const document = useMemo(() => (tab === 'drawing' ? buildPcb(model, title, side) : null), [model, title, side, tab])
  const rows = useMemo(
    () =>
      model.components
        .map((c) => [c.designator, c.comment, c.footprint, c.layer === 'BOTTOM' ? 'Bottom' : 'Top', c.description])
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })),
    [model],
  )
  return (
    <>
      {model.warnings.length > 0 && (
        <p className="hurt-warning">
          <HurtIcon name="warning" /> {model.warnings[0]}
          {model.warnings.length > 1 ? ` ${plural(model.warnings.length - 1, 'other problem')} too.` : ''}
        </p>
      )}
      {tab === 'parts' ? (
        <PartsTable columns={['Designator', 'Comment', 'Footprint', 'Side', 'Description']} rows={rows} />
      ) : document ? (
        <EasyEdaCanvas document={document} />
      ) : (
        <Failure message="This board has nothing the viewer can draw on these layers." />
      )}
    </>
  )
}

function Project({ file, source, onOpen }: ViewerProps) {
  const state = useLoad<AltiumProject>(
    async ({ signal }) => parseProject(new TextDecoder().decode(await source.read(file.path, { signal })), file.dir),
    [source.id, file.path],
  )
  const byPath = useMemo(() => new Map(source.files.map((f) => [f.path.toLowerCase(), f])), [source])
  return (
    <div className="hurt-altium">
      <Toolbar
        title={file.name}
        meta={
          state.status === 'ready'
            ? `Altium project · ${plural(state.value.documents.length, 'document')} · ${formatBytes(file.size)}`
            : formatBytes(file.size)
        }
      />
      <Gate state={state}>
        {(project) =>
          project.documents.length === 0 ? (
            <p className="hurt-empty">This project lists no documents.</p>
          ) : (
            <ul className="hurt-archive__list">
              {project.documents.map((d) => {
                const target = byPath.get(d.path.toLowerCase())
                return (
                  <li key={d.path}>
                    <button
                      type="button"
                      className="hurt-archive__entry"
                      disabled={!target}
                      onClick={() => target && onOpen(target.path, source)}
                    >
                      <HurtIcon name={target ? kindIcon(target) : 'warning'} />
                      <span className="hurt-archive__path">{d.name.replace(/\\/g, '/')}</span>
                      <span className="hurt-archive__size">
                        {target ? formatBytes(target.size) : 'Not in this repository'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        }
      </Gate>
    </div>
  )
}
