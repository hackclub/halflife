import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HurtFile, ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { formatBytes } from '../../core/format'
import { detectEda } from '../../core/eda'
import { Gate, TextToggle, ToolButton, ToolDivider, Toolbar } from '../../ui/parts'
import PanZoom, { type PanZoomHandle } from '../../ui/PanZoom'
import { addMeasurePoint, MeasureMarks, MeasureReadout, type MeasurePoint } from '../../ui/Measure'
import LegacyEdaViewer from '../LegacyEdaViewer'
import { renderEagle, type EagleLayerSvg, type EagleRender, type EagleSheet } from './load'

const PX_PER_MM = 8
const MAX_PX = 12000

export default function EagleViewer(props: ViewerProps) {
  const { file, source } = props
  const state = useLoad<EagleRender | null>(
    async ({ signal, progress }) => {
      const bytes = new Uint8Array(
        await source.read(file.path, { signal, onProgress: (l, t) => progress(t ? l / t : null, 'Downloading') }),
      )
      if (detectEda(bytes, file.ext) !== 'eagle') return null
      progress(null, 'Drawing')
      return renderEagle(source, file, (message) => progress(null, message))
    },
    [source.id, file.path],
  )

  if (state.status === 'ready' && !state.value) return <LegacyEdaViewer {...props} />

  return (
    <div className="hurt-eagle">
      <Gate state={state}>{(render) => render && <Drawing render={render} file={file} />}</Gate>
    </div>
  )
}

type Side = 'top' | 'bottom' | 'all'
type Panel = 'layers' | 'parts' | null

const isInner = (layer: EagleLayerSvg) => layer.number >= 2 && layer.number <= 15

function hiddenFor(layers: EagleLayerSvg[], side: Side) {
  return new Set(
    layers
      .filter(
        (l) =>
          !l.visible ||
          (side !== 'all' && isInner(l)) ||
          (side === 'top' && l.side === 'bottom') ||
          (side === 'bottom' && l.side === 'top'),
      )
      .map((l) => l.number),
  )
}

function inkColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim() || '#04110f'
}

