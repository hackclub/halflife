import { openZip } from '../../core/archive'
import { cacheGet, cachePut } from '../../core/cache'

export type FritzingView = 'breadboardView' | 'schematicView' | 'pcbView'
const VIEWS: FritzingView[] = ['breadboardView', 'schematicView', 'pcbView']

const FOLDER: Record<FritzingView, string> = {
  breadboardView: 'breadboard',
  schematicView: 'schematic',
  pcbView: 'pcb',
}
const PARTS_SHA = '27535f2fd02097be9bed229b75aa8e9be282a4a0'
const PARTS = `https://raw.githubusercontent.com/fritzing/fritzing-parts/${PARTS_SHA}`
const DPI = 90
const RATSNEST = 16
const PCB_TRACE = 4
const SCHEMATIC_TRACE = 128
const MAX_INSTANCES = 20000
const MAX_ENTRY_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const FETCH_SLOTS = 6
const NOT_A_PART =
  /^(WireModuleID|NoteModuleID|.*RectanglePCBModuleID|.*Breadboard.*|GroundModuleID|PowerLabelModuleID|.*NetLabel.*|LogoTextModuleID|SchematicLogoTextModuleID|.*LogoImage.*|.*Ruler.*)$/i

export type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

interface Placement {
  x: number
  y: number
  z: number
  layer: string
  matrix: Matrix
}

interface Instance {
  moduleId: string
  label: string
  properties: Record<string, string>
  fzpPath: string
  views: Partial<Record<FritzingView, Placement>>
}

export interface FzWire {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
}

export interface FzItem {
  kind: 'image' | 'box' | 'board' | 'note'
  label: string
  x: number
  y: number
  z: number
  w: number
  h: number
  matrix: Matrix
  svg?: string
}

export interface FzScene {
  view: FritzingView
  items: FzItem[]
  wires: FzWire[]
  bounds: { x: number; y: number; width: number; height: number }
}

export interface FzPart {
  label: string
  title: string
  properties: Record<string, string>
}

export interface FzResult {
  mode: 'sketch' | 'part'
  scenes: FzScene[]
  parts: FzPart[]
}

interface FzpInfo {
  title: string
  images: Partial<Record<FritzingView, string>>
  properties: Record<string, string>
}

const decoder = new TextDecoder()

function xml(text: string) {
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc.documentElement
}

function child(el: Element | null | undefined, name: string) {
  if (!el) return null
  for (const c of el.children) if (c.tagName === name) return c
  return null
}

function attr(el: Element | null | undefined, name: string, fallback = 0) {
  const v = parseFloat(el?.getAttribute(name) ?? '')
  return Number.isFinite(v) ? v : fallback
}

function placement(view: Element): Placement | null {
  const g = child(view, 'geometry')
  if (!g) return null
  const t = child(g, 'transform')
  return {
    x: attr(g, 'x'),
    y: attr(g, 'y'),
    z: attr(g, 'z'),
    layer: view.getAttribute('layer') ?? '',
    matrix: t
      ? [attr(t, 'm11', 1), attr(t, 'm12'), attr(t, 'm21'), attr(t, 'm22', 1), attr(t, 'm31'), attr(t, 'm32')]
      : IDENTITY,
  }
}

