import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HurtFile, ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { Failure, Gate, TextToggle, ToolButton, ToolDivider, Toolbar } from '../../ui/parts'
import HurtIcon from '../../ui/HurtIcon'
import PanZoom, { type PanZoomHandle } from '../../ui/PanZoom'
import TextViewer from '../TextViewer'
import { prepareIbom, type IbomFrame, type IbomPart, type IbomView } from './load'
import { partAt, type Side } from './geometry'

type Layer = keyof IbomView['layers']
type Target = { row: number } | { part: number }

const LAYERS: { id: Layer; label: string }[] = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'silk', label: 'Silkscreen' },
  { id: 'fab', label: 'Fabrication' },
  { id: 'refs', label: 'References' },
  { id: 'values', label: 'Values' },
]
const SIDE_NAME: Record<Side, string> = { F: 'Front', B: 'Back' }
const REF_LIMIT = 12
const BOARD_TOKENS = [
  '--color-ink',
  '--color-deep',
  '--color-mat-line',
  '--color-bone',
  '--color-grey-2',
  '--color-grey-3',
  '--color-warn',
]
const BOARD_CSS = `
.track{fill:none;stroke:var(--color-mat-line);stroke-linecap:round;stroke-linejoin:round}
.track.fill{fill:var(--color-deep);stroke:none}
.zone{fill:var(--color-deep);stroke:var(--color-deep);stroke-linejoin:round}
.silk{fill:none;stroke:var(--color-bone);stroke-linecap:round;stroke-linejoin:round}
.silk.fill{fill:var(--color-bone);stroke:none}
.fab{fill:none;stroke:var(--color-grey-3);stroke-linecap:round;stroke-linejoin:round}
.fab.fill{fill:var(--color-grey-3);stroke:none}
.pad{fill:var(--color-grey-2);stroke:none}
.pad.is-excluded{opacity:.45}
.pin1{fill:var(--color-warn)}
.hole{fill:var(--color-ink)}
.edge{fill:none;stroke:var(--color-warn);stroke-linecap:round;stroke-linejoin:round}
.edge.fill{fill:var(--color-warn);stroke:none}`

export default function IbomViewer(props: ViewerProps) {
  const { file, source } = props
  const [showSource, setShowSource] = useState(false)
  const state = useLoad(
    ({ progress }) => prepareIbom(source, file, (message) => progress(null, message)),
    [source.id, file.path],
  )
  const toggle = (
    <ToolButton
      icon="code"
      label={showSource ? 'Show interactive BOM' : 'Show page source'}
      active={showSource}
      onClick={() => setShowSource((v) => !v)}
    />
  )

  if (showSource) return <TextViewer {...props} tools={toggle} />
  if (state.status === 'error') {
    return (
      <Failure message={`Couldn't read the BOM data in this page. ${state.error}`}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowSource(true)}>
          Show page source
        </button>
      </Failure>
    )
  }
  return <Gate state={state}>{(view) => <Bom view={view} file={file} tools={toggle} />}</Gate>
}

