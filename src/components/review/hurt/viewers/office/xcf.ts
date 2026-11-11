import { inflateTo } from './inflate'
import { outputSize, sampleGrid, type Flattened } from './psd'

const PROP_END = 0
const PROP_COLORMAP = 1
const PROP_OPACITY = 6
const PROP_MODE = 7
const PROP_VISIBLE = 8
const PROP_APPLY_MASK = 11
const PROP_OFFSETS = 15
const PROP_COMPRESSION = 17
const PROP_GROUP_ITEM = 29
const PROP_ITEM_PATH = 30
const PROP_FLOAT_OPACITY = 33
const TILE = 64
const TILE_BATCH = 256
const LAYER_LIMIT = 5000
const PROPERTY_LIMIT = 10000
const WORK_PER_PIXEL = 32
const NORMAL_MODES = new Set([0, 28])
const COMPONENT_BYTES: Record<number, number> = {
  100: 1,
  150: 1,
  200: 2,
  250: 2,
  300: 4,
  350: 4,
  500: 2,
  550: 2,
  600: 4,
  650: 4,
  700: 8,
  750: 8,
}

interface Layer {
  type: number
  opacity: number
  visible: boolean
  x: number
  y: number
  mode: number
  group: boolean
  path: number[] | null
  applyMask: boolean
  hierarchy: number
  mask: number
  key: string
}

interface Tiles {
  width: number
  height: number
  bpp: number
  columns: number
  pointers: number[]
  end: number
}