function parseSketch(text: string) {
  const root = xml(text)
  if (!root || root.tagName !== 'module') throw new Error('This file is not a Fritzing sketch the viewer can read.')
  const instances: Instance[] = []
  const wires: Record<FritzingView, FzWire[]> = { breadboardView: [], schematicView: [], pcbView: [] }
  const notes: { text: string; x: number; y: number; w: number; h: number }[] = []
  const all = [...(child(root, 'instances')?.children ?? [])].slice(0, MAX_INSTANCES)
  for (const inst of all) {
    if (inst.tagName !== 'instance') continue
    const moduleId = inst.getAttribute('moduleIdRef') ?? ''
    const views = child(inst, 'views')
    if (moduleId === 'WireModuleID') {
      const any = child(views, 'breadboardView') ?? child(views, 'schematicView') ?? child(views, 'pcbView')
      const flags = attr(child(any, 'geometry'), 'wireFlags')
      if (flags & RATSNEST) continue
      const view: FritzingView =
        flags & SCHEMATIC_TRACE ? 'schematicView' : flags & PCB_TRACE ? 'pcbView' : 'breadboardView'
      const el = child(views, view)
      const g = child(el, 'geometry')
      if (!g) continue
      const extras = child(el, 'wireExtras')
      const x = attr(g, 'x')
      const y = attr(g, 'y')
      wires[view].push({
        x1: x + attr(g, 'x1'),
        y1: y + attr(g, 'y1'),
        x2: x + attr(g, 'x2'),
        y2: y + attr(g, 'y2'),
        color: extras?.getAttribute('color') || (view === 'pcbView' ? '#f7bd13' : '#404040'),
        width: (attr(extras, 'mils', 22.2222) / 1000) * DPI,
      })
      continue
    }
    if (moduleId === 'NoteModuleID') {
      const g = child(child(views, 'breadboardView'), 'geometry')
      const html = child(inst, 'text')?.textContent ?? ''
      const body = (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      if (g && body)
        notes.push({ text: body, x: attr(g, 'x'), y: attr(g, 'y'), w: attr(g, 'width', 150), h: attr(g, 'height', 60) })
      continue
    }
    const properties: Record<string, string> = {}
    for (const p of inst.children)
      if (p.tagName === 'property') properties[p.getAttribute('name') ?? ''] = p.getAttribute('value') ?? ''
    const instance: Instance = {
      moduleId,
      label: child(inst, 'title')?.textContent ?? '',
      properties,
      fzpPath: (inst.getAttribute('path') ?? '').replace(/\\/g, '/'),
      views: {},
    }
    for (const view of VIEWS) {
      const el = child(views, view)
      const at = el && placement(el)
      if (at) instance.views[view] = at
    }
    instances.push(instance)
  }
  return { instances, wires, notes }
}

function parseFzp(text: string): FzpInfo | null {
  const root = text ? xml(text) : null
  if (!root) return null
  const info: FzpInfo = { title: child(root, 'title')?.textContent?.trim() ?? '', images: {}, properties: {} }
  for (const p of child(root, 'properties')?.children ?? [])
    info.properties[p.getAttribute('name') ?? ''] = p.textContent?.trim() ?? ''
  for (const view of VIEWS) {
    const image = child(child(child(root, 'views'), view), 'layers')?.getAttribute('image')
    if (image) info.images[view] = image
  }
  return info
}

function svgLength(raw: string | undefined) {
  const n = parseFloat(raw ?? '')
  if (!Number.isFinite(n)) return NaN
  if (/in$/i.test(raw!)) return n * DPI
  if (/mm$/i.test(raw!)) return (n / 25.4) * DPI
  if (/cm$/i.test(raw!)) return (n / 2.54) * DPI
  if (/pt$/i.test(raw!)) return (n / 72) * DPI
  return n
}

function svgSize(svg: string) {
  const tag = /<svg\b[^>]*>/i.exec(svg.slice(0, 8000))?.[0] ?? ''
  const read = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
  let w = svgLength(read('width'))
  let h = svgLength(read('height'))
  const box = read('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if ((!(w > 0) || !(h > 0)) && box?.length === 4) {
    w = box[2]
    h = box[3]
  }
  return w > 0 && h > 0 && w < 1e6 && h < 1e6 ? { w, h } : null
}

function corePath(fzpPath: string) {
  if (/partfactory/i.test(fzpPath) || fzpPath.startsWith(':/resources/')) return null
  return /(?:^|\/)((?:core|obsolete|contrib)\/[^/]+\.fzp)$/i.exec(fzpPath)?.[1] ?? null
}

const remote = new Map<string, Promise<string | null>>()

function fetchPart(path: string) {
  let pending = remote.get(path)
  if (!pending) {
    pending = (async () => {
      const key = `fritzing-parts@${PARTS_SHA}|${path}`
      const cached = await cacheGet<string>(key)
      if (cached !== undefined) return cached || null
      const url = `${PARTS}/${path.split('/').map(encodeURIComponent).join('/')}`
      const response = await fetch(url, { credentials: 'omit' }).catch(() => null)
      if (!response || (!response.ok && response.status !== 404)) {
        remote.delete(path)
        return null
      }
      const text = response.ok ? await response.text() : ''
      void cachePut(key, text, text.length * 2)
      return text || null
    })()
    remote.set(path, pending)
  }
  return pending
}

async function pool<T>(items: T[], run: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(FETCH_SLOTS, items.length) }, async () => {
      while (next < items.length) await run(items[next++])
    }),
  )
}

async function unzipText(bytes: ArrayBuffer) {
  const zip = openZip(bytes)
  const entries = new Map<string, string>()
  let budget = MAX_TOTAL_BYTES
  for (const entry of zip.entries) {
    if (entry.dir || entry.size > MAX_ENTRY_BYTES || !/\.(fz|fzp|svg)$/i.test(entry.name)) continue
    if ((budget -= entry.size) < 0) break
    const data = await zip.read(entry).catch(() => null)
    if (data) entries.set(entry.name.split('/').pop()!, decoder.decode(data))
  }
  return entries
}

function bounded(items: FzItem[], wires: FzWire[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const it of items) {
    const m = it.matrix
    for (const [px, py] of [
      [0, 0],
      [it.w, 0],
      [0, it.h],
      [it.w, it.h],
    ])
      add(it.x + m[0] * px + m[2] * py + m[4], it.y + m[1] * px + m[3] * py + m[5])
  }
  for (const w of wires) {
    add(w.x1 - w.width, w.y1 - w.width)
    add(w.x2 + w.width, w.y2 + w.width)
  }
  const pad = 20
  return Number.isFinite(minX)
    ? { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad }
    : null
}

