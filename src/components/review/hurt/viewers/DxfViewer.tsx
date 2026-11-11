import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { DxfViewer as Dxf, LayerInfo } from 'dxf-viewer'
// Half Life: served by app/api/reviews/assets from the installed package, in place of Vite's `?url` import.
const fontUrl = '/api/reviews/assets/pdfjs/standard_fonts/LiberationSans-Regular.ttf'
import type { ViewerProps } from '../types'
import { errorMessage } from '../core/useLoad'
import { formatBytes } from '../core/format'
import { Failure, Loading, ToolButton, ToolDivider, Toolbar } from '../ui/parts'

const UNITS: Record<number, { name: string; mm: number }> = {
  1: { name: 'in', mm: 25.4 },
  2: { name: 'ft', mm: 304.8 },
  4: { name: 'mm', mm: 1 },
  5: { name: 'cm', mm: 10 },
  6: { name: 'm', mm: 1000 },
}

interface Point {
  x: number
  y: number
}

export default function DxfViewer({ file, source }: ViewerProps) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Dxf | null>(null)
  const [status, setStatus] = useState<{ loading: boolean; error: string | null; message: string }>({
    loading: true,
    error: null,
    message: 'Downloading',
  })
  const [info, setInfo] = useState<{
    width: number
    height: number
    unit: { name: string; mm: number } | null
    layers: LayerInfo[]
  } | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [measuring, setMeasuring] = useState(false)
  const [points, setPoints] = useState<Point[]>([])
  const [, setTick] = useState(0)

  useEffect(() => {
    const container = host.current
    if (!container) return
    let disposed = false
    let url: string | null = null
    let instance: Dxf | null = null
    setStatus({ loading: true, error: null, message: 'Downloading' })
    setInfo(null)
    setPoints([])
    void (async () => {
      try {
        const bytes = await source.read(file.path)
        const { DxfViewer: Viewer } = await import('dxf-viewer')
        if (disposed) return
        url = URL.createObjectURL(new Blob([bytes], { type: 'application/dxf' }))
        instance = new Viewer(container, {
          clearColor: new THREE.Color(0x071d1a),
          autoResize: true,
          colorCorrection: true,
          retainParsedDxf: true,
        })
        viewer.current = instance
        instance.Subscribe('viewChanged', () => setTick((t) => t + 1))
        await instance.Load({
          url,
          fonts: [fontUrl],
          progressCbk: (phase) =>
            !disposed &&
            setStatus({
              loading: true,
              error: null,
              message: phase === 'fetch' ? 'Reading' : phase === 'parse' ? 'Parsing' : 'Preparing',
            }),
        })
        if (disposed) return
        const bounds = instance.GetBounds()
        const units = UNITS[Number(instance.GetDxf()?.header?.$INSUNITS)] ?? null
        setInfo({
          width: bounds ? bounds.maxX - bounds.minX : 0,
          height: bounds ? bounds.maxY - bounds.minY : 0,
          unit: units,
          layers: [...instance.GetLayers(true)],
        })
        setStatus({ loading: false, error: null, message: '' })
      } catch (error) {
        if (!disposed) setStatus({ loading: false, error: errorMessage(error), message: '' })
      }
    })()
    return () => {
      disposed = true
      instance?.Destroy()
      viewer.current = null
      if (url) URL.revokeObjectURL(url)
    }
  }, [source, file.path])

  useEffect(() => {
    const instance = viewer.current
    if (!instance || !measuring) return
    let down: { x: number; y: number } | null = null
    const onDown = (event: { detail: { domEvent: PointerEvent } }) => {
      down = { x: event.detail.domEvent.clientX, y: event.detail.domEvent.clientY }
    }
    const onUp = (event: { detail: { domEvent: PointerEvent; position: Point } }) => {
      const { domEvent, position } = event.detail
      if (!down || Math.hypot(domEvent.clientX - down.x, domEvent.clientY - down.y) > 4) return
      setPoints((current) => (current.length >= 2 ? [position] : [...current, position]))
    }
    instance.Subscribe('pointerdown', onDown)
    instance.Subscribe('pointerup', onUp)
    return () => {
      instance.Unsubscribe('pointerdown', onDown)
      instance.Unsubscribe('pointerup', onUp)
    }
  }, [measuring, status.loading])

  const toScreen = (p: Point) => {
    const instance = viewer.current
    const canvas = instance?.GetCanvas()
    if (!instance || !canvas) return null
    const projected = new THREE.Vector3(p.x, p.y, 0).project(instance.GetCamera())
    return { x: ((projected.x + 1) / 2) * canvas.clientWidth, y: ((1 - projected.y) / 2) * canvas.clientHeight }
  }

  const unit = info?.unit
  const label = (value: number) => (unit ? `${(value * unit.mm).toFixed(2)} mm` : `${value.toFixed(3)} units`)
  const distance = points.length === 2 ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : null
  const screen = points.map(toScreen)

  return (
    <div className="hurt-dxf">
      <Toolbar
        title={file.name}
        meta={
          info
            ? `${label(info.width)} × ${label(info.height)}${unit ? '' : ' · drawing has no units set'} · ${formatBytes(file.size)}`
            : formatBytes(file.size)
        }
      >
        <ToolButton
          icon="ruler"
          label="Measure"
          active={measuring}
          onClick={() => {
            setMeasuring((v) => !v)
            setPoints([])
          }}
        />
        <ToolDivider />
        <ToolButton
          icon="fit"
          label="Fit"
          onClick={() => {
            const instance = viewer.current
            const bounds = instance?.GetBounds()
            const origin = instance?.GetOrigin()
            if (instance && bounds && origin)
              instance.FitView(
                bounds.minX - origin.x,
                bounds.maxX - origin.x,
                bounds.minY - origin.y,
                bounds.maxY - origin.y,
                0.05,
              )
          }}
        />
      </Toolbar>
      <div className="hurt-dxf__body">
        <div className={measuring ? 'hurt-dxf__stage is-measuring' : 'hurt-dxf__stage'}>
          <div ref={host} className="hurt-dxf__canvas" />
          {screen.length > 0 && screen.every(Boolean) && (
            <svg className="hurt-dxf__overlay">
              {screen.length === 2 && <line x1={screen[0]!.x} y1={screen[0]!.y} x2={screen[1]!.x} y2={screen[1]!.y} />}
              {screen.map((p, i) => (
                <circle key={i} cx={p!.x} cy={p!.y} r={4} />
              ))}
            </svg>
          )}
          {measuring && (
            <div className="hurt-gerber__readout">
              {distance === null
                ? points.length === 0
                  ? 'Click two points on the drawing'
                  : 'Click a second point'
                : `${label(distance)} · Δx ${label(Math.abs(points[1].x - points[0].x))} · Δy ${label(Math.abs(points[1].y - points[0].y))}`}
            </div>
          )}
          {status.loading && <Loading message={status.message} />}
          {status.error && <Failure message={status.error} />}
        </div>
        {info && info.layers.length > 1 && (
          <aside className="hurt-gerber__layers" aria-label="Layers">
            {info.layers.map((layer) => (
              <label key={layer.name} className="hurt-gerber__chip">
                <input
                  type="checkbox"
                  checked={!hidden.has(layer.name)}
                  onChange={() => {
                    const show = hidden.has(layer.name)
                    viewer.current?.ShowLayer(layer.name, show)
                    viewer.current?.Render()
                    setHidden((current) => {
                      const next = new Set(current)
                      if (show) next.delete(layer.name)
                      else next.add(layer.name)
                      return next
                    })
                  }}
                />
                <span
                  className="hurt-gerber__swatch"
                  style={{ background: `#${layer.color.toString(16).padStart(6, '0')}` }}
                />
                <span className="hurt-gerber__chip-text">
                  <span>{layer.displayName}</span>
                </span>
              </label>
            ))}
          </aside>
        )}
      </div>
    </div>
  )
}
