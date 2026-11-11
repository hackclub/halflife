import { inflateTo } from './inflate'

export interface Flattened {
  width: number
  height: number
  outWidth: number
  outHeight: number
  rgba: Uint8ClampedArray<ArrayBuffer> | null
  thumbnail: Uint8Array | null
  note: string | null
}

const BITMAP = 0
const INDEXED = 2
const RGB = 3
const CMYK = 4
const SIGNATURE = 0x3842494d
const MAX_SIDE = 300_000
const MAX_OUTPUT_SIDE = 16_384

export function outputSize(width: number, height: number, maxPixels: number) {
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)), MAX_OUTPUT_SIDE / width, MAX_OUTPUT_SIDE / height)
  return { outWidth: Math.max(1, Math.floor(width * scale)), outHeight: Math.max(1, Math.floor(height * scale)) }
}

export function sampleGrid(size: number, out: number) {
  const grid = new Int32Array(out)
  for (let i = 0; i < out; i++) grid[i] = Math.min(size - 1, Math.floor(((i + 0.5) * size) / out))
  return grid
}

export async function readPsd(buffer: ArrayBuffer, maxPixels: number): Promise<Flattened> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const big = view.getUint16(4) === 2
  const channels = view.getUint16(12)
  const height = view.getUint32(14)
  const width = view.getUint32(18)
  const depth = view.getUint16(22)
  const mode = view.getUint16(24)
  if (!width || !height || channels < 1 || channels > 56 || ![1, 8, 16, 32].includes(depth))
    throw new Error('This Photoshop file has an unreadable header.')
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > 1e9)
    throw new Error('This image is too large to open in the browser.')

  let at = 26
  const paletteLength = view.getUint32(at)
  const palette = bytes.subarray(at + 4, at + 4 + paletteLength)
  at += 4 + paletteLength

  const resourcesEnd = at + 4 + view.getUint32(at)
  let thumbnail: Uint8Array | null = null
  for (let r = at + 4; r + 12 <= Math.min(resourcesEnd, bytes.length); ) {
    if (view.getUint32(r) !== SIGNATURE) break
    const id = view.getUint16(r + 4)
    const p = r + 6 + ((bytes[r + 6] + 2) & ~1)
    if (p + 4 > bytes.length) break
    const size = view.getUint32(p)
    if ((id === 1036 || id === 1033) && size > 28 && view.getUint32(p + 4) === 1)
      thumbnail = bytes.slice(p + 4 + 28, p + 4 + size)
    r = p + 4 + size + (size & 1)
  }
  at = resourcesEnd

  const layersLength = big ? Number(view.getBigUint64(at)) : view.getUint32(at)
  const layersStart = at + (big ? 8 : 4)
  let layerCount = 0
  if (layersLength > 0 && layersStart + 10 <= bytes.length) {
    const infoLength = big ? Number(view.getBigUint64(layersStart)) : view.getUint32(layersStart)
    if (infoLength > 0) layerCount = view.getInt16(layersStart + (big ? 8 : 4))
  }
  at = layersStart + layersLength

  const { outWidth, outHeight } = outputSize(width, height, maxPixels)
  const meta = { width, height, outWidth, outHeight, thumbnail }
  if (at + 2 > bytes.length) return { ...meta, rgba: null, note: 'The file ends before its flattened image.' }
  const compression = view.getUint16(at)
  at += 2

  const sampleBytes = depth === 1 ? 1 : depth / 8
  const rowBytes = depth === 1 ? Math.ceil(width / 8) : width * sampleBytes
  const planeBytes = rowBytes * height
  const colorChannels = mode === CMYK ? 4 : mode === RGB ? 3 : 1
  const alpha = layerCount < 0 && mode !== INDEXED && mode !== BITMAP && channels > colorChannels
  const used = Math.min(channels, colorChannels + (alpha ? 1 : 0))
  if (used < colorChannels) throw new Error('This Photoshop file is missing colour channels.')

  let row: (channel: number, y: number) => Uint8Array
  if (compression === 0) {
    row = (channel, y) => {
      const from = at + channel * planeBytes + y * rowBytes
      return bytes.subarray(from, from + rowBytes)
    }
  } else if (compression === 1) {
    const countSize = big ? 4 : 2
    const starts = new Float64Array(channels * height + 1)
    starts[0] = at + channels * height * countSize
    for (let i = 0; i < channels * height; i++) {
      const p = at + i * countSize
      starts[i + 1] = starts[i] + (p + countSize > bytes.length ? 0 : big ? view.getUint32(p) : view.getUint16(p))
    }
    const scratch = new Uint8Array(rowBytes)
    row = (channel, y) => {
      const i = channel * height + y
      scratch.fill(0)
      unpackBits(bytes, starts[i], Math.min(starts[i + 1], bytes.length), scratch)
      return scratch
    }
  } else if (compression === 2 || compression === 3) {
    if (planeBytes * used > 512 * 1024 * 1024) throw new Error('This image is too large to open in the browser.')
    const raw = await inflateTo(bytes.subarray(at), planeBytes * used)
    if (compression === 3) for (let c = 0; c < used; c++) unpredict(raw, c * planeBytes, rowBytes, height, sampleBytes)
    row = (channel, y) => raw.subarray(channel * planeBytes + y * rowBytes, channel * planeBytes + (y + 1) * rowBytes)
  } else {
    return { ...meta, rgba: null, note: 'This Photoshop file uses an unknown compression.' }
  }

  const xs = sampleGrid(width, outWidth)
  const ys = sampleGrid(height, outHeight)
  const rgba = new Uint8ClampedArray(outWidth * outHeight * 4)
  const lines = Array.from({ length: used }, () => new Uint8Array(outWidth))
  for (let oy = 0; oy < outHeight; oy++) {
    for (let c = 0; c < used; c++) {
      const source = row(c, ys[oy])
      const line = lines[c]
      for (let ox = 0; ox < outWidth; ox++) line[ox] = sample(source, xs[ox], depth)
    }
    for (let ox = 0, o = oy * outWidth * 4; ox < outWidth; ox++, o += 4) {
      if (mode === BITMAP) {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = lines[0][ox] ? 0 : 255
      } else if (mode === INDEXED) {
        const index = lines[0][ox]
        rgba[o] = palette[index] ?? 0
        rgba[o + 1] = palette[256 + index] ?? 0
        rgba[o + 2] = palette[512 + index] ?? 0
      } else if (mode === RGB) {
        rgba[o] = lines[0][ox]
        rgba[o + 1] = lines[1][ox]
        rgba[o + 2] = lines[2][ox]
      } else if (mode === CMYK) {
        const k = 255 - lines[3][ox]
        rgba[o] = 255 - Math.min(255, 255 - lines[0][ox] + k)
        rgba[o + 1] = 255 - Math.min(255, 255 - lines[1][ox] + k)
        rgba[o + 2] = 255 - Math.min(255, 255 - lines[2][ox] + k)
      } else {
        rgba[o] = rgba[o + 1] = rgba[o + 2] = lines[0][ox]
      }
      rgba[o + 3] = alpha ? lines[colorChannels][ox] : 255
    }
  }

  const blank = layerCount !== 0 && isBlank(rgba)
  if (blank && thumbnail)
    return { ...meta, rgba: null, note: 'Saved without a flattened image, so this is its small preview.' }
  return { ...meta, rgba, note: blank ? 'Saved without a flattened image.' : null }
}

