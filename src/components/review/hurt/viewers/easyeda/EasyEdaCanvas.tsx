import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ToolButton } from '../../ui/parts'
import { textLines, type EasyEdaVisualDocument, type EasyEdaVisualPrimitive } from './visual'

interface ViewBox {
  x: number
  y: number
  width: number
  height: number
}

const FIT_PADDING = 1.06
const BASELINES = { top: 'hanging', middle: 'middle', baseline: 'alphabetic', bottom: 'text-after-edge' } as const

function fitViewBox(document: EasyEdaVisualDocument): ViewBox {
  const width = Math.max(1, document.bounds.width * FIT_PADDING)
  const height = Math.max(1, document.bounds.height * FIT_PADDING)
  return {
    x: document.bounds.minX - (width - document.bounds.width) / 2,
    y: document.bounds.minY - (height - document.bounds.height) / 2,
    width,
    height,
  }
}

export default function EasyEdaCanvas({ document }: { document: EasyEdaVisualDocument }) {
  const svg = useRef<SVGSVGElement>(null)
  const pan = useRef<{ id: number; x: number; y: number; start: ViewBox } | null>(null)
  const fit = useMemo(() => fitViewBox(document), [document])
  const [view, setView] = useState(fit)
  const [layersOpen, setLayersOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const layers = document.layers ?? []
  const shown = useMemo(
    () => (hidden.size ? document.primitives.filter((p) => !p.layer || !hidden.has(p.layer)) : document.primitives),
    [document, hidden],
  )

  useEffect(() => setView(fit), [fit])
  useEffect(() => setHidden(new Set()), [document])

  const limits = useCallback(
    (width: number) => Math.min(document.bounds.width * 100, Math.max(document.bounds.width * 0.005, width)),
    [document],
  )

  const zoom = (factor: number) =>
    setView((v) => {
      const width = limits(v.width * factor)
      const height = (width / v.width) * v.height
      return { x: v.x + (v.width - width) / 2, y: v.y + (v.height - height) / 2, width, height }
    })

  useEffect(() => {
    const el = svg.current
    if (!el) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const fx = (event.clientX - rect.left) / rect.width
      const fy = (event.clientY - rect.top) / rect.height
      setView((v) => {
        const width = limits(v.width * Math.exp(event.deltaY * 0.0015))
        const ratio = width / v.width
        const height = v.height * ratio
        return { x: v.x + fx * v.width * (1 - ratio), y: v.y + fy * v.height * (1 - ratio), width, height }
      })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [limits])

  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: view }
  }

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const state = pan.current
    if (!state || state.id !== event.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const scale = Math.max(state.start.width / rect.width, state.start.height / rect.height)
    setView({
      ...state.start,
      x: state.start.x - (event.clientX - state.x) * scale,
      y: state.start.y - (event.clientY - state.y) * scale,
    })
  }

  return (
    <div className="hurt-easyeda__canvas">
      <div className="hurt-easyeda__stage">
        <div className="hurt-easyeda__tools">
          {layers.length > 1 && (
            <ToolButton
              icon="layers"
              label="Layers"
              text
              active={layersOpen}
              onClick={() => setLayersOpen((o) => !o)}
            />
          )}
          <ToolButton icon="minus" label="Zoom out" onClick={() => zoom(1.25)} />
          <ToolButton icon="plus" label="Zoom in" onClick={() => zoom(0.8)} />
          <ToolButton icon="fit" label="Fit" onClick={() => setView(fit)} />
        </div>
        <svg
          ref={svg}
          className="hurt-easyeda__svg"
          viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => (pan.current = null)}
          onPointerCancel={() => (pan.current = null)}
        >
          <rect
            x={document.bounds.minX}
            y={document.bounds.minY}
            width={document.bounds.width}
            height={document.bounds.height}
            className="hurt-easyeda__sheet"
          />
          {shown.map(renderPrimitive)}
        </svg>
      </div>
      {layersOpen && layers.length > 1 && (
        <aside className="hurt-gerber__layers" aria-label="Layers">
          {layers.map((layer) => (
            <label key={layer.id} className="hurt-gerber__chip">
              <input
                type="checkbox"
                checked={!hidden.has(layer.id)}
                onChange={() =>
                  setHidden((current) => {
                    const next = new Set(current)
                    if (next.has(layer.id)) next.delete(layer.id)
                    else next.add(layer.id)
                    return next
                  })
                }
              />
              <span className="hurt-gerber__swatch" style={{ background: layer.color }} />
              <span className="hurt-gerber__chip-text">
                <span>{layer.name}</span>
              </span>
            </label>
          ))}
        </aside>
      )}
    </div>
  )
}

function renderPrimitive(p: EasyEdaVisualPrimitive, index: number) {
  if (p.kind === 'text') {
    const lines = textLines(p.text)
    const baseline = p.baseline ?? 'middle'
    const lift = baseline === 'middle' ? (lines.length - 1) * 0.6 : baseline === 'bottom' ? (lines.length - 1) * 1.2 : 0
    return (
      <text
        key={index}
        x={p.x}
        y={p.y}
        transform={p.rotation ? `rotate(${p.rotation} ${p.x} ${p.y})` : undefined}
        fill={p.fill}
        opacity={p.opacity}
        fontSize={p.size}
        textAnchor={p.anchor}
        dominantBaseline={BASELINES[baseline]}
      >
        {lines.length === 1
          ? lines[0]
          : lines.map((line, i) => (
              <tspan key={i} x={p.x} dy={`${i ? 1.2 : -lift}em`}>
                {line || '\u00a0'}
              </tspan>
            ))}
      </text>
    )
  }
  const paint = { stroke: p.stroke, strokeWidth: p.strokeWidth, fill: p.fill ?? 'none', opacity: p.opacity }
  switch (p.kind) {
    case 'polyline': {
      const points = p.points.map((pt) => `${pt.x},${pt.y}`).join(' ')
      return p.closed ? (
        <polygon key={index} points={points} {...paint} strokeLinejoin="round" strokeLinecap="round" />
      ) : (
        <polyline key={index} points={points} {...paint} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      )
    }
    case 'path':
      return <path key={index} d={p.path} {...paint} fillRule="evenodd" strokeLinejoin="round" strokeLinecap="round" />
    case 'circle':
      return <circle key={index} cx={p.cx} cy={p.cy} r={p.r} {...paint} />
    case 'rect':
      return (
        <rect
          key={index}
          x={p.x}
          y={p.y}
          width={p.width}
          height={p.height}
          rx={p.rx}
          ry={p.ry}
          transform={p.rotation ? `rotate(${p.rotation} ${p.x + p.width / 2} ${p.y + p.height / 2})` : undefined}
          {...paint}
        />
      )
  }
}
