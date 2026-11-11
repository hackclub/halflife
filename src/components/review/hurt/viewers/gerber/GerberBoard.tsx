import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FileSource, HurtFile } from '../../types'
import { useLoad } from '../../core/useLoad'
import { Gate, ToolButton, ToolDivider, Toolbar } from '../../ui/parts'
import PanZoom, { type PanZoomHandle } from '../../ui/PanZoom'
import { renderBoard, type GerberLayer, type GerberRender } from './render'
import { BOARD_COLORS, UNKNOWN_LAYER_COLOR } from '../../ui/boardColors'
import { addMeasurePoint, MeasureMarks, MeasureReadout, type MeasurePoint } from '../../ui/Measure'

const PX_PER_MM = 8
const MAX_PX = 8192
const MM = { mm: 1, in: 25.4 }

const COLORS: Record<string, string> = BOARD_COLORS

const ORDER = [
  'soldermask:bottom',
  'copper:bottom',
  'silkscreen:bottom',
  'solderpaste:bottom',
  'copper:inner',
  'copper:top',
  'soldermask:top',
  'silkscreen:top',
  'solderpaste:top',
  'drill',
  'outline',
]

function layerKey(layer: GerberLayer) {
  if (layer.type === 'drill' || layer.type === 'outline') return layer.type
  return `${layer.type}:${layer.side}`
}

function rank(layer: GerberLayer) {
  const index = ORDER.indexOf(layerKey(layer))
  return index < 0 ? ORDER.length : index
}

function layerName(layer: GerberLayer) {
  if (!layer.type) return 'Not recognised'
  const side = layer.side && layer.side !== 'all' ? `${layer.side[0].toUpperCase()}${layer.side.slice(1)} ` : ''
  return `${side}${layer.type}`
}

function svgUrl(svg: string, width: number, height: number, color?: string) {
  const sized = svg
    .replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1')
    .replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1')
    .replace(
      '<svg',
      `<svg width="${width}" height="${height}" preserveAspectRatio="none"${color ? ` color="${color}"` : ''}`,
    )
  return URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }))
}

export default function GerberBoard({
  source,
  files,
  title,
  tabs,
}: {
  source: FileSource
  files: HurtFile[]
  title: string
  tabs?: ReactNode
}) {
  const state = useLoad(
    ({ progress }) => renderBoard(source, files, (message) => progress(null, message)),
    [source.id, files.map((f) => f.path).join('|')],
  )
  if (tabs && state.status !== 'ready')
    return (
      <div className="hurt-gerber">
        <Toolbar title={title}>{tabs}</Toolbar>
        <Gate state={state}>{() => null}</Gate>
      </div>
    )
  return <Gate state={state}>{(render) => <BoardView render={render} title={title} tabs={tabs} />}</Gate>
}