export async function loadFritzing(bytes: ArrayBuffer): Promise<FzResult> {
  const entries = await unzipText(bytes)
  const fzps = new Map<string, { info: FzpInfo; core: string | null }>()
  for (const [name, text] of entries) {
    if (!/^part\..+\.fzp$/i.test(name)) continue
    const info = parseFzp(text)
    const moduleId = xml(text)?.getAttribute('moduleId')
    if (info && moduleId) fzps.set(moduleId, { info, core: null })
  }
  const embeddedSvg = (view: FritzingView, image: string) =>
    entries.get(`svg.${FOLDER[view]}.${image.split('/').pop()}`) ??
    entries.get(`svg.${image.split('/')[0]}.${image.split('/').pop()}`) ??
    null

  const sketchName = [...entries.keys()].find((n) => /\.fz$/i.test(n))
  if (!sketchName) {
    const scenes: FzScene[] = []
    const parts: FzPart[] = []
    for (const { info } of fzps.values()) {
      parts.push({ label: '', title: info.title, properties: info.properties })
      for (const view of VIEWS) {
        const image = info.images[view]
        const svg = image ? embeddedSvg(view, image) : null
        const size = svg && svgSize(svg)
        if (!svg || !size) continue
        const items: FzItem[] = [
          { kind: 'image', label: info.title, x: 0, y: 0, z: 0, w: size.w, h: size.h, matrix: IDENTITY, svg },
        ]
        scenes.push({ view, items, wires: [], bounds: bounded(items, [])! })
      }
    }
    if (parts.length === 0) throw new Error('This file has no Fritzing sketch or part inside.')
    return { mode: 'part', scenes, parts }
  }

  const sketch = parseSketch(entries.get(sketchName)!)
  const wanted = new Map<string, string>()
  for (const inst of sketch.instances) {
    if (fzps.has(inst.moduleId) || wanted.has(inst.moduleId) || /RectanglePCBModuleID$/i.test(inst.moduleId)) continue
    const core = corePath(inst.fzpPath)
    if (core) wanted.set(inst.moduleId, core)
  }
  await pool([...wanted], async ([moduleId, core]) => {
    for (const path of new Set([core, core.replace(/^core\//, 'obsolete/')])) {
      const info = parseFzp((await fetchPart(path)) ?? '')
      if (info) return void fzps.set(moduleId, { info, core: path })
    }
  })

  const svgs = new Map<string, string | null>()
  const requests: { key: string; view: FritzingView; moduleId: string }[] = []
  for (const inst of sketch.instances)
    for (const view of VIEWS) {
      const key = `${inst.moduleId}|${view}`
      if (inst.views[view] && !svgs.has(key)) {
        svgs.set(key, null)
        requests.push({ key, view, moduleId: inst.moduleId })
      }
    }
  await pool(requests, async ({ key, view, moduleId }) => {
    const fzp = fzps.get(moduleId)
    const image = fzp?.info.images[view]
    if (!fzp || !image) return
    if (!fzp.core) return void svgs.set(key, embeddedSvg(view, image))
    const area = fzp.core.split('/')[0]
    svgs.set(
      key,
      (await fetchPart(`svg/${area}/${image}`)) ?? (area === 'core' ? null : await fetchPart(`svg/core/${image}`)),
    )
  })

  const scenes: FzScene[] = []
  for (const view of VIEWS) {
    const items: FzItem[] = []
    for (const inst of sketch.instances) {
      const at = inst.views[view]
      if (
        !at ||
        /^(icon|unknown)$/.test(at.layer) ||
        (view !== 'breadboardView' && at.layer.startsWith('breadboard')) ||
        (view !== 'schematicView' && at.layer.startsWith('schematic'))
      )
        continue
      const title = fzps.get(inst.moduleId)?.info.title || inst.moduleId
      const label = inst.label || title
      if (view === 'pcbView' && /RectanglePCBModuleID$/i.test(inst.moduleId)) {
        const w = (parseFloat(inst.properties.width) / 25.4) * DPI
        const h = (parseFloat(inst.properties.height) / 25.4) * DPI
        if (w > 0 && h > 0) items.push({ kind: 'board', label, x: at.x, y: at.y, z: -1, w, h, matrix: at.matrix })
        continue
      }
      const svg = svgs.get(`${inst.moduleId}|${view}`)
      const size = svg && svgSize(svg)
      if (svg && size)
        items.push({ kind: 'image', label, x: at.x, y: at.y, z: at.z, w: size.w, h: size.h, matrix: at.matrix, svg })
      else items.push({ kind: 'box', label, x: at.x, y: at.y, z: at.z, w: 60, h: 30, matrix: at.matrix })
    }
    if (view === 'breadboardView')
      for (const n of sketch.notes)
        items.push({ kind: 'note', label: n.text, x: n.x, y: n.y, z: 1e9, w: n.w, h: n.h, matrix: IDENTITY })
    items.sort((a, b) => a.z - b.z)
    const wires = sketch.wires[view]
    const bounds = bounded(items, wires)
    if (bounds) scenes.push({ view, items, wires, bounds })
  }

  const parts = sketch.instances
    .filter((inst) => !NOT_A_PART.test(inst.moduleId))
    .map((inst) => {
      const info = fzps.get(inst.moduleId)?.info
      return {
        label: inst.label,
        title: info?.title || inst.moduleId,
        properties: { ...info?.properties, ...inst.properties },
      }
    })
  return { mode: 'sketch', scenes, parts }
}
