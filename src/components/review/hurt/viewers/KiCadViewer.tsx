import { useEffect, useRef, useState } from 'react'
import type { FileSource, HurtFile, ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { formatBytes } from '../core/format'
import { resolvePath } from '../core/source'
import { decodeText } from '../core/text'
import { Failure, Gate, TextToggle, Toolbar } from '../ui/parts'
import TextViewer from './TextViewer'

const SHEET_FILE = /\(property\s+"Sheet\s?file"\s+"([^"]+)"/g
const FIRST_SUPPORTED_VERSION = 20211014
const BOARD_CONTENT = /\((footprint|module|segment|arc|via|zone|gr_\w+)\s/
const SILKSCREEN_LAYERS = ['F.SilkS', 'B.SilkS', 'F.Fab', 'B.Fab', 'Dwgs.User']

let kicanvas: Promise<unknown> | null = null

function loadKiCanvas() {
  kicanvas ??= import('../vendor/kicanvas.js')
  return kicanvas
}

interface BoardLayer {
  name: string
  get visible(): boolean
  set visible(value: boolean | (() => boolean))
}

interface BoardViewer {
  layers: { by_name(name: string): BoardLayer | undefined; copper_layers(): Iterable<BoardLayer> }
  draw(): void
}

interface LayersPanel extends HTMLElement {
  panel_body?: Element | null
  update_item_states(): void
}

interface Board {
  viewer: BoardViewer
  panel: LayersPanel | null
}

interface Bundle {
  sources: { name: string; text: string }[]
  stats: string
  legacy: boolean
  missing: boolean
}

function isDesign(name: string, text: string) {
  return /\.kicad_(sch|pcb)$/.test(name) ? text.trimStart().startsWith('(') : isJson(text)
}

function isJson(text: string) {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

async function collect(source: FileSource, file: HurtFile, signal: AbortSignal): Promise<Bundle> {
  const read = async (path: string) => decodeText(await source.read(path, { signal })).text
  const root = await read(file.path)
  if (!root.trim()) throw new Error('This file is empty.')
  const version = Number(root.match(/\(version\s+(\d+)\)/)?.[1] ?? 0)
  const legacy =
    root.startsWith('EESchema') || (file.ext !== 'kicad_pro' && version > 0 && version < FIRST_SUPPORTED_VERSION)
  if (legacy) return { sources: [], stats: '', legacy, missing: false }
  if (!isDesign(file.name, root)) throw new Error('This is not a KiCad file the viewer can read.')
  if (file.ext === 'kicad_pcb' && !BOARD_CONTENT.test(root)) throw new Error('This board has nothing drawn on it yet.')

  const base = file.path.replace(/\.[^./]+$/, '')
  const sources = new Map<string, string>([[file.name, root]])
  const queue: string[] = []
  const enqueue = (text: string) => {
    queue.push(text)
    for (const [, sheet] of text.matchAll(SHEET_FILE)) {
      const path = resolvePath(file.dir, sheet)
      if (!sources.has(sheet) && source.byPath.has(path)) void source.read(path).catch(() => undefined)
    }
  }
  if (file.ext === 'kicad_sch') enqueue(root)
  const companions = (file.ext === 'kicad_pro' ? ['kicad_pcb', 'kicad_sch'] : ['kicad_pro']).flatMap((ext) => {
    const companion = source.byPath.get(`${base}.${ext}`)
    return companion ? [{ ext, companion }] : []
  })
  const texts = await Promise.all(companions.map(({ companion }) => read(companion.path)))
  companions.forEach(({ ext, companion }, i) => {
    const text = texts[i]
    if (!text.trim() || !isDesign(companion.name, text)) return
    if (ext === 'kicad_pcb' && !BOARD_CONTENT.test(text)) return
    sources.set(companion.name, text)
    if (ext === 'kicad_sch') enqueue(text)
  })

  while (queue.length > 0) {
    const text = queue.shift()!
    for (const [, sheet] of text.matchAll(SHEET_FILE)) {
      if (sources.has(sheet)) continue
      const path = resolvePath(file.dir, sheet)
      if (!source.byPath.has(path)) continue
      const child = await read(path)
      if (!child.trim() || !isDesign(sheet, child)) continue
      sources.set(sheet, child)
      enqueue(child)
    }
  }

  const missing = ![...sources.keys()].some((name) => /\.kicad_(sch|pcb)$/.test(name))
  return {
    sources: [...sources].map(([name, text]) => ({ name, text })),
    stats: missing ? '' : describe(file, sources),
    legacy,
    missing,
  }
}

function count(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

function describe(file: HurtFile, sources: Map<string, string>) {
  const stem = file.name.replace(/\.[^.]+$/, '')
  const parts: string[] = []
  const board = sources.get(`${stem}.kicad_pcb`)
  if (board) {
    const layers = board.match(/\(layers\s([\s\S]*?)\n\s*\)/)?.[1] ?? ''
    const copper = count(layers, /"[^"]*\.Cu"/g)
    if (copper) parts.push(`${copper} copper layers`)
    parts.push(`${count(board, /\((footprint|module)\s/g)} footprints`)
    parts.push(
      `${count(board, /\((segment|arc)\s+\(start[^()]*\)(\s*\(mid[^()]*\))?\s*\(end[^()]*\)\s*\(width/g)} track segments`,
    )
    parts.push(`${count(board, /\(via\s/g)} vias`)
    const size = boardSize(board)
    if (size) parts.push(size)
  }
  if (sources.has(`${stem}.kicad_sch`)) {
    const totals = new Map<string, { sheets: number; symbols: number }>()
    const walk = (name: string, open: Set<string>): { sheets: number; symbols: number } => {
      const known = totals.get(name)
      const text = sources.get(name)
      if (known) return known
      if (!text || open.has(name)) return { sheets: 0, symbols: 0 }
      open.add(name)
      const total = { sheets: 1, symbols: count(text, /\(symbol\s+\(lib_(?:id|name)\s/g) }
      for (const [, child] of text.matchAll(SHEET_FILE)) {
        const sub = walk(child, open)
        total.sheets += sub.sheets
        total.symbols += sub.symbols
      }
      open.delete(name)
      totals.set(name, total)
      return total
    }
    const { sheets, symbols } = walk(`${stem}.kicad_sch`, new Set())
    parts.push(`${sheets} ${sheets === 1 ? 'sheet' : 'sheets'}`, `${symbols} symbols`)
  }
  return parts.join(' · ')
}

function closing(text: string, at: number) {
  let depth = 0
  for (let i = at; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return text.length - 1
}

type Point = [number, number]

function arcExtremes([sx, sy]: Point, [mx, my]: Point, [ex, ey]: Point): Point[] {
  const d = 2 * (sx * (my - ey) + mx * (ey - sy) + ex * (sy - my))
  const points: Point[] = [
    [sx, sy],
    [mx, my],
    [ex, ey],
  ]
  if (Math.abs(d) < 1e-9) return points
  const s2 = sx * sx + sy * sy
  const m2 = mx * mx + my * my
  const e2 = ex * ex + ey * ey
  const cx = (s2 * (my - ey) + m2 * (ey - sy) + e2 * (sy - my)) / d
  const cy = (s2 * (ex - mx) + m2 * (sx - ex) + e2 * (mx - sx)) / d
  const r = Math.hypot(sx - cx, sy - cy)
  const tau = Math.PI * 2
  const start = Math.atan2(sy - cy, sx - cx)
  const turn = (a: number) => (((a - start) % tau) + tau) % tau
  const end = turn(Math.atan2(ey - cy, ex - cx))
  const forward = turn(Math.atan2(my - cy, mx - cx)) < end
  for (let k = 0; k < 4; k++) {
    const a = turn((k * Math.PI) / 2)
    if (forward ? a < end : a > end)
      points.push([cx + r * Math.cos((k * Math.PI) / 2), cy + r * Math.sin((k * Math.PI) / 2)])
  }
  return points
}

function shapePoints(kind: string, shape: string): Point[] {
  const at = (key: string): Point | null => {
    const m = shape.match(new RegExp(`\\(${key}\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)`))
    return m ? [Number(m[1]), Number(m[2])] : null
  }
  if (kind === 'circle') {
    const center = at('center')
    const end = at('end')
    if (!center || !end) return []
    const r = Math.hypot(end[0] - center[0], end[1] - center[1])
    return [
      [center[0] - r, center[1] - r],
      [center[0] + r, center[1] + r],
    ]
  }
  if (kind === 'arc') {
    const [start, mid, end] = [at('start'), at('mid'), at('end')]
    if (start && mid && end) return arcExtremes(start, mid, end)
  }
  return [...shape.matchAll(/\((?:start|end|mid|center|xy)\s+(-?[\d.]+)\s+(-?[\d.]+)\)/g)].map(
    ([, x, y]) => [Number(x), Number(y)] as Point,
  )
}

function boardSize(board: string) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const include = ([x, y]: Point) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const edgeShapes = (text: string, prefix: 'gr' | 'fp', place: (p: Point) => Point) => {
    const pattern = new RegExp(`\\(${prefix}_(line|arc|circle|rect|poly|curve)\\s`, 'g')
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      const end = closing(text, m.index)
      const shape = text.slice(m.index, end + 1)
      pattern.lastIndex = end + 1
      if (/\(layer\s+"?Edge\.Cuts"?\)/.test(shape)) for (const p of shapePoints(m[1], shape)) include(place(p))
    }
  }
  const outside: string[] = []
  const footprint = /\((footprint|module)\s/g
  let from = 0
  for (let m = footprint.exec(board); m; m = footprint.exec(board)) {
    const end = closing(board, m.index)
    outside.push(board.slice(from, m.index))
    const body = board.slice(m.index, end + 1)
    const [, x, y, rot] = body.match(/\(at\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s+(-?[\d.]+))?\)/) ?? []
    const fx = Number(x ?? 0)
    const fy = Number(y ?? 0)
    const angle = (Number(rot ?? 0) * Math.PI) / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    edgeShapes(body, 'fp', ([px, py]) => [fx + px * cos + py * sin, fy - px * sin + py * cos])
    footprint.lastIndex = end + 1
    from = end + 1
  }
  outside.push(board.slice(from))
  edgeShapes(outside.join(''), 'gr', (p) => p)
  return Number.isFinite(minX) && maxX > minX ? `${(maxX - minX).toFixed(1)} × ${(maxY - minY).toFixed(1)} mm` : null
}

function findBoard(embed: Element): Board | null {
  const root = embed.shadowRoot?.querySelector('kc-board-app')?.shadowRoot
  const element = root?.querySelector<HTMLElement & { loaded?: boolean; viewer?: BoardViewer }>('kc-board-viewer')
  if (!element?.loaded || !element.viewer) return null
  return { viewer: element.viewer, panel: root?.querySelector<LayersPanel>('kc-board-layers-panel') ?? null }
}

function silkscreenVisible(viewer: BoardViewer) {
  return SILKSCREEN_LAYERS.some((name) => viewer.layers.by_name(name)?.visible)
}

function isKiCanvasError(error: unknown, filename = '') {
  const stack = error instanceof Error ? `${error.stack ?? ''}${error.message}` : String(error ?? '')
  return /kicanvas/i.test(`${filename}${stack}`)
}

export default function KiCadViewer(props: ViewerProps) {
  const { file, source } = props
  const mount = useRef<HTMLDivElement>(null)
  const [broken, setBroken] = useState<unknown>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [silkscreen, setSilkscreen] = useState(true)
  const [fills, setFills] = useState(true)
  const state = useLoad(
    async ({ signal, progress }) => {
      progress(null, 'Reading KiCad files')
      const [bundle] = await Promise.all([collect(source, file, signal), loadKiCanvas()])
      return bundle
    },
    [source.id, file.path],
  )

  useEffect(() => {
    if (state.status !== 'ready' || state.value.legacy || state.value.missing || !mount.current) return
    const fail = (event: Event, error: unknown, filename?: string) => {
      if (!isKiCanvasError(error, filename)) return
      event.preventDefault()
      setBroken(state)
    }
    const onError = (event: ErrorEvent) => fail(event, event.error, event.filename)
    const onRejection = (event: PromiseRejectionEvent) => fail(event, event.reason)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    const embed = document.createElement('kicanvas-embed')
    let layers: unknown = null
    embed.addEventListener('kicanvas:load', () => {
      const found = findBoard(embed)
      if (!found || found.viewer.layers === layers) return
      layers = found.viewer.layers
      setBoard(found)
      setSilkscreen(silkscreenVisible(found.viewer))
      setFills(true)
    })
    embed.setAttribute('controls', 'full')
    embed.setAttribute('controlslist', 'nooverlay')
    for (const { name, text } of state.value.sources) {
      const child = document.createElement('kicanvas-source')
      child.setAttribute('name', name)
      child.textContent = text
      embed.appendChild(child)
    }
    mount.current.appendChild(embed)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      embed.remove()
      setBoard(null)
    }
  }, [state])

  useEffect(() => {
    if (!board) return
    const { viewer } = board
    const draw = viewer.draw
    viewer.draw = function () {
      draw.call(this)
      setSilkscreen(silkscreenVisible(viewer))
    }
    return () => {
      viewer.draw = draw
    }
  }, [board])

  const toggleSilkscreen = () => {
    if (!board) return
    for (const name of SILKSCREEN_LAYERS) {
      const layer = board.viewer.layers.by_name(name)
      if (layer) layer.visible = !silkscreen
    }
    if (board.panel?.panel_body) board.panel.update_item_states()
    board.viewer.draw()
  }

  const toggleFills = () => {
    if (!board) return
    for (const copper of board.viewer.layers.copper_layers()) {
      const zones = board.viewer.layers.by_name(`:${copper.name}:Zones`)
      if (zones) zones.visible = fills ? false : () => copper.visible
    }
    setFills(!fills)
    board.viewer.draw()
  }

  if (state.status === 'ready' && (state.value.legacy || state.value.missing)) {
    return (
      <div className="hurt-kicad">
        <Failure
          message={
            state.value.legacy
              ? 'This file is from KiCad 5 or older. The KiCad viewer reads KiCad 6 and newer, so here is its source.'
              : 'There is no schematic or board with the same name next to this project, so here is its source.'
          }
        />
        <TextViewer {...props} />
      </div>
    )
  }

  return (
    <div className="hurt-kicad">
      <Toolbar
        title={file.name}
        meta={[state.status === 'ready' && state.value.stats, formatBytes(file.size)].filter(Boolean).join(' · ')}
      >
        {board && (
          <>
            <TextToggle active={silkscreen} onClick={toggleSilkscreen}>
              Silkscreen
            </TextToggle>
            <TextToggle active={fills} onClick={toggleFills}>
              Fills
            </TextToggle>
          </>
        )}
      </Toolbar>
      <Gate state={state}>
        {() => (broken === state ? <Failure message="The KiCad viewer could not draw this file." /> : null)}
      </Gate>
      <div ref={mount} className="hurt-kicad__mount" />
    </div>
  )
}
