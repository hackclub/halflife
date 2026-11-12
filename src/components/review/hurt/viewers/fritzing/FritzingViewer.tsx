import { useEffect, useMemo, useRef, useState } from 'react'
import type { ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { formatBytes, plural } from '../../core/format'
import { Gate, TextToggle, ToolButton, Toolbar } from '../../ui/parts'
import PanZoom, { type PanZoomHandle } from '../../ui/PanZoom'
import PartsTable from '../altium/PartsTable'
import { loadFritzing, type FritzingView, type FzItem, type FzResult, type FzScene } from './fritzing'

const VIEW_LABEL: Record<FritzingView, string> = {
  breadboardView: 'Breadboard',
  schematicView: 'Schematic',
  pcbView: 'PCB',
}

export default function FritzingViewer({ file, source }: ViewerProps) {
  const [tab, setTab] = useState<FritzingView | 'parts' | null>(null)
  const state = useLoad<FzResult>(
    async ({ signal, progress }) => {
      const bytes = await source.read(file.path, {
        signal,
        onProgress: (l, t) => progress(t ? l / t : null, 'Downloading'),
      })
      progress(null, 'Loading Fritzing parts')
      return loadFritzing(bytes)
    },
    [source.id, file.path],
  )
  const result = state.status === 'ready' ? state.value : null
  const current = tab ?? result?.scenes[0]?.view ?? 'parts'
  const scene = result?.scenes.find((s) => s.view === current)
  const missing = scene ? scene.items.filter((it) => it.kind === 'box').length : 0
  const wires = result ? result.scenes.reduce((sum, s) => sum + s.wires.length, 0) : 0

  return (
    <div className="hurt-fritzing">
      <Toolbar
        title={file.name}
        meta={
          result
            ? (result.mode === 'part'
                ? ['Fritzing part', formatBytes(file.size)]
                : [
                    'Fritzing sketch',
                    plural(result.parts.length, 'part'),
                    plural(wires, 'wire'),
                    formatBytes(file.size),
                  ]
              ).join(' · ')
            : formatBytes(file.size)
        }
      >
        {result && (
          <>
            {result.scenes.map((s) => (
              <TextToggle key={s.view} active={current === s.view} onClick={() => setTab(s.view)}>
                {VIEW_LABEL[s.view]}
              </TextToggle>
            ))}
            <TextToggle active={current === 'parts'} onClick={() => setTab('parts')}>
              Parts
            </TextToggle>
          </>
        )}
      </Toolbar>
      <Gate state={state}>
        {(value) => (
          <>
            {missing > 0 && (
              <p className="hurt-note">
                {missing === 1 ? 'One part' : `${missing} parts`} in this view {missing === 1 ? 'has' : 'have'} no
                drawing the viewer can load, so {missing === 1 ? 'it shows' : 'they show'} as a labelled outline.
              </p>
            )}
            {scene ? <Scene scene={scene} /> : <Parts result={value} />}
          </>
        )}
      </Gate>
    </div>
  )
}

function Parts({ result }: { result: FzResult }) {
  const rows = useMemo(
    () =>
      result.parts
        .map((p) => [
          p.label,
          p.title,
          Object.entries(p.properties)
            .filter(([k, v]) => k && v && !/^(family|editable pin labels)$/i.test(k))
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · '),
        ])
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })),
    [result],
  )
  return <PartsTable columns={['Label', 'Part', 'Properties']} rows={rows} />
}

function useSvgUrls(items: FzItem[]) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    const next = new Map<string, string>()
    for (const it of items)
      if (it.svg && !next.has(it.svg))
        next.set(it.svg, URL.createObjectURL(new Blob([it.svg], { type: 'image/svg+xml' })))
    setUrls(next)
    return () => next.forEach((url) => URL.revokeObjectURL(url))
  }, [items])
  return urls
}

function Scene({ scene }: { scene: FzScene }) {
  const pan = useRef<PanZoomHandle>(null)
  const urls = useSvgUrls(scene.items)
  const { x, y, width, height } = scene.bounds
  return (
    <div className={scene.view === 'pcbView' ? 'hurt-fritzing__stage' : 'hurt-fritzing__stage is-paper'}>
      <div className="hurt-easyeda__tools">
        <ToolButton icon="minus" label="Zoom out" onClick={() => pan.current?.zoom(0.8)} />
        <ToolButton icon="plus" label="Zoom in" onClick={() => pan.current?.zoom(1.25)} />
        <ToolButton icon="fit" label="Fit" onClick={() => pan.current?.fit()} />
      </div>
      <PanZoom ref={pan} key={scene.view} width={width} height={height}>
        <svg width={width} height={height} viewBox={`${x} ${y} ${width} ${height}`}>
          {scene.items.map((it, i) => (
            <g key={i} transform={`translate(${it.x} ${it.y}) matrix(${it.matrix.join(' ')})`}>
              <Item item={it} url={it.svg ? urls.get(it.svg) : undefined} />
            </g>
          ))}
          {scene.wires.map((w, i) => (
            <line
              key={i}
              x1={w.x1}
              y1={w.y1}
              x2={w.x2}
              y2={w.y2}
              stroke={w.color}
              strokeWidth={w.width}
              strokeLinecap="round"
            />
          ))}
        </svg>
      </PanZoom>
    </div>
  )
}

function Item({ item, url }: { item: FzItem; url?: string }) {
  if (item.kind === 'image')
    return url ? <image href={url} width={item.w} height={item.h} preserveAspectRatio="none" /> : null
  if (item.kind === 'board') return <rect className="hurt-fritzing__board" width={item.w} height={item.h} />
  if (item.kind === 'note') {
    const perLine = Math.min(200, Math.max(12, Math.floor(item.w / 6) || 0))
    const lines = item.label.match(new RegExp(`.{1,${perLine}}(\\s|$)`, 'g'))?.slice(0, 10) ?? []
    return (
      <g className="hurt-fritzing__note">
        <rect width={item.w} height={Math.max(item.h, lines.length * 12 + 8)} />
        {lines.map((line, i) => (
          <text key={i} x={4} y={14 + i * 12} fontSize={10}>
            {line.trim()}
          </text>
        ))}
      </g>
    )
  }
  return (
    <g className="hurt-fritzing__missing">
      <rect width={item.w} height={item.h} />
      <text x={item.w / 2} y={item.h / 2} fontSize={8} textAnchor="middle" dominantBaseline="middle">
        {item.label.length > 24 ? `${item.label.slice(0, 23)}…` : item.label}
      </text>
    </g>
  )
}