function layerUrl(sheet: EagleSheet, layer: EagleLayerSvg, width: number, height: number, ink: string) {
  const [x, y, w, h] = sheet.viewBox
  const color = layer.number === 44 ? ink : layer.color
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="none" font-family="Arial, Helvetica, sans-serif"><g transform="scale(1 -1)" fill="${color}" stroke="${color}">${layer.body}</g></svg>`
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
}

const KIND_LABEL = { board: 'Eagle board', schematic: 'Eagle schematic', library: 'Eagle library' }

export function Drawing({
  render,
  file,
  label,
  initial = 0,
  children,
}: {
  render: EagleRender
  file: HurtFile
  label?: string
  initial?: number
  children?: ReactNode
}) {
  const board = render.kind === 'board'
  const [index, setIndex] = useState(initial)
  const sheet = render.sheets[index] ?? render.sheets[0]
  const [side, setSide] = useState<Side>('top')
  const [hidden, setHidden] = useState(() =>
    sheet ? hiddenFor(sheet.layers, board ? 'top' : 'all') : new Set<number>(),
  )
  const [panel, setPanel] = useState<Panel>(board ? 'layers' : null)
  const [measuring, setMeasuring] = useState(false)
  const [points, setPoints] = useState<MeasurePoint[]>([])
  const panzoom = useRef<PanZoomHandle>(null)

  const [, , w, h] = sheet?.viewBox ?? [0, 0, 1, 1]
  const scale = Math.min(PX_PER_MM, MAX_PX / Math.max(w, h, 1e-6))
  const width = Math.max(1, Math.round(w * scale))
  const height = Math.max(1, Math.round(h * scale))
  const focus = useMemo(() => {
    if (!sheet?.focus) return undefined
    const [x, y] = sheet.viewBox
    const [fx, fy, fw, fh] = sheet.focus
    return { x: ((fx - x) * width) / w, y: ((fy - y) * height) / h, width: (fw * width) / w, height: (fh * height) / h }
  }, [sheet, width, height, w, h])

  const [urls, setUrls] = useState<Map<number, string>>(new Map())
  useEffect(() => {
    if (!sheet) return
    const ink = inkColor()
    const created = new Map(sheet.layers.map((layer) => [layer.number, layerUrl(sheet, layer, width, height, ink)]))
    setUrls(created)
    return () => created.forEach((url) => URL.revokeObjectURL(url))
  }, [sheet, width, height])

  const choose = (next: Side) => {
    setSide(next)
    if (sheet) setHidden(hiddenFor(sheet.layers, next))
  }

  const toggle = (number: number) =>
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(number)) next.delete(number)
      else next.add(number)
      return next
    })

  const groups = useMemo(() => {
    const map = new Map<string, number[]>()
    render.sheets.forEach((s, i) => map.set(s.group, [...(map.get(s.group) ?? []), i]))
    return [...map]
  }, [render])

  const flipped = board && side === 'bottom'
  const version = render.version ? ` ${render.version}` : ''

  return (
    <>
      <Toolbar
        title={file.name}
        meta={`${label ?? KIND_LABEL[render.kind]}${version} · ${render.stats.join(' · ')} · ${formatBytes(file.size)}`}
      >
        {children}
        {board &&
          (['top', 'bottom', 'all'] as const).map((s) => (
            <TextToggle key={s} active={side === s} onClick={() => choose(s)}>
              {s === 'top' ? 'Top' : s === 'bottom' ? 'Bottom' : 'Both sides'}
            </TextToggle>
          ))}
        {render.sheets.length > 1 && (
          <select
            className="hurt-select hurt-eagle__sheet"
            aria-label={render.kind === 'library' ? 'Package or symbol' : 'Sheet'}
            value={index}
            onChange={(e) => {
              const next = Number(e.target.value)
              setIndex(next)
              setHidden(hiddenFor(render.sheets[next].layers, board ? side : 'all'))
              setPoints([])
            }}
          >
            {groups.length > 1
              ? groups.map(([group, indexes]) => (
                  <optgroup key={group} label={group}>
                    {indexes.map((i) => (
                      <option key={i} value={i}>
                        {render.sheets[i].name}
                      </option>
                    ))}
                  </optgroup>
                ))
              : render.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s.name}
                  </option>
                ))}
          </select>
        )}
        <ToolDivider />
        <ToolButton
          icon="layers"
          label="Layers"
          active={panel === 'layers'}
          onClick={() => setPanel((p) => (p === 'layers' ? null : 'layers'))}
        />
        {render.parts.length > 0 && (
          <ToolButton
            icon="list"
            label={render.kind === 'library' ? 'Devices' : 'Parts'}
            active={panel === 'parts'}
            onClick={() => setPanel((p) => (p === 'parts' ? null : 'parts'))}
          />
        )}
        <ToolDivider />
        <ToolButton
          icon="ruler"
          label="Measure"
          active={measuring}
          onClick={() => {
            setMeasuring((v) => !v)
            setPoints([])
          }}
        />
        <ToolButton icon="minus" label="Zoom out" onClick={() => panzoom.current?.zoom(1 / 1.5)} />
        <ToolButton icon="plus" label="Zoom in" onClick={() => panzoom.current?.zoom(1.5)} />
        <ToolButton icon="fit" label="Fit" onClick={() => panzoom.current?.fit()} />
      </Toolbar>
      {render.warnings.map((warning) => (
        <p key={warning} className="hurt-note">
          {warning}
        </p>
      ))}
      <div className="hurt-gerber__body">
        <div className={measuring ? 'hurt-gerber__stage is-measuring' : 'hurt-gerber__stage'}>
          {sheet ? (
            <PanZoom
              ref={panzoom}
              width={width}
              height={height}
              focus={focus}
              className="hurt-board-bg"
              onPointerClick={(point) => {
                if (!measuring) return
                setPoints((current) => addMeasurePoint(current, point))
              }}
            >
              <div className={flipped ? 'hurt-eagle__layers is-flipped' : 'hurt-eagle__layers'}>
                {sheet.layers.map((layer) =>
                  hidden.has(layer.number) ? null : (
                    <img
                      key={layer.number}
                      src={urls.get(layer.number)}
                      alt=""
                      width={width}
                      height={height}
                      draggable={false}
                    />
                  ),
                )}
              </div>
              <MeasureMarks points={points} width={width} height={height} />
            </PanZoom>
          ) : (
            <p className="hurt-empty">This file has nothing the viewer can draw.</p>
          )}
          {measuring && <MeasureReadout points={points} pxPerMm={scale} subject="drawing" />}
        </div>
        {panel === 'layers' && sheet && (
          <aside className="hurt-gerber__layers" aria-label="Layers">
            {[...sheet.layers].reverse().map((layer) => (
              <label key={layer.number} className="hurt-gerber__chip">
                <input type="checkbox" checked={!hidden.has(layer.number)} onChange={() => toggle(layer.number)} />
                <span className="hurt-gerber__swatch" style={{ background: layer.color }} />
                <span className="hurt-gerber__chip-text">
                  <span>{layer.name}</span>
                  <span className="hurt-gerber__file">{layer.detail ?? `Layer ${layer.number}`}</span>
                </span>
              </label>
            ))}
          </aside>
        )}
        {panel === 'parts' && <Parts render={render} />}
      </div>
    </>
  )
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function Parts({ render }: { render: EagleRender }) {
  const rows = useMemo(() => [...render.parts].sort((a, b) => collator.compare(a.name, b.name)), [render])
  const library = render.kind === 'library'
  const schematic = render.kind === 'schematic'
  const libraries = !library && rows.some((part) => part.library)
  return (
    <aside className="hurt-eagle__parts" aria-label={library ? 'Devices' : 'Parts'}>
      <table className="hurt-grid">
        <thead>
          <tr>
            <th>{library ? 'Device' : 'Name'}</th>
            {!library && <th>Value</th>}
            {schematic && <th>Device</th>}
            <th>Package</th>
            {libraries && <th>Library</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((part, i) => (
            <tr key={`${part.name}-${i}`}>
              <td>{part.name}</td>
              {!library && <td>{part.value}</td>}
              {schematic && <td>{part.device}</td>}
              <td>{part.package}</td>
              {libraries && <td>{part.library}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  )
}
