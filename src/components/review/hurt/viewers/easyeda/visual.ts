import type { EasyEdaDocumentKind } from './inspect'

type TextAnchor = 'start' | 'middle' | 'end'
export type TextBaseline = 'top' | 'middle' | 'baseline' | 'bottom'

interface Point {
  x: number
  y: number
}

interface BasePrimitive {
  stroke: string
  strokeWidth: number
  fill: string | null
  opacity: number
  layer?: string
}

export type EasyEdaVisualPrimitive =
  | (BasePrimitive & {
      kind: 'polyline'
      points: Point[]
      closed: boolean
    })
  | (BasePrimitive & {
      kind: 'path'
      path: string
      points?: Point[]
    })
  | (BasePrimitive & {
      kind: 'circle'
      cx: number
      cy: number
      r: number
    })
  | (BasePrimitive & {
      kind: 'rect'
      x: number
      y: number
      width: number
      height: number
      rx: number
      ry: number
      rotation: number
    })
  | {
      kind: 'text'
      x: number
      y: number
      text: string
      size: number
      rotation: number
      fill: string
      opacity: number
      anchor: TextAnchor
      baseline?: TextBaseline
      layer?: string
    }

export interface EasyEdaVisualBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface EasyEdaLayer {
  id: string
  name: string
  color: string
}

export interface EasyEdaVisualDocument {
  title: string
  documentKind: EasyEdaDocumentKind
  primitives: EasyEdaVisualPrimitive[]
  bounds: EasyEdaVisualBounds
  shapeCount: number
  unknownShapePrefixes: string[]
  layers?: EasyEdaLayer[]
}

export function usedLayers(
  primitives: EasyEdaVisualPrimitive[],
  name: (id: string) => string | undefined,
): EasyEdaLayer[] {
  const colors = new Map<string, string>()
  for (const p of primitives)
    if (p.layer && !colors.has(p.layer)) colors.set(p.layer, p.fill ?? (p.kind === 'text' ? '' : p.stroke))
  return [...colors]
    .sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b))
    .map(([id, color]) => ({ id, name: name(id) || `Layer ${id}`, color }))
}

const MAX_PRIMITIVES = 100_000
const BACKGROUND_COLOR = '#131218'
const DEFAULT_PCB_STROKE = '#8fd0ff'
const DEFAULT_SCHEMATIC_STROKE = '#8fe2c4'
const DEFAULT_FILL_OPACITY = 0.25

const STD_LAYER_NAMES: Record<string, string> = {
  '1': 'Top copper',
  '2': 'Bottom copper',
  '3': 'Top silkscreen',
  '4': 'Bottom silkscreen',
  '5': 'Top paste',
  '6': 'Bottom paste',
  '7': 'Top solder mask',
  '8': 'Bottom solder mask',
  '9': 'Ratlines',
  '10': 'Board outline',
  '11': 'Multi-layer',
  '12': 'Document',
  '13': 'Top assembly',
  '14': 'Bottom assembly',
  '15': 'Mechanical',
  '19': '3D model',
}

const PCB_LAYER_COLORS: Record<string, string> = {
  '1': '#ff9f1c',
  '2': '#2ec4b6',
  '3': '#f8f9fa',
  '4': '#ced4da',
  '5': '#f77f00',
  '6': '#4cc9f0',
  '7': '#ff595e',
  '8': '#8ecae6',
  '10': '#84f26a',
  '11': '#ffd166',
  '12': '#bdb2ff',
  '13': '#f4a261',
  '14': '#a8dadc',
  '15': '#90be6d',
  '19': '#e9ecef',
}

export function buildEasyEdaVisualDocument(
  source: unknown,
  filename: string,
  kindHint: EasyEdaDocumentKind,
): EasyEdaVisualDocument | null {
  const root = resolvePrimaryDocument(source)
  if (!root) {
    return null
  }

  const rawShapes = root.shape
  if (!Array.isArray(rawShapes) || rawShapes.length === 0) {
    return null
  }

  const shapeLines = rawShapes.filter((entry): entry is string => typeof entry === 'string').flatMap(splitShapeLines)
  if (shapeLines.length === 0) {
    return null
  }

  const unknownPrefixes = new Set<string>()
  const primitives: EasyEdaVisualPrimitive[] = []

  for (const line of shapeLines) {
    if (primitives.length >= MAX_PRIMITIVES) break
    const parsed = parseShapeLine(line, kindHint, unknownPrefixes)
    if (parsed.length > 0) {
      primitives.push(...parsed)
    }
  }

  if (primitives.length === 0) {
    return null
  }

  const bounds = computeBounds(primitives)
  if (!bounds) {
    return null
  }

  const names = stdLayerNames(root.layers)
  return {
    title: filename,
    documentKind: kindHint,
    primitives,
    bounds,
    shapeCount: shapeLines.length,
    unknownShapePrefixes: Array.from(unknownPrefixes).sort(),
    layers: kindHint === 'pcb' ? usedLayers(primitives, (id) => names.get(id) ?? STD_LAYER_NAMES[id]) : undefined,
  }
}