function Bom({ view, file, tools }: { view: IbomView; file: HurtFile; tools: ReactNode }) {
  const partSides = useMemo(() => new Set(view.parts.filter((p) => p.row >= 0).map((p) => p.side)), [view])
  const [sides, setSides] = useState<Side[]>(partSides.has('B') ? (partSides.has('F') ? ['F', 'B'] : ['B']) : ['F'])
  const [hidden, setHidden] = useState<Set<Layer>>(new Set(['fab']))
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [hover, setHover] = useState<Target | null>(null)
  const [copied, setCopied] = useState(false)
  const stages = useRef<Partial<Record<Side, PanZoomHandle | null>>>({})
  const table = useRef<HTMLDivElement>(null)

  const rows = useMemo(
    () =>
      view.rows.map((row, index) => {
        const parts = row.ids.map((id) => view.parts[id])
        const refs = parts.map((p) => p.ref)
        const rowSides = new Set(parts.map((p) => p.side))
        return {
          index,
          ids: row.ids,
          refs,
          values: row.values,
          side: rowSides.size > 1 ? 'Both' : SIDE_NAME[parts[0]?.side ?? 'F'],
          search: [...refs, ...row.values].join(' ').toLowerCase(),
        }
      }),
    [view],
  )
  const visible = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean)
    return words.length ? rows.filter((r) => words.every((w) => r.search.includes(w))) : rows
  }, [rows, filter])
  const excluded = useMemo(
    () =>
      [...new Set(view.parts.filter((p) => p.excluded && p.ref).map((p) => p.ref))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [view],
  )
  const total = rows.reduce((sum, r) => sum + r.ids.length, 0)

  useEffect(() => {
    if (selected === null) return
    table.current?.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const idsOf = (target: Target | null) =>
    !target ? [] : 'row' in target ? (view.rows[target.row]?.ids ?? []) : [target.part]
  const marks = { selected: selected === null ? [] : idsOf({ row: selected }), hover: idsOf(hover) }
  const hoverRow = hover && 'row' in hover ? hover.row : null

  const pick = (id: number) => {
    const part = view.parts[id]
    if (part && part.row >= 0) setSelected(part.row)
  }

  const copyCsv = async () => {
    const { unparse } = (await import('papaparse')).default
    const csv = unparse(
      [
        ['References', ...view.columns, 'Quantity'],
        ...rows.map((r) => [r.refs.join(', '), ...r.values, String(r.ids.length)]),
      ],
      { escapeFormulae: true },
    )
    await navigator.clipboard.writeText(csv)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const meta = [
    view.generator,
    `${rows.length} ${rows.length === 1 ? 'line' : 'lines'}`,
    `${total} ${total === 1 ? 'part' : 'parts'}`,
    excluded.length ? `${excluded.length} ${view.excludedLabel[0].toLowerCase()}${view.excludedLabel.slice(1)}` : '',
    view.metadata.title,
    view.metadata.revision ? `rev ${view.metadata.revision}` : '',
    view.metadata.date,
  ]
  const stacked = view.frames.F.width > view.frames.F.height * 1.2
  const available = (layer: Layer) => {
    const on = view.layers[layer]
    return Array.isArray(on) ? on.some((source) => !hidden.has(source)) : on
  }

  return (
    <div
      className="hurt-ibom"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') return setSelected(null)
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        const at = visible.findIndex((r) => r.index === selected)
        const next = event.key === 'ArrowDown' ? Math.min(visible.length - 1, at + 1) : Math.max(0, at - 1)
        if (visible[next]) setSelected(visible[next].index)
      }}
    >
      <Toolbar title={file.name} meta={meta.filter(Boolean).join(' · ')}>
        {(['F', 'B'] as const).map((side) => (
          <TextToggle key={side} active={sides.length === 1 && sides[0] === side} onClick={() => setSides([side])}>
            {SIDE_NAME[side]}
          </TextToggle>
        ))}
        <TextToggle active={sides.length === 2} onClick={() => setSides(['F', 'B'])}>
          Both
        </TextToggle>
        <ToolDivider />
        {LAYERS.filter((layer) => available(layer.id)).map((layer) => (
          <TextToggle
            key={layer.id}
            active={!hidden.has(layer.id)}
            onClick={() =>
              setHidden((current) => {
                const next = new Set(current)
                if (!next.delete(layer.id)) next.add(layer.id)
                return next
              })
            }
          >
            {layer.label}
          </TextToggle>
        ))}
        <ToolDivider />
        <ToolButton
          icon="minus"
          label="Zoom out"
          onClick={() => sides.forEach((side) => stages.current[side]?.zoom(1 / 1.5))}
        />
        <ToolButton
          icon="plus"
          label="Zoom in"
          onClick={() => sides.forEach((side) => stages.current[side]?.zoom(1.5))}
        />
        <ToolButton icon="fit" label="Fit" onClick={() => sides.forEach((side) => stages.current[side]?.fit())} />
        <ToolButton icon={copied ? 'check' : 'copy'} label="Copy BOM as CSV" onClick={() => void copyCsv()} />
        {tools}
      </Toolbar>
      <div className="hurt-ibom__body">
        <div className="hurt-ibom__list">
          <label className="hurt-ibom__filter">
            <HurtIcon name="search" />
            <input
              type="search"
              placeholder="Filter parts"
              aria-label="Filter parts"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <div ref={table} className="hurt-ibom__scroll" tabIndex={0}>
            <table className="hurt-grid hurt-ibom__table">
              <thead>
                <tr>
                  <th className="hurt-grid__n">#</th>
                  <th>References</th>
                  <th className="hurt-grid__n">Qty</th>
                  <th>Side</th>
                  {view.columns.map((column, i) => (
                    <th key={i}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody onMouseLeave={() => setHover(null)}>
                {visible.map((row) => (
                  <tr
                    key={row.index}
                    data-row={row.index}
                    className={row.index === selected ? 'is-selected' : row.index === hoverRow ? 'is-hover' : undefined}
                    onMouseEnter={() => setHover({ row: row.index })}
                    onClick={() => setSelected(row.index === selected ? null : row.index)}
                  >
                    <td className="hurt-grid__n">{row.index + 1}</td>
                    <td
                      className="hurt-ibom__refs"
                      title={row.refs.length > REF_LIMIT ? row.refs.join(', ') : undefined}
                    >
                      {row.refs.slice(0, REF_LIMIT).join(', ')}
                      {row.refs.length > REF_LIMIT && ` +${row.refs.length - REF_LIMIT}`}
                    </td>
                    <td className="hurt-grid__n">{row.ids.length}</td>
                    <td className="hurt-ibom__side-cell">{row.side}</td>
                    {view.columns.map((_, i) => (
                      <td key={i} title={row.values[i]}>
                        {row.values[i]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length === 0 && <p className="hurt-empty">No parts match this filter.</p>}
          </div>
          {excluded.length > 0 && (
            <p className="hurt-ibom__excluded" title={excluded.join(', ')}>
              <span>{view.excludedLabel}:</span> {excluded.slice(0, 40).join(', ')}
              {excluded.length > 40 && ` +${excluded.length - 40}`}
            </p>
          )}
        </div>
        <div className="hurt-ibom__boards">
          {view.fontText && <p className="hurt-note">Text drawn with KiCad's built-in font isn't shown.</p>}
          <div className={stacked ? 'hurt-ibom__stages is-stacked' : 'hurt-ibom__stages'}>
            {sides.map((side) => (
              <Stage
                key={side}
                ref={(handle) => {
                  stages.current[side] = handle
                }}
                side={side}
                frame={view.frames[side]}
                parts={view.parts}
                hidden={hidden}
                marks={marks}
                onHover={(id) =>
                  setHover(id < 0 ? null : view.parts[id].row >= 0 ? { row: view.parts[id].row } : { part: id })
                }
                onPick={pick}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function boardStyle(hidden: Set<Layer>) {
  const css = getComputedStyle(document.documentElement)
  const tokens = BOARD_TOKENS.map((t) => `${t}:${css.getPropertyValue(t).trim()}`).join(';')
  const hide = hidden.size ? `${[...hidden].map((layer) => `.l-${layer}`).join(',')}{display:none}` : ''
  return `<style>svg{${tokens}}${BOARD_CSS}${hide}</style>`
}

function Stage({
  ref,
  side,
  frame,
  parts,
  hidden,
  marks,
  onHover,
  onPick,
}: {
  ref: (handle: PanZoomHandle | null) => void
  side: Side
  frame: IbomFrame
  parts: IbomPart[]
  hidden: Set<Layer>
  marks: { selected: number[]; hover: number[] }
  onHover: (id: number) => void
  onPick: (id: number) => void
}) {
  const longest = Math.max(frame.width, frame.height, 1)
  const scale = Math.min(Math.max(8, 1600 / longest), 6000 / longest)
  const width = Math.max(1, Math.round(frame.width * scale))
  const height = Math.max(1, Math.round(frame.height * scale))
  const viewBox = `${frame.x} ${frame.y} ${frame.width} ${frame.height}`
  const svg = useMemo(
    () =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">${boardStyle(hidden)}${frame.body}</svg>`,
    [frame, hidden, viewBox, width, height],
  )
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const created = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    setUrl(created)
    return () => URL.revokeObjectURL(created)
  }, [svg])

  const last = useRef(-1)
  const markup = (ids: number[]) => ids.map((id) => (parts[id]?.side === side ? parts[id].mark : '')).join('')
  const overlay = `<g${side === 'B' ? ' transform="scale(-1 1)"' : ''}><g class="is-selected">${markup(marks.selected)}</g><g class="is-hover">${markup(marks.hover)}</g></g>`
  const hit = (point: { x: number; y: number }) => {
    const x = frame.x + point.x / scale
    return partAt(parts, side, side === 'B' ? -x : x, frame.y + point.y / scale)
  }

  return (
    <div
      className="hurt-ibom__stage"
      onPointerLeave={() => {
        last.current = -1
        onHover(-1)
      }}
    >
      <span className="hurt-ibom__side">{SIDE_NAME[side]}</span>
      <PanZoom
        ref={ref}
        width={width}
        height={height}
        className="hurt-board-bg"
        onPointerMove={(point) => {
          const id = hit(point)
          if (id === last.current) return
          last.current = id
          onHover(id)
        }}
        onPointerClick={(point) => {
          const id = hit(point)
          if (id >= 0) onPick(id)
        }}
      >
        {url && (
          <img src={url} alt={`${SIDE_NAME[side]} of the board`} width={width} height={height} draggable={false} />
        )}
        <svg
          className="hurt-ibom__overlay"
          viewBox={viewBox}
          width={width}
          height={height}
          dangerouslySetInnerHTML={{ __html: overlay }}
        />
      </PanZoom>
    </div>
  )
}