export async function readXcf(buffer: ArrayBuffer, maxPixels: number): Promise<Flattened> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const tag = new TextDecoder('latin1').decode(bytes.subarray(9, 13))
  const version = tag === 'file' ? 0 : parseInt(tag.slice(1), 10) || 0
  const pointerSize = version >= 11 ? 8 : 4
  let at = 14
  const u32 = () => {
    const value = view.getUint32(at)
    at += 4
    return value
  }
  const pointer = () => {
    const value = pointerSize === 8 ? Number(view.getBigUint64(at)) : view.getUint32(at)
    at += pointerSize
    return value
  }
  const properties = (onProperty: (type: number, size: number, start: number) => void) => {
    for (let i = 0; i < PROPERTY_LIMIT; i++) {
      const type = u32()
      const size = u32()
      const start = at
      if (type === PROP_END) return
      onProperty(type, size, start)
      at = start + size
    }
  }

  const width = u32()
  const height = u32()
  u32()
  let precision = 150
  if (version >= 4) {
    const value = u32()
    precision = version >= 7 ? value : ({ 0: 150, 1: 200, 2: 300, 3: 500, 4: 600 }[value] ?? 150)
  }
  if (!width || !height || width > 524288 || height > 524288) throw new Error('This GIMP image has an unreadable size.')
  const componentBytes = COMPONENT_BYTES[precision] ?? 1
  const toByte = componentReader(componentBytes, precision >= 500, Math.floor(precision / 50) % 2 === 0)

  let compression = 0
  let colormap: Uint8Array | null = null
  properties((type, _size, start) => {
    if (type === PROP_COMPRESSION) compression = bytes[start]
    if (type === PROP_COLORMAP) colormap = bytes.slice(start + 4, start + 4 + view.getUint32(start) * 3)
  })
  if (compression > 2) throw new Error('This GIMP image uses a compression the browser cannot read.')

  const layerPointers: number[] = []
  for (let p = pointer(); p !== 0 && layerPointers.length < LAYER_LIMIT; p = pointer())
    if (!layerPointers.includes(p)) layerPointers.push(p)

  const layers: Layer[] = []
  for (const layerAt of layerPointers) {
    at = layerAt
    u32()
    u32()
    const layer: Layer = {
      type: u32(),
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      mode: 0,
      group: false,
      path: null,
      applyMask: false,
      hierarchy: 0,
      mask: 0,
      key: '',
    }
    const nameLength = u32()
    at += nameLength
    properties((type, size, start) => {
      if (type === PROP_OPACITY) layer.opacity = view.getUint32(start) / 255
      else if (type === PROP_FLOAT_OPACITY) layer.opacity = view.getFloat32(start)
      else if (type === PROP_VISIBLE) layer.visible = view.getUint32(start) !== 0
      else if (type === PROP_OFFSETS) {
        layer.x = view.getInt32(start)
        layer.y = view.getInt32(start + 4)
      } else if (type === PROP_MODE) layer.mode = view.getUint32(start)
      else if (type === PROP_GROUP_ITEM) layer.group = true
      else if (type === PROP_APPLY_MASK) layer.applyMask = view.getUint32(start) !== 0
      else if (type === PROP_ITEM_PATH)
        layer.path = Array.from({ length: Math.min(64, size / 4) }, (_, i) => view.getUint32(start + i * 4))
    })
    layer.hierarchy = pointer()
    layer.mask = pointer()
    layers.push(layer)
  }

  const byKey = new Map<string, Layer>()
  let topLevel = 0
  for (const layer of layers) {
    layer.key = (layer.path ?? [topLevel++]).join('/')
    byKey.set(layer.key, layer)
  }
  const effective = (layer: Layer) => {
    let { visible, opacity } = layer
    const path = layer.key.split('/')
    for (let i = path.length - 1; i > 0; i--) {
      const parent = byKey.get(path.slice(0, i).join('/'))
      if (parent) {
        visible &&= parent.visible
        opacity *= parent.opacity
      }
    }
    return { visible, opacity: Math.min(1, Math.max(0, opacity)) }
  }

  const tilesAt = (hierarchyAt: number): Tiles => {
    at = hierarchyAt
    const hierarchyWidth = u32()
    const hierarchyHeight = u32()
    const bpp = u32()
    if (bpp < 1 || bpp > 32) throw new Error('This GIMP image has an unreadable layer.')
    at = pointer()
    const levelWidth = u32()
    const levelHeight = u32()
    const columns = Math.ceil(levelWidth / TILE)
    const count = columns * Math.ceil(levelHeight / TILE)
    if (count > 4_000_000 || levelWidth > hierarchyWidth || levelHeight > hierarchyHeight)
      throw new Error('This GIMP image has an unreadable layer.')
    const pointers = Array.from({ length: count }, () => pointer())
    return { width: levelWidth, height: levelHeight, bpp, columns, pointers, end: pointer() }
  }

  const rect = (tiles: Tiles, i: number) => {
    const tx = (i % tiles.columns) * TILE
    const ty = Math.floor(i / tiles.columns) * TILE
    return { tx, ty, tw: Math.min(TILE, tiles.width - tx), th: Math.min(TILE, tiles.height - ty) }
  }

  const decode = (tiles: Tiles, i: number) => {
    const { tw, th } = rect(tiles, i)
    const size = tw * th * tiles.bpp
    const start = tiles.pointers[i]
    if (compression === 0) return bytes.subarray(start, start + size)
    if (compression === 1) return rleTile(bytes, start, tw * th, tiles.bpp)
    const next = i + 1 < tiles.pointers.length ? tiles.pointers[i + 1] : tiles.end
    return inflateTo(bytes.subarray(start, next > start ? next : bytes.length), size)
  }

  const { outWidth, outHeight } = outputSize(width, height, maxPixels)
  const xs = sampleGrid(width, outWidth)
  const ys = sampleGrid(height, outHeight)
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4)
  const range = (grid: Int32Array, from: number, to: number) => {
    let lo = 0
    let hi = grid.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (grid[mid] < from) lo = mid + 1
      else hi = mid
    }
    let end = lo
    while (end < grid.length && grid[end] < to) end++
    return [lo, end] as const
  }

  let blended = 0
  let work = 0
  let skipped = false
  for (let li = layers.length - 1; li >= 0; li--) {
    const layer = layers[li]
    if (layer.group) continue
    const { visible, opacity } = effective(layer)
    if (!visible || opacity <= 0) continue
    if (!NORMAL_MODES.has(layer.mode)) blended++
    const pixels = tilesAt(layer.hierarchy)
    let mask: Tiles | null = null
    if (layer.applyMask && layer.mask) {
      at = layer.mask
      u32()
      u32()
      const nameLength = u32()
      at += nameLength
      properties(() => undefined)
      mask = tilesAt(pointer())
      if (mask.pointers.length !== pixels.pointers.length) mask = null
    }
    const hasAlpha = layer.type % 2 === 1
    const indexed = layer.type >= 4
    const gray = layer.type === 2 || layer.type === 3
    const step = componentBytes
    const map = colormap as Uint8Array | null

    const wanted = pixels.pointers.flatMap((_, i) => {
      const { tx, ty, tw, th } = rect(pixels, i)
      const [x0, x1] = range(xs, tx + layer.x, tx + layer.x + tw)
      const [y0, y1] = range(ys, ty + layer.y, ty + layer.y + th)
      return x0 < x1 && y0 < y1 ? [{ i, tx, ty, tw, x0, x1, y0, y1 }] : []
    })
    work += wanted.reduce((sum, t) => sum + (t.x1 - t.x0) * (t.y1 - t.y0), pixels.pointers.length)
    if (work > outWidth * outHeight * WORK_PER_PIXEL) {
      skipped = true
      break
    }
    for (let batch = 0; batch < wanted.length; batch += TILE_BATCH) {
      const slice = wanted.slice(batch, batch + TILE_BATCH)
      const decoded = await Promise.all(
        slice.map((t) => Promise.all([decode(pixels, t.i), mask ? decode(mask, t.i) : null])),
      )
      slice.forEach(({ tx, ty, tw, x0, x1, y0, y1 }, k) => {
        const [data, maskData] = decoded[k]
        for (let oy = y0; oy < y1; oy++) {
          const ly = ys[oy] - layer.y - ty
          for (let ox = x0; ox < x1; ox++) {
            const lx = xs[ox] - layer.x - tx
            const p = (ly * tw + lx) * pixels.bpp
            let r: number, g: number, b: number, a: number
            if (indexed) {
              const index = data[p] ?? 0
              r = map?.[index * 3] ?? 0
              g = map?.[index * 3 + 1] ?? 0
              b = map?.[index * 3 + 2] ?? 0
              a = hasAlpha ? (data[p + 1] ?? 0) : 255
            } else if (gray) {
              r = g = b = toByte(data, p, false)
              a = hasAlpha ? toByte(data, p + step, true) : 255
            } else {
              r = toByte(data, p, false)
              g = toByte(data, p + step, false)
              b = toByte(data, p + 2 * step, false)
              a = hasAlpha ? toByte(data, p + 3 * step, true) : 255
            }
            let alpha = (a / 255) * opacity
            if (maskData) alpha *= toByte(maskData, (ly * tw + lx) * mask!.bpp, true) / 255
            if (!(alpha > 0)) continue
            const o = (oy * outWidth + ox) * 4
            const below = rgba[o + 3] / 255
            const out = alpha + below * (1 - alpha)
            rgba[o] = (r * alpha + rgba[o] * below * (1 - alpha)) / out
            rgba[o + 1] = (g * alpha + rgba[o + 1] * below * (1 - alpha)) / out
            rgba[o + 2] = (b * alpha + rgba[o + 2] * below * (1 - alpha)) / out
            rgba[o + 3] = out * 255
          }
        }
      })
    }
  }

  return {
    width,
    height,
    outWidth,
    outHeight,
    rgba,
    thumbnail: null,
    note:
      [
        blended > 0 ? 'Layer blend modes are drawn as Normal, so colours may differ from GIMP.' : '',
        skipped ? 'Some layers were left out because the image is too complex to flatten in the browser.' : '',
      ]
        .filter(Boolean)
        .join(' ') || null,
  }
}