function stdLayerNames(layers: unknown) {
  const names = new Map<string, string>()
  if (!Array.isArray(layers)) return names
  for (const entry of layers) {
    if (typeof entry !== 'string') continue
    const [id, name] = entry.split('~')
    if (id && name) names.set(id, name.replace(/([a-z])([A-Z])/g, '$1 $2'))
  }
  return names
}

let shapeLayer: string | null = null

function resolvePrimaryDocument(source: unknown): Record<string, unknown> | null {
  const record = asRecord(source)
  if (!record) {
    return null
  }
  if (Array.isArray(record.shape)) {
    return record
  }
  for (const list of [record.schematics, record.pcbs]) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      const document = shapeRecord(entry)
      if (document) return document
    }
  }
  return null
}

function shapeRecord(entry: unknown): Record<string, unknown> | null {
  const nested = asRecord(entry)
  if (!nested) return null
  if (Array.isArray(nested.shape)) return nested
  // dataStr is either stringified JSON or, in some EasyEDA versions, the parsed object
  let data: Record<string, unknown> | null = null
  try {
    data = typeof nested.dataStr === 'string' ? asRecord(JSON.parse(nested.dataStr)) : asRecord(nested.dataStr)
  } catch {
    return null
  }
  return data && Array.isArray(data.shape) ? data : null
}

export interface EasyEdaStdDocument {
  label: string
  kind: 'schematic' | 'pcb'
  record: Record<string, unknown>
}

export function listEasyEdaDocuments(source: unknown): EasyEdaStdDocument[] {
  const record = asRecord(source)
  if (!record || Array.isArray(record.shape)) return []
  const documents: EasyEdaStdDocument[] = []
  for (const [kind, list] of [
    ['schematic', record.schematics],
    ['pcb', record.pcbs],
  ] as const) {
    if (!Array.isArray(list)) continue
    list.forEach((entry, index) => {
      const document = shapeRecord(entry)
      if (!document || (document.shape as unknown[]).length === 0) return
      const title = asRecord(entry)?.title
      documents.push({
        label: typeof title === 'string' && title ? title : `Sheet ${index + 1}`,
        kind,
        record: document,
      })
    })
  }
  return documents
}