function BoardView({ render, title, tabs }: { render: GerberRender; title: string; tabs?: ReactNode }) {
  const hasBoard = Boolean(render.top)
  const [view, setView] = useState<'top' | 'bottom' | 'layers'>(hasBoard ? 'top' : 'layers')
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [measuring, setMeasuring] = useState(false)
  const [points, setPoints] = useState<MeasurePoint[]>([])
  const panzoom = useRef<PanZoomHandle>(null)
  const scaleToMm = MM[render.units]
  const pxPerMm = Math.min(PX_PER_MM, MAX_PX / Math.max(render.width * scaleToMm, render.height * scaleToMm, 1))
  const width = Math.max(1, Math.round(render.width * scaleToMm * pxPerMm))
  const height = Math.max(1, Math.round(render.height * scaleToMm * pxPerMm))

  const sorted = useMemo(() => [...render.layers].sort((a, b) => rank(a) - rank(b)), [render])
  const [urls, setUrls] = useState<{ layers: string[]; top: string | null; bottom: string | null }>({
    layers: [],
    top: null,
    bottom: null,
  })
  useEffect(() => {
    const created = {
      layers: sorted.map((layer) => svgUrl(layer.svg, width, height, COLORS[layerKey(layer)] ?? UNKNOWN_LAYER_COLOR)),
      top: render.top ? svgUrl(render.top, width, height) : null,
      bottom: render.bottom ? svgUrl(render.bottom, width, height) : null,
    }
    setUrls(created)
    return () => [...created.layers, created.top, created.bottom].forEach((url) => url && URL.revokeObjectURL(url))
  }, [sorted, render, width, height])

  const copper = render.layers.filter((l) => l.type === 'copper').length
  const unknown = render.layers.filter((l) => !l.type).length

  return (
    <div className="hurt-gerber">
      <Toolbar
        title={title}
        meta={`${(render.width * scaleToMm).toFixed(1)} × ${(render.height * scaleToMm).toFixed(1)} mm · ${copper} copper ${copper === 1 ? 'layer' : 'layers'} · ${render.layers.length} files${render.outline ? '' : ' · no board outline found'}`}
      >
        {tabs && (
          <>
            {tabs}
            <ToolDivider />
          </>
        )}
        {hasBoard && (
          <>
            <button
              type="button"
              className={view === 'top' ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
              onClick={() => setView('top')}
            >
              Top
            </button>
            <button
              type="button"
              className={view === 'bottom' ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
              onClick={() => setView('bottom')}
            >
              Bottom
            </button>
          </>
        )}
        <button
          type="button"
          className={view === 'layers' ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
          onClick={() => setView('layers')}
        >
          Layers
        </button>
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
      <div className="hurt-gerber__body">
        <div className={measuring ? 'hurt-gerber__stage is-measuring' : 'hurt-gerber__stage'}>
          <PanZoom
            ref={panzoom}
            width={width}
            height={height}
            className="hurt-board-bg"
            onPointerClick={(point) => {
              if (!measuring) return
              setPoints((current) => addMeasurePoint(current, point))
            }}
          >
            {view === 'layers' ? (
              sorted.map((layer, i) =>
                hidden.has(layer.filename) ? null : (
                  <img
                    key={layer.filename}
                    src={urls.layers[i]}
                    alt=""
                    width={width}
                    height={height}
                    draggable={false}
                    className={layer.type === 'soldermask' ? 'hurt-gerber__layer is-mask' : 'hurt-gerber__layer'}
                  />
                ),
              )
            ) : (
              <img
                src={(view === 'top' ? urls.top : urls.bottom) ?? undefined}
                alt={`${view} of the board`}
                width={width}
                height={height}
                draggable={false}
                className="hurt-gerber__layer"
              />
            )}
            <MeasureMarks points={points} width={width} height={height} />
          </PanZoom>
          {measuring && <MeasureReadout points={points} pxPerMm={pxPerMm} subject="board" />}
        </div>
        {view === 'layers' && (
          <aside className="hurt-gerber__layers" aria-label="Layers">
            {unknown > 0 && (
              <p className="hurt-note">
                {unknown} {unknown === 1 ? 'file was' : 'files were'} not recognised as a layer.
              </p>
            )}
            {sorted.map((layer) => (
              <label key={layer.filename} className="hurt-gerber__chip">
                <input
                  type="checkbox"
                  checked={!hidden.has(layer.filename)}
                  onChange={() =>
                    setHidden((current) => {
                      const next = new Set(current)
                      if (next.has(layer.filename)) next.delete(layer.filename)
                      else next.add(layer.filename)
                      return next
                    })
                  }
                />
                <span
                  className="hurt-gerber__swatch"
                  style={{ background: COLORS[layerKey(layer)] ?? UNKNOWN_LAYER_COLOR }}
                />
                <span className="hurt-gerber__chip-text">
                  <span>{layerName(layer)}</span>
                  <span className="hurt-gerber__file">{layer.filename}</span>
                </span>
              </label>
            ))}
          </aside>
        )}
      </div>
    </div>
  )
}