function rleTile(bytes: Uint8Array, start: number, pixels: number, bpp: number) {
  const out = new Uint8Array(pixels * bpp)
  let i = start
  for (let channel = 0; channel < bpp; channel++) {
    let written = 0
    while (written < pixels && i < bytes.length) {
      const n = bytes[i++]
      if (n >= 128) {
        let count = 256 - n
        if (n === 128) {
          count = (bytes[i] << 8) | bytes[i + 1]
          i += 2
        }
        for (let k = 0; k < count && written < pixels; k++) out[written++ * bpp + channel] = bytes[i++]
      } else {
        let count = n + 1
        if (n === 127) {
          count = (bytes[i] << 8) | bytes[i + 1]
          i += 2
        }
        const value = bytes[i++]
        for (let k = 0; k < count && written < pixels; k++) out[written++ * bpp + channel] = value
      }
    }
  }
  return out
}

function componentReader(size: number, isFloat: boolean, linear: boolean) {
  const scratch = new DataView(new ArrayBuffer(8))
  const value = (data: Uint8Array, p: number) => {
    if (size === 1) return (data[p] ?? 0) / 255
    if (!isFloat && size === 2) return (((data[p] ?? 0) << 8) | (data[p + 1] ?? 0)) / 65535
    for (let k = 0; k < size; k++) scratch.setUint8(k, data[p + k] ?? 0)
    if (!isFloat) return scratch.getUint32(0) / 4294967295
    if (size === 2) return halfToFloat(scratch.getUint16(0))
    if (size === 4) return scratch.getFloat32(0)
    return scratch.getFloat64(0)
  }
  return (data: Uint8Array, p: number, isAlpha: boolean) => {
    const v = Math.min(1, Math.max(0, value(data, p) || 0))
    if (isAlpha || !linear) return v * 255
    return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
  }
}

function halfToFloat(h: number) {
  const sign = h & 0x8000 ? -1 : 1
  const exponent = (h >> 10) & 0x1f
  const fraction = h & 0x3ff
  if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024)
  if (exponent === 31) return fraction ? NaN : sign * Infinity
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024)
}