function splitShapeLines(rawShape: string): string[] {
  return rawShape
    .replace(/#@\$/g, '\n')
    .replace(/@\$/g, '\n')
    .split(/\r?\n/)
    .map((part) => part.trim().replace(/^#+/, '').trim())
    .filter((part) => part.length > 0)
}

function parseShapeLine(
  line: string,
  kindHint: EasyEdaDocumentKind,
  unknownPrefixes: Set<string>,
): EasyEdaVisualPrimitive[] {
  const outer = shapeLayer
  shapeLayer = null
  const primitives = readShapeLine(line, kindHint, unknownPrefixes)
  if (shapeLayer) for (const p of primitives) p.layer ??= shapeLayer
  shapeLayer = outer
  return primitives
}

function readShapeLine(
  line: string,
  kindHint: EasyEdaDocumentKind,
  unknownPrefixes: Set<string>,
): EasyEdaVisualPrimitive[] {
  const parts = line.split('~')
  const head = parts[0] ?? ''
  const tokens = head.split('_')
  const prefix = (tokens[0] ?? '').trim().toUpperCase()
  if (!prefix) {
    return []
  }

  const defaultStroke = kindHint === 'schematic' ? DEFAULT_SCHEMATIC_STROKE : DEFAULT_PCB_STROKE

  switch (prefix) {
    case 'TRACK': {
      // PCB: TRACK~strokeWidth~layerId~net~points~id~locked (tilde-separated)
      // Old: TRACK_strokeWidth_layerId_net_points (underscore-separated)
      const isTilde = tokens.length <= 1 && parts.length > 1
      const f = isTilde ? parts : tokens
      const points = parsePoints(f[4] ?? '')
      if (points.length < 2) return []
      const layer = f[2] ?? ''
      return [
        {
          kind: 'polyline',
          points,
          closed: false,
          stroke: layerColor(layer, defaultStroke),
          strokeWidth: positiveNumber(f[1], 1.2),
          fill: null,
          opacity: 1,
        },
      ]
    }
    case 'CIRCLE': {
      // PCB: CIRCLE~cx~cy~r~strokeWidth~layerId~id~locked
      const isTilde = tokens.length <= 1 && parts.length > 1
      const f = isTilde ? parts : tokens
      const r = Math.abs(number(f[3], 0))
      if (r <= 0) return []
      const layer = f[5] ?? ''
      return [
        {
          kind: 'circle',
          cx: number(f[1], 0),
          cy: number(f[2], 0),
          r,
          stroke: layerColor(layer, defaultStroke),
          strokeWidth: positiveNumber(f[4], 1),
          fill: null,
          opacity: 1,
        },
      ]
    }
    case 'RECT': {
      // PCB: RECT~x~y~width~height~layerId~id~locked
      const isTilde = tokens.length <= 1 && parts.length > 1
      const f = isTilde ? parts : tokens
      const normalized = normalizeRect(number(f[1], 0), number(f[2], 0), number(f[3], 0), number(f[4], 0))
      if (normalized.width <= 0 || normalized.height <= 0) {
        return []
      }
      const layer = f[5] ?? ''
      return [
        {
          kind: 'rect',
          x: normalized.x,
          y: normalized.y,
          width: normalized.width,
          height: normalized.height,
          rx: 0,
          ry: 0,
          rotation: 0,
          stroke: layerColor(layer, defaultStroke),
          strokeWidth: 0.8,
          fill: null,
          opacity: 1,
        },
      ]
    }
    case 'ARC': {
      // PCB: ARC~strokeWidth~layerId~net~pathString~helperDots~id~locked
      const isTilde = tokens.length <= 1 && parts.length > 1
      const f = isTilde ? parts : tokens
      const layer = f[2] ?? ''
      const path = isTilde ? (f[4] ?? '').trim() : tokens.slice(4).join('_').trim()
      if (!path) return []
      return [
        {
          kind: 'path',
          path,
          stroke: layerColor(layer, defaultStroke),
          strokeWidth: positiveNumber(f[1], 1),
          fill: null,
          opacity: 1,
        },
      ]
    }
    case 'SOLIDREGION':
    case 'COPPERAREA': {
      // PCB SOLIDREGION: SOLIDREGION~layerId~net~points~type~id~locked
      // PCB COPPERAREA: COPPERAREA~strokeWidth~layerId~net~points~clearance~fillStyle~id~...
      const isTilde = tokens.length <= 1 && parts.length > 1
      if (isTilde) {
        const layer = prefix === 'SOLIDREGION' ? (parts[1] ?? '') : (parts[2] ?? '')
        const path = prefix === 'SOLIDREGION' ? (parts[3] ?? '') : (parts[4] ?? '')
        if (!path.trim()) return []
        const color = layerColor(layer, defaultStroke)
        return [
          {
            kind: 'path',
            path: path.trim(),
            stroke: color,
            strokeWidth: 0.4,
            fill: color,
            opacity: DEFAULT_FILL_OPACITY,
          },
        ]
      }
      const layer = tokens[1] ?? tokens[2] ?? ''
      const path = prefix === 'SOLIDREGION' ? tokens.slice(3).join('_') : tokens.slice(4).join('_')
      if (!path.trim()) return []
      const color = layerColor(layer, defaultStroke)
      return [
        {
          kind: 'path',
          path: path.trim(),
          stroke: color,
          strokeWidth: 0.4,
          fill: color,
          opacity: DEFAULT_FILL_OPACITY,
        },
      ]
    }
    case 'SVGNODE': {
      const payload = parseSvgNodePayload(parts[1])
      if (!payload?.pathData) return []
      const color = layerColor(payload.layerId, defaultStroke)
      return [
        {
          kind: 'path',
          path: payload.pathData,
          stroke: color,
          strokeWidth: 0.5,
          fill: color,
          opacity: DEFAULT_FILL_OPACITY,
        },
      ]
    }
    case 'TEXT': {
      // PCB: TEXT~type~x~y~strokeWidth~rotation~mirror~layerId~net~fontSize~string~pathData~display~id
      const isTilde = tokens.length <= 1 && parts.length > 1
      const f = isTilde ? parts : tokens
      const displayToken = (f[1] ?? '').toLowerCase()
      if (displayToken.includes('none')) return []
      const layer = isTilde ? (f[7] ?? '') : (f[6] ?? '')
      const text = decodeEasyEdaText(isTilde ? (f[10] ?? '') : (f[8] ?? ''))
      if (!text) return []
      // PCB TEXT has path data for the rendered text outline
      const pathData = isTilde ? (f[11] ?? '').trim() : ''
      if (pathData) {
        return [
          {
            kind: 'path',
            path: pathData,
            stroke: layerColor(layer, defaultStroke),
            strokeWidth: positiveNumber(f[4], 0.8),
            fill: null,
            opacity: 0.95,
          },
        ]
      }
      return [
        {
          kind: 'text',
          x: number(f[2], 0),
          y: number(f[3], 0),
          text,
          size: positiveNumber(isTilde ? f[9] : f[7], 8),
          rotation: number(f[5], 0),
          fill: layerColor(layer, defaultStroke),
          opacity: 0.95,
          anchor: 'start',
        },
      ]
    }
    case 'VIA': {
      // PCB: VIA~cx~cy~diameter~net~holeRadius~id~locked
      const isTilde = tokens.length <= 1 && parts.length > 1
      const f = isTilde ? parts : tokens
      const x = number(f[1], 0)
      const y = number(f[2], 0)
      const diameter = Math.abs(number(f[3], 0))
      if (diameter <= 0) return []
      const drillRadius = Math.abs(number(f[5], 0))
      const outer = diameter / 2
      const inner = drillRadius > 0 ? Math.min(outer * 0.9, drillRadius) : 0
      const layerColorValue = layerColor('1', defaultStroke)
      const output: EasyEdaVisualPrimitive[] = [
        {
          kind: 'circle',
          cx: x,
          cy: y,
          r: outer,
          stroke: layerColorValue,
          strokeWidth: 0.6,
          fill: layerColorValue,
          opacity: 0.85,
        },
      ]
      if (inner > 0) {
        output.push({
          kind: 'circle',
          cx: x,
          cy: y,
          r: inner,
          stroke: '#2f2b3b',
          strokeWidth: 0.4,
          fill: BACKGROUND_COLOR,
          opacity: 1,
        })
      }
      return output
    }
    case 'HOLE': {
      // PCB: HOLE~cx~cy~diameter~id~locked
      const isTilde = tokens.length <= 1 && parts.length > 1
      const f = isTilde ? parts : tokens
      const radius = Math.abs(number(f[3], 0))
      if (radius <= 0) return []
      return [
        {
          kind: 'circle',
          cx: number(f[1], 0),
          cy: number(f[2], 0),
          r: radius,
          stroke: '#cbd5e1',
          strokeWidth: 0.6,
          fill: BACKGROUND_COLOR,
          opacity: 1,
        },
      ]
    }
    case 'PAD': {
      // PCB: PAD~shape~cx~cy~width~height~layerId~net~number~holeRadius~points~rotation~id~...
      const isTilde = tokens.length <= 1 && parts.length > 1
      const f = isTilde ? parts : tokens
      return parsePad(f, defaultStroke)
    }
    case 'W':
    case 'PL':
    case 'PG': {
      // Standard schematic: PL~points~color~width~...  (tilde-separated, parts[0] is just the prefix)
      // PCB format: PL_points_color_width  (underscore-separated within parts[0])
      const isStdSch = tokens.length <= 1 && parts.length > 1
      const pointsStr = isStdSch ? (parts[1] ?? '') : (tokens[1] ?? '')
      const colorStr = isStdSch ? parts[2] : tokens[2]
      const widthStr = isStdSch ? parts[3] : tokens[3]
      const fillStr = isStdSch ? parts[5] : tokens[5]
      const points = parsePoints(pointsStr)
      if (points.length < 2) return []
      return [
        {
          kind: 'polyline',
          points,
          closed: prefix === 'PG',
          stroke: normalizeColor(colorStr, defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(widthStr, 1),
          fill: prefix === 'PG' ? normalizeColor(fillStr, null) : null,
          opacity: 1,
        },
      ]
    }
    case 'PT':
    case 'A': {
      // Standard schematic: PT~pathdata~color~width~...  or  A~pathdata~color~width~...
      const isStdSch = tokens.length <= 1 && parts.length > 1
      const path = isStdSch ? (parts[1] ?? '') : (tokens[1] ?? '')
      if (!path.trim()) return []
      const colorStr = isStdSch ? parts[2] : tokens[2]
      const widthStr = isStdSch ? parts[3] : tokens[3]
      const fillStr = isStdSch ? parts[5] : tokens[5]
      return [
        {
          kind: 'path',
          path,
          stroke: normalizeColor(colorStr, defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(widthStr, 1),
          fill: normalizeColor(fillStr, null),
          opacity: 1,
        },
      ]
    }
    case 'R': {
      // Standard schematic: R~x~y~rx~ry~width~height~color~strokeWidth~...~fill
      const isStdSch = tokens.length <= 1 && parts.length > 1
      const f = isStdSch ? parts : tokens
      const normalized = normalizeRect(number(f[1], 0), number(f[2], 0), number(f[5], 0), number(f[6], 0))
      if (normalized.width <= 0 || normalized.height <= 0) return []
      return [
        {
          kind: 'rect',
          x: normalized.x,
          y: normalized.y,
          width: normalized.width,
          height: normalized.height,
          rx: Math.abs(number(f[3], 0)),
          ry: Math.abs(number(f[4], 0)),
          rotation: 0,
          stroke: normalizeColor(f[7], defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(f[8], 1),
          fill: normalizeColor(f[10], null),
          opacity: 1,
        },
      ]
    }
    case 'E': {
      const isStdSch = tokens.length <= 1 && parts.length > 1
      const f = isStdSch ? parts : tokens
      const cx = number(f[1], 0)
      const cy = number(f[2], 0)
      const rx = Math.abs(number(f[3], 0))
      const ry = Math.abs(number(f[4], rx))
      if (rx <= 0 || ry <= 0) return []
      return [
        {
          kind: 'rect',
          x: cx - rx,
          y: cy - ry,
          width: rx * 2,
          height: ry * 2,
          rx,
          ry,
          rotation: 0,
          stroke: normalizeColor(f[5], defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(f[6], 1),
          fill: normalizeColor(f[8], null),
          opacity: 1,
        },
      ]
    }
    case 'N': {
      // Standard schematic netlabel: N~pinDotX~pinDotY~rotation~color~name~id~anchor~posX~posY~fontFamily~fontSize
      const isStdSch = tokens.length <= 1 && parts.length > 1
      if (isStdSch) {
        const text = decodeEasyEdaText(parts[5] ?? '')
        if (!text) return []
        return [
          {
            kind: 'text',
            x: number(parts[8] || parts[1], 0),
            y: number(parts[9] || parts[2], 0),
            text,
            size: positiveNumber(parts[11], 7),
            rotation: number(parts[3], 0),
            fill: normalizeColor(parts[4], defaultStroke) ?? defaultStroke,
            opacity: 0.95,
            anchor: inferTextAnchor(parts[7] ?? 'start'),
          },
        ]
      }
      const text = decodeEasyEdaText(tokens[4] ?? '')
      if (!text) return []
      return [
        {
          kind: 'text',
          x: number(tokens[1], 0),
          y: number(tokens[2], 0),
          text,
          size: positiveNumber(parts[1], 7),
          rotation: number(tokens[3], 0),
          fill: normalizeColor(tokens[5], defaultStroke) ?? defaultStroke,
          opacity: 0.95,
          anchor: 'middle',
        },
      ]
    }
    case 'T': {
      // Standard schematic T: T~displayFlag~x~y~rotation~color~fontFamily~fontSize~~~~anchor~text~visible~alignment~id~...
      // PCB T: parts[0] = T_..._..._... with underscore tokens
      const isStdSch = tokens.length <= 1 && parts.length > 1
      if (isStdSch) {
        const displayFlag = (parts[1] ?? '').toUpperCase()
        if (displayFlag === 'H' || displayFlag === 'HIDE') return []
        const text = decodeEasyEdaText(parts[12] ?? '')
        if (!text) return []
        return [
          {
            kind: 'text',
            x: number(parts[2], 0),
            y: number(parts[3], 0),
            text,
            size: positiveNumber(parts[7], 7),
            rotation: number(parts[4], 0),
            fill: normalizeColor(parts[5], defaultStroke) ?? defaultStroke,
            opacity: 0.95,
            anchor: inferTextAnchor(parts[13] ?? 'start'),
          },
        ]
      }
      const text = decodeEasyEdaText(tokens[8] ?? '')
      if (!text) return []
      return [
        {
          kind: 'text',
          x: number(tokens[2], 0),
          y: number(tokens[3], 0),
          text,
          size: positiveNumber(tokens[7], 7),
          rotation: number(tokens[4], 0),
          fill: normalizeColor(tokens[5], defaultStroke) ?? defaultStroke,
          opacity: 0.95,
          anchor: inferTextAnchor(parts[2] ?? 'start'),
        },
      ]
    }
    case 'F': {
      // Netflag: F~partId~x~y~rotation~id^^pinDot^^markString^^shapes...
      // Segments separated by ^^
      const segments = line.split('^^')
      const results: EasyEdaVisualPrimitive[] = []
      if (segments.length >= 3) {
        // Mark string segment: name~color~posX~posY~rotation~anchor~visible~fontFamily~fontSize
        const markParts = (segments[2] ?? '').split('~')
        const text = decodeEasyEdaText(markParts[0] ?? '')
        const visible = markParts[6] !== '0'
        if (text && visible) {
          results.push({
            kind: 'text',
            x: number(markParts[2], number(parts[2], 0)),
            y: number(markParts[3], number(parts[3], 0)),
            text,
            size: positiveNumber(markParts[8], 7),
            rotation: number(markParts[4], 0),
            fill: normalizeColor(markParts[1], defaultStroke) ?? defaultStroke,
            opacity: 0.95,
            anchor: inferTextAnchor(markParts[5] ?? 'start'),
          })
        }
      }
      // Parse embedded shapes (segments after the mark string)
      for (let i = 3; i < segments.length; i++) {
        const shapeLine = (segments[i] ?? '').trim()
        if (shapeLine) {
          const nested = parseShapeLine(shapeLine, kindHint, unknownPrefixes)
          results.push(...nested)
        }
      }
      return results
    }
    case 'BE': {
      // Bus entry: BE~rotation~x1~y1~x2~y2~id
      const isStdSch = tokens.length <= 1 && parts.length > 1
      const f = isStdSch ? parts : tokens
      const x1 = number(f[2], 0)
      const y1 = number(f[3], 0)
      const x2 = number(f[4], 0)
      const y2 = number(f[5], 0)
      if (x1 === x2 && y1 === y2) return []
      return [
        {
          kind: 'polyline',
          points: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ],
          closed: false,
          stroke: defaultStroke,
          strokeWidth: 1,
          fill: null,
          opacity: 1,
        },
      ]
    }
    case 'L': {
      // Line: L~x1~y1~x2~y2~color~width~style~fillColor~id
      const isStdSch = tokens.length <= 1 && parts.length > 1
      const f = isStdSch ? parts : tokens
      const x1 = number(f[1], 0)
      const y1 = number(f[2], 0)
      const x2 = number(f[3], 0)
      const y2 = number(f[4], 0)
      if (x1 === x2 && y1 === y2) return []
      return [
        {
          kind: 'polyline',
          points: [
            { x: x1, y: y1 },
            { x: x2, y: y2 },
          ],
          closed: false,
          stroke: normalizeColor(f[5], defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(f[6], 1),
          fill: null,
          opacity: 1,
        },
      ]
    }
    case 'C': {
      // Circle: C~cx~cy~r~color~width~style~fillColor~id
      const isStdSch = tokens.length <= 1 && parts.length > 1
      const f = isStdSch ? parts : tokens
      const r = Math.abs(number(f[3], 0))
      if (r <= 0) return []
      return [
        {
          kind: 'circle',
          cx: number(f[1], 0),
          cy: number(f[2], 0),
          r,
          stroke: normalizeColor(f[4], defaultStroke) ?? defaultStroke,
          strokeWidth: positiveNumber(f[5], 1),
          fill: normalizeColor(f[7], null),
          opacity: 1,
        },
      ]
    }
    case 'J': {
      const isStdSch = tokens.length <= 1 && parts.length > 1
      const diameter = positiveNumber(isStdSch ? parts[3] : parts[1], 3)
      return [
        {
          kind: 'circle',
          cx: number(isStdSch ? parts[1] : tokens[1], 0),
          cy: number(isStdSch ? parts[2] : tokens[2], 0),
          r: diameter / 2,
          stroke: defaultStroke,
          strokeWidth: 0.6,
          fill: defaultStroke,
          opacity: 1,
        },
      ]
    }
    case 'O': {
      const isStdSch = tokens.length <= 1 && parts.length > 1
      const x = number(isStdSch ? parts[1] : tokens[1], 0)
      const y = number(isStdSch ? parts[2] : tokens[2], 0)
      const size = 3
      return [
        {
          kind: 'polyline',
          points: [
            { x: x - size, y: y - size },
            { x: x + size, y: y + size },
          ],
          closed: false,
          stroke: defaultStroke,
          strokeWidth: 0.9,
          fill: null,
          opacity: 1,
        },
        {
          kind: 'polyline',
          points: [
            { x: x + size, y: y - size },
            { x: x - size, y: y + size },
          ],
          closed: false,
          stroke: defaultStroke,
          strokeWidth: 0.9,
          fill: null,
          opacity: 1,
        },
      ]
    }
    case 'P': {
      // Schematic pin: P~show~electricType~spicePin~x~y~rotation~id^^pinDotX~pinDotY^^pathData~color^^name^^number^^dot^^clock
      const segments = line.split('^^')
      const results: EasyEdaVisualPrimitive[] = []
      // Segment 2: pin path (the visible line connecting component body to pin dot)
      if (segments.length >= 3) {
        const pathSegParts = (segments[2] ?? '').split('~')
        const pathData = pathSegParts[0] ?? ''
        const pathColor = normalizeColor(pathSegParts[1], defaultStroke) ?? defaultStroke
        if (pathData.trim()) {
          results.push({
            kind: 'path',
            path: pathData,
            stroke: pathColor,
            strokeWidth: 1,
            fill: null,
            opacity: 1,
          })
        }
      }
      // Segment 1: pin dot (small circle at connection point)
      if (segments.length >= 2) {
        const dotParts = (segments[1] ?? '').split('~')
        const dotX = number(dotParts[0], NaN)
        const dotY = number(dotParts[1], NaN)
        if (Number.isFinite(dotX) && Number.isFinite(dotY)) {
          results.push({
            kind: 'circle',
            cx: dotX,
            cy: dotY,
            r: 1.5,
            stroke: defaultStroke,
            strokeWidth: 0.3,
            fill: defaultStroke,
            opacity: 0.4,
          })
        }
      }
      // Segments 3 and 4: pin name and number, each show~x~y~rotation~text~anchor~fontFamily~fontSize~color
      for (const segment of segments.slice(3, 5)) {
        const label = (segment ?? '').split('~')
        const text = decodeEasyEdaText(label[4] ?? '')
        if (label[0] !== '1' || !text) continue
        results.push({
          kind: 'text',
          x: number(label[1], 0),
          y: number(label[2], 0),
          text,
          size: positiveNumber(label[7], 7),
          rotation: number(label[3], 0),
          fill: normalizeColor(label[8], defaultStroke) ?? defaultStroke,
          opacity: 0.95,
          anchor: inferTextAnchor(label[5] ?? 'start'),
          baseline: 'baseline',
        })
      }
      // Segment 5: NOT dot (small circle indicating inversion)
      if (segments.length >= 6) {
        const notParts = (segments[5] ?? '').split('~')
        if (notParts[0] === '1') {
          const notX = number(notParts[1], NaN)
          const notY = number(notParts[2], NaN)
          if (Number.isFinite(notX) && Number.isFinite(notY)) {
            results.push({
              kind: 'circle',
              cx: notX,
              cy: notY,
              r: 3,
              stroke: defaultStroke,
              strokeWidth: 0.8,
              fill: null,
              opacity: 1,
            })
          }
        }
      }
      // Segment 6: clock indicator path
      if (segments.length >= 7) {
        const clockParts = (segments[6] ?? '').split('~')
        if (clockParts[0] === '1') {
          const clockPath = clockParts[1] ?? ''
          if (clockPath.trim()) {
            results.push({
              kind: 'path',
              path: clockPath,
              stroke: defaultStroke,
              strokeWidth: 0.8,
              fill: null,
              opacity: 1,
            })
          }
        }
      }
      return results
    }
    default: {
      if (prefix !== 'LIB' && prefix !== 'PIN' && prefix !== 'DIMENSION' && prefix !== 'I' && prefix !== 'PIMAGE') {
        unknownPrefixes.add(prefix)
      }
      return []
    }
  }
}

function parsePad(tokens: string[], fallbackStroke: string): EasyEdaVisualPrimitive[] {
  // PAD~shape~cx~cy~width~height~layerId~net~number~holeRadius~points~rotation~id~holeLength~holePoints~plated
  const shape = (tokens[1] ?? '').toUpperCase()
  const x = number(tokens[2], 0)
  const y = number(tokens[3], 0)
  const width = Math.abs(number(tokens[4], 0))
  const height = Math.abs(number(tokens[5], width))
  if (width <= 0 || height <= 0) {
    return []
  }

  const layer = tokens[6] ?? ''
  const color = layerColor(layer, fallbackStroke)
  const holeRadius = Math.abs(number(tokens[9], 0))
  const rotation = number(tokens[11], 0)
  const padPrimitives: EasyEdaVisualPrimitive[] = []

  if (shape === 'POLYGON') {
    const polygonPoints = parsePoints(tokens[10] ?? '')
    if (polygonPoints.length >= 3) {
      padPrimitives.push({
        kind: 'polyline',
        points: polygonPoints,
        closed: true,
        stroke: color,
        strokeWidth: 0.5,
        fill: color,
        opacity: 0.85,
      })
    }
  }

  if (padPrimitives.length === 0) {
    const normalized = normalizeRect(x - width / 2, y - height / 2, width, height)
    const rx = shape === 'RECT' ? 0 : normalized.width / 2
    const ry = shape === 'RECT' ? 0 : normalized.height / 2
    padPrimitives.push({
      kind: 'rect',
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      rx,
      ry,
      rotation,
      stroke: color,
      strokeWidth: 0.5,
      fill: color,
      opacity: 0.85,
    })
  }

  if (holeRadius > 0) {
    padPrimitives.push({
      kind: 'circle',
      cx: x,
      cy: y,
      r: holeRadius,
      stroke: '#2f2b3b',
      strokeWidth: 0.4,
      fill: BACKGROUND_COLOR,
      opacity: 1,
    })
  }

  return padPrimitives
}

function parseSvgNodePayload(payload: string | undefined): { layerId: string; pathData: string } | null {
  if (!payload) {
    return null
  }

  try {
    const value = JSON.parse(payload) as unknown
    const record = asRecord(value)
    const attrs = asRecord(record?.attrs)
    const pathData = typeof attrs?.d === 'string' ? attrs.d : ''
    const layerId = typeof record?.layerid === 'string' ? record.layerid : ''
    if (!pathData) {
      return null
    }
    return { layerId, pathData }
  } catch {
    return null
  }
}

function computeBounds(primitives: EasyEdaVisualPrimitive[]): EasyEdaVisualBounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const includePoint = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  for (const primitive of primitives) {
    switch (primitive.kind) {
      case 'polyline':
        for (const point of primitive.points) {
          includePoint(point.x, point.y)
        }
        break
      case 'path': {
        const pathCoords = primitive.points ?? pathPoints(primitive.path)
        for (const point of pathCoords) {
          includePoint(point.x, point.y)
        }
        break
      }
      case 'circle':
        includePoint(primitive.cx - primitive.r, primitive.cy - primitive.r)
        includePoint(primitive.cx + primitive.r, primitive.cy + primitive.r)
        break
      case 'rect':
        includePoint(primitive.x, primitive.y)
        includePoint(primitive.x + primitive.width, primitive.y + primitive.height)
        break
      case 'text':
        includeText(primitive, includePoint)
        break
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  const padding = 10
  const paddedMinX = minX - padding
  const paddedMinY = minY - padding
  const paddedMaxX = maxX + padding
  const paddedMaxY = maxY + padding
  const width = Math.max(1, paddedMaxX - paddedMinX)
  const height = Math.max(1, paddedMaxY - paddedMinY)

  return {
    minX: paddedMinX,
    minY: paddedMinY,
    maxX: paddedMaxX,
    maxY: paddedMaxY,
    width,
    height,
  }
}

export const MAX_TEXT_LINE = 120

export function textLines(text: string): string[] {
  return text.split('\n').map((line) => (line.length > MAX_TEXT_LINE ? `${line.slice(0, MAX_TEXT_LINE - 3)}...` : line))
}

export function includeText(
  p: Extract<EasyEdaVisualPrimitive, { kind: 'text' }>,
  include: (x: number, y: number) => void,
) {
  const lines = textLines(p.text)
  const width = Math.max(...lines.map((line) => line.length)) * p.size * 0.58
  const height = lines.length * p.size * 1.2
  const left = p.anchor === 'middle' ? -width / 2 : p.anchor === 'end' ? -width : 0
  const top =
    p.baseline === 'top'
      ? 0
      : p.baseline === 'baseline'
        ? -p.size * 0.9
        : p.baseline === 'bottom'
          ? -height
          : -height / 2
  const rad = (p.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  for (const [dx, dy] of [
    [left, top],
    [left + width, top],
    [left, top + height],
    [left + width, top + height],
  ])
    include(p.x + dx * cos - dy * sin, p.y + dx * sin + dy * cos)
}

export function pathPoints(path: string): Point[] {
  const points: Point[] = []
  const tokens = path.match(/[MLHVCSQTAZmlhvcsqtaz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
  let cmd = ''
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  for (let i = 0; i < tokens.length; ) {
    if (/^[a-z]$/i.test(tokens[i])) {
      cmd = tokens[i++]
      if (cmd === 'Z' || cmd === 'z') {
        x = startX
        y = startY
      }
      continue
    }
    const nums: number[] = []
    while (i < tokens.length && !/^[a-z]$/i.test(tokens[i])) nums.push(parseFloat(tokens[i++]))
    const relative = cmd === cmd.toLowerCase()
    const size = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7 }[cmd.toUpperCase()] ?? 0
    for (let j = 0; size && j + size <= nums.length; j += size) {
      const ox = relative ? x : 0
      const oy = relative ? y : 0
      const upper = cmd.toUpperCase()
      const nx = upper === 'V' ? x : ox + nums[j + size - (upper === 'H' ? 1 : 2)]
      const ny = upper === 'H' ? y : oy + nums[j + size - 1]
      if (upper === 'A') arcExtremes(x, y, Math.abs(nums[j]), nums[j + 3] !== 0, nums[j + 4] !== 0, nx, ny, points)
      points.push({ x: nx, y: ny })
      x = nx
      y = ny
      if (upper === 'M' && j === 0) {
        startX = x
        startY = y
      }
    }
  }
  return points
}

function arcExtremes(
  x1: number,
  y1: number,
  r: number,
  large: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
  out: Point[],
) {
  const dx = (x2 - x1) / 2
  const dy = (y2 - y1) / 2
  const half = Math.hypot(dx, dy)
  if (!half || !r) return
  const radius = Math.max(r, half)
  const offset = (Math.sqrt(Math.max(0, radius * radius - half * half)) / half) * (large === sweep ? -1 : 1)
  const cx = x1 + dx - offset * dy
  const cy = y1 + dy + offset * dx
  const tau = Math.PI * 2
  const a1 = Math.atan2(y1 - cy, x1 - cx)
  const turn = (a: number) => (((sweep ? a - a1 : a1 - a) % tau) + tau) % tau
  const span = turn(Math.atan2(y2 - cy, x2 - cx))
  for (let k = 0; k < 4; k++)
    if (turn((k * Math.PI) / 2) < span)
      out.push({ x: cx + radius * Math.cos((k * Math.PI) / 2), y: cy + radius * Math.sin((k * Math.PI) / 2) })
}

function parsePoints(value: string): Point[] {
  const values = extractNumbers(value)
  const points: Point[] = []
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push({ x: values[index], y: values[index + 1] })
  }
  return points
}

function extractNumbers(value: string): number[] {
  const matches = value.match(/-?\d+(?:\.\d+)?/g)
  if (!matches) return []
  return matches.map((entry) => Number.parseFloat(entry)).filter((entry) => Number.isFinite(entry))
}

function normalizeRect(x: number, y: number, width: number, height: number) {
  const normalizedX = width >= 0 ? x : x + width
  const normalizedY = height >= 0 ? y : y + height
  return {
    x: normalizedX,
    y: normalizedY,
    width: Math.abs(width),
    height: Math.abs(height),
  }
}

function layerColor(layerId: string, fallback: string): string {
  if (!layerId) return fallback
  shapeLayer = layerId
  return PCB_LAYER_COLORS[layerId] ?? fallback
}

function inferTextAnchor(rawValue: string): TextAnchor {
  const normalized = rawValue.trim().toLowerCase()
  if (normalized === 'middle' || normalized === 'center') return 'middle'
  if (normalized === 'end' || normalized === 'right') return 'end'
  return 'start'
}

function decodeEasyEdaText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function normalizeColor(value: string | undefined, fallback: string | null): string | null {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return fallback
  if (trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'null') return null
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return isDarkColor(trimmed) ? fallback : trimmed
  if (/^(rgba?|hsla?)\(/i.test(trimmed)) return trimmed
  return fallback
}

function isDarkColor(hex: string): boolean {
  const stripped = hex.replace('#', '')
  const full = stripped.length <= 4 ? [...stripped].map((c) => c + c).join('') : stripped
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false
  return (r * 299 + g * 587 + b * 114) / 1000 < 40
}

function number(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = number(value, fallback)
  return parsed > 0 ? parsed : fallback
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}
