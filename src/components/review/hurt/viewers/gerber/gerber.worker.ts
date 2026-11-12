import {
  plot,
  renderBoard,
  renderLayers,
  stringifySvg,
  type Layer,
  type PlotResult,
  type ReadResult,
  type RenderLayersResult,
} from '@tracespace/core'
import { COMMENT, COORDINATE_FORMAT, createParser, DRILL, type GerberTree } from '@tracespace/parser'
import {
  identifyLayers,
  SIDE_ALL,
  SIDE_BOTTOM,
  SIDE_INNER,
  SIDE_TOP,
  TYPE_COPPER,
  TYPE_DRAWING,
  TYPE_DRILL,
  TYPE_OUTLINE,
  TYPE_SILKSCREEN,
  TYPE_SOLDERMASK,
  TYPE_SOLDERPASTE,
} from '@tracespace/identify-layers'
import { serveWorker } from '../../core/workers'

export interface GerberLayer {
  filename: string
  type: string | null
  side: string | null
  svg: string
}

export interface GerberRender {
  layers: GerberLayer[]
  top: string | null
  bottom: string | null
  viewBox: [number, number, number, number]
  units: 'mm' | 'in'
  width: number
  height: number
  outline: boolean
}

const DRAWING_LAYER = /\.(gdd|gdl)$/i
const OUTLINE_LAYER = /\.gm$/i
const NOT_DRILL = /fab|drl_map|drill_map/i
const EAGLE_CAM = /\.(cmp|sol|stc|sts|plc|pls|crc|crs)$/i
const GERBER_HEAD = /^\s*(%|G\d|D\d|M\d|T\d|;|X-?\d|Y-?\d)/
const EXCELLON_HEAD = /^\s*(;[^\n]*\n\s*)*M48/
const FILE_FUNCTION = /TF\.FileFunction,([^*%\r\n]+)/
const FILE_FORMAT = /FORMAT=\{?(\d):(\d)/
const X2_SIDES: Record<string, Layer['side']> = { Top: SIDE_TOP, Bot: SIDE_BOTTOM, Inr: SIDE_INNER }
const X2_TYPES: Record<string, Layer['type']> = {
  Copper: TYPE_COPPER,
  Soldermask: TYPE_SOLDERMASK,
  Legend: TYPE_SILKSCREEN,
  Paste: TYPE_SOLDERPASTE,
  Profile: TYPE_OUTLINE,
  Plated: TYPE_DRILL,
  NonPlated: TYPE_DRILL,
}
const MM_PER_INCH = 25.4
const EXTENT_TYPES = new Set(['copper', 'soldermask', 'silkscreen', 'solderpaste', 'drill', 'outline'])

const PARSE_CHUNK = 64 * 1024

type Extent = PlotResult['boardShape']['size']

function parseLayer(text: string) {
  const parser = createParser()
  for (let i = 0; i < text.length; i += PARSE_CHUNK) parser.feed(text.slice(i, i + PARSE_CHUNK))
  return parser.result()
}

type Identity = Pick<Layer, 'type' | 'side'>

function x2Identity(text: string): Identity | null {
  const match = FILE_FUNCTION.exec(text.slice(0, 8192))
  if (!match) return null
  const [kind, ...rest] = match[1].split(',')
  const type = X2_TYPES[kind] ?? TYPE_DRAWING
  if (type === TYPE_OUTLINE || type === TYPE_DRILL) return { type, side: SIDE_ALL }
  if (type === TYPE_DRAWING) return { type, side: null }
  const side = rest.map((part) => X2_SIDES[part]).find(Boolean) ?? null
  return { type, side: type === TYPE_COPPER ? (side ?? SIDE_INNER) : side }
}

function isLayerText(name: string, text: string) {
  if (/\.txt$/i.test(name)) return EXCELLON_HEAD.test(text)
  if (EAGLE_CAM.test(name)) return GERBER_HEAD.test(text)
  return true
}

function keepCommentFormat(tree: GerberTree) {
  let format: [number, number] | null = null
  for (const node of tree.children) {
    if (node.type === COMMENT) {
      const match = FILE_FORMAT.exec(node.comment)
      if (match) format = [Number(match[1]), Number(match[2])]
    } else if (node.type === COORDINATE_FORMAT) {
      if (!node.format && format) node.format = format
      return
    }
  }
}

function readLayers(files: { name: string; bytes: ArrayBuffer }[]): ReadResult {
  const trees = files.flatMap(({ name, bytes }, i) => {
    try {
      const text = new TextDecoder().decode(bytes)
      if (!isLayerText(name, text)) return []
      const tree = parseLayer(text)
      if (tree.filetype === DRILL) keepCommentFormat(tree)
      return [{ id: `layer-${i}`, filename: name, tree, x2: x2Identity(text) }]
    } catch {
      return []
    }
  })
  const identities = identifyLayers(trees.filter((t) => t.tree.filetype !== DRILL).map((t) => t.filename))
  return {
    layers: trees.map(({ id, filename, tree, x2 }) => ({
      id,
      filename,
      ...(tree.filetype === DRILL ? { type: TYPE_DRILL, side: SIDE_ALL } : (x2 ?? guessIdentity(filename, identities))),
    })),
    parseTreesById: Object.fromEntries(trees.map(({ id, tree }) => [id, tree])),
  }
}

function guessIdentity(filename: string, identities: ReturnType<typeof identifyLayers>): Identity {
  const identity = identities[filename]
  if (DRAWING_LAYER.test(filename)) return { type: TYPE_DRAWING, side: null }
  if (!identity.type && OUTLINE_LAYER.test(filename)) return { type: TYPE_OUTLINE, side: SIDE_ALL }
  if (identity.type === TYPE_DRILL && NOT_DRILL.test(filename)) return { type: TYPE_DRAWING, side: null }
  return identity
}

function pickOutline(parsed: ReadResult) {
  const outlines = parsed.layers.filter((l) => l.type === TYPE_OUTLINE)
  if (outlines.length < 2) return
  const working = outlines.find(
    (l) => !plot({ layers: [l], parseTreesById: parsed.parseTreesById }).boardShape.failureReason,
  )
  if (!working) return
  for (const layer of outlines) if (layer !== working) layer.type = TYPE_DRAWING
}

function unitsOf(plotted: PlotResult, layer: Layer) {
  return plotted.plotTreesById[layer.id].units === 'mm' ? 'mm' : 'in'
}

function boardUnits(plotted: PlotResult) {
  const { layers } = plotted
  const reference =
    layers.find((l) => l.type === TYPE_OUTLINE) ??
    layers.find((l) => l.type === TYPE_COPPER) ??
    layers.find((l) => l.type !== TYPE_DRILL) ??
    layers[0]
  return unitsOf(plotted, reference)
}

function scaleToUnits(plotted: PlotResult, units: 'mm' | 'in') {
  const scales = new Map<string, number>()
  for (const layer of plotted.layers) {
    if (unitsOf(plotted, layer) === units) continue
    const scale = units === 'mm' ? MM_PER_INCH : 1 / MM_PER_INCH
    const tree = plotted.plotTreesById[layer.id]
    if (tree.size.length === 4)
      tree.size = [tree.size[0] * scale, tree.size[1] * scale, tree.size[2] * scale, tree.size[3] * scale]
    scales.set(layer.id, scale)
  }
  return scales
}

function applyScales(rendered: RenderLayersResult, scales: Map<string, number>) {
  for (const [id, scale] of scales) {
    const svg = rendered.rendersById[id]
    svg.children = [
      { type: 'element', tagName: 'g', properties: { transform: `scale(${scale})` }, children: svg.children },
    ]
  }
}

function fabricationExtent({ layers, plotTreesById }: PlotResult): Extent {
  let box: number[] = []
  for (const layer of layers) {
    const size = plotTreesById[layer.id].size
    if (!EXTENT_TYPES.has(layer.type ?? '') || size.length !== 4) continue
    box =
      box.length === 4
        ? [Math.min(box[0], size[0]), Math.min(box[1], size[1]), Math.max(box[2], size[2]), Math.max(box[3], size[3])]
        : [...size]
  }
  return box as Extent
}

async function render(payload: Record<string, unknown>, progress: (message: string) => void) {
  progress('Parsing layers')
  const parsed = readLayers(payload.files as { name: string; bytes: ArrayBuffer }[])
  if (parsed.layers.length === 0) throw new Error('No Gerber layers were found.')
  progress('Plotting')
  pickOutline(parsed)
  const plotted = plot(parsed)
  const units = boardUnits(plotted)
  const scales = scaleToUnits(plotted, units)
  if (plotted.boardShape.failureReason) {
    const extent = fabricationExtent(plotted)
    if (extent.length === 4) plotted.boardShape.size = extent
  }
  const rendered = renderLayers(plotted)
  applyScales(rendered, scales)
  const board =
    rendered.boardShapeRender.path || parsed.layers.some((l) => l.type === 'copper') ? renderBoard(rendered) : null
  const viewBox = rendered.boardShapeRender.viewBox as [number, number, number, number]
  const result: GerberRender = {
    layers: parsed.layers.map((layer) => ({
      filename: layer.filename,
      type: layer.type,
      side: layer.side,
      svg: stringifySvg(rendered.rendersById[layer.id]),
    })),
    top: board ? stringifySvg(board.top) : null,
    bottom: board ? stringifySvg(board.bottom) : null,
    viewBox,
    units,
    width: viewBox[2],
    height: viewBox[3],
    outline: Boolean(rendered.boardShapeRender.path),
  }
  return { result }
}

serveWorker({ render })