function sample(source: Uint8Array, x: number, depth: number) {
  if (depth === 1) return (source[x >> 3] >> (7 - (x & 7))) & 1
  if (depth === 8) return source[x] ?? 0
  if (depth === 16) return source[x * 2] ?? 0
  const p = x * 4
  if (p + 4 > source.length) return 0
  const value = new DataView(source.buffer, source.byteOffset + p, 4).getFloat32(0)
  return Math.round(Math.pow(Math.min(1, Math.max(0, value || 0)), 1 / 2.2) * 255)
}

function isBlank(rgba: Uint8ClampedArray) {
  for (let i = 4; i < rgba.length; i += 4 * 97)
    if (rgba[i] !== rgba[0] || rgba[i + 1] !== rgba[1] || rgba[i + 2] !== rgba[2] || rgba[i + 3] !== rgba[3])
      return false
  return true
}

function unpackBits(src: Uint8Array, from: number, to: number, dest: Uint8Array) {
  let o = 0
  for (let i = from; i < to && o < dest.length; ) {
    const n = (src[i++] << 24) >> 24
    if (n >= 0) {
      const count = Math.min(n + 1, dest.length - o, to - i)
      dest.set(src.subarray(i, i + count), o)
      i += n + 1
      o += count
    } else if (n !== -128) {
      const count = Math.min(1 - n, dest.length - o)
      dest.fill(src[i++], o, o + count)
      o += count
    }
  }
}

function unpredict(data: Uint8Array, start: number, rowBytes: number, rows: number, sampleBytes: number) {
  for (let y = 0; y < rows; y++) {
    const r = start + y * rowBytes
    if (r + rowBytes > data.length) return
    if (sampleBytes === 1) {
      for (let x = 1; x < rowBytes; x++) data[r + x] = (data[r + x] + data[r + x - 1]) & 0xff
    } else if (sampleBytes === 2) {
      for (let x = 2; x < rowBytes; x += 2) {
        const value = (((data[r + x] << 8) | data[r + x + 1]) + ((data[r + x - 2] << 8) | data[r + x - 1])) & 0xffff
        data[r + x] = value >> 8
        data[r + x + 1] = value & 0xff
      }
    } else if (sampleBytes === 4) {
      for (let x = 1; x < rowBytes; x++) data[r + x] = (data[r + x] + data[r + x - 1]) & 0xff
      const width = rowBytes / 4
      const copy = data.slice(r, r + rowBytes)
      for (let x = 0; x < width; x++) for (let b = 0; b < 4; b++) data[r + x * 4 + b] = copy[b * width + x]
    }
  }
}
