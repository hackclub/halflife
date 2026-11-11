import { lzmaDecode } from './lzma'

const MAGIC = [0x89, 0x55, 0x44, 0x50, 0x4d, 0x45, 0x53, 0x48]
const FIRST_BLOCK = 0x30
const CHANNELS = 3
const STORED = 0xfe
const MAX_ITEMS = 64
const MAX_SIZE = 512 * 1024 * 1024

export interface MeshData {
  positions: Float32Array
  indices: Uint32Array
}

export class ParaMeshError extends Error {}

type Value = number | boolean | string | null | Value[] | { [key: string]: Value }

function unpack(bytes: Uint8Array, view: DataView, at: number): [Value, number] {
  const c = bytes[at]
  if (c === undefined) throw new ParaMeshError('This mesh header ends early.')
  if (c <= 0x7f) return [c, at + 1]
  if (c >= 0xe0) return [c - 256, at + 1]
  if ((c & 0xf0) === 0x80 || (c & 0xf0) === 0x90) {
    const count = c & 0x0f
    const list: Value[] = []
    let next = at + 1
    for (let i = 0; i < count * (c < 0x90 ? 2 : 1); i++) [list[i], next] = unpack(bytes, view, next)
    if (c >= 0x90) return [list, next]
    const map: Record<string, Value> = {}
    for (let i = 0; i < count; i++) map[String(list[i * 2])] = list[i * 2 + 1]
    return [map, next]
  }
  if ((c & 0xe0) === 0xa0)
    return [new TextDecoder().decode(bytes.subarray(at + 1, at + 1 + (c & 0x1f))), at + 1 + (c & 0x1f)]
  switch (c) {
    case 0xc0:
      return [null, at + 1]
    case 0xc2:
      return [false, at + 1]
    case 0xc3:
      return [true, at + 1]
    case 0xcc:
      return [view.getUint8(at + 1), at + 2]
    case 0xcd:
      return [view.getUint16(at + 1), at + 3]
    case 0xce:
      return [view.getUint32(at + 1), at + 5]
    case 0xd0:
      return [view.getInt8(at + 1), at + 2]
    case 0xd1:
      return [view.getInt16(at + 1), at + 3]
    case 0xd2:
      return [view.getInt32(at + 1), at + 5]
    case 0xca:
      return [view.getFloat32(at + 1), at + 5]
    case 0xcb:
      return [view.getFloat64(at + 1), at + 9]
  }
  throw new ParaMeshError('This mesh header uses an unknown value type.')
}

function header(bytes: Uint8Array, view: DataView, at: number) {
  const length = view.getUint16(at, true)
  const [value] = unpack(bytes, view, at + 2)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ParaMeshError('This mesh header is not a map.')
  return { value: value as Record<string, Value>, next: at + 2 + length }
}

function array(bytes: Uint8Array, view: DataView, at: number) {
  const { next } = header(bytes, view, at)
  const size = view.getUint32(next, true)
  if (size > MAX_SIZE) throw new ParaMeshError('This mesh is too large to open.')
  if (bytes[next + 5] === STORED) return bytes.slice(next + 6, next + 6 + size)
  return lzmaDecode(bytes, next + 6, bytes[next + 4], size)
}

function channel(bytes: Uint8Array, view: DataView, at: number) {
  const { value, next } = header(bytes, view, at)
  if (!value.I) return [array(bytes, view, at)]
  const sizes = Array.isArray(value.S) ? value.S : []
  const parts: Uint8Array[] = []
  let start = next
  for (const size of sizes.slice(0, MAX_ITEMS)) {
    parts.push(array(bytes, view, start))
    start += Number(size)
  }
  return parts
}

function floats(part: Uint8Array) {
  return new Float32Array(part.buffer, part.byteOffset, part.byteLength >>> 2)
}

export function isParaMesh(bytes: Uint8Array) {
  return MAGIC.every((b, i) => bytes[i] === b)
}

export function readParaMesh(bytes: Uint8Array): MeshData {
  if (!isParaMesh(bytes)) throw new ParaMeshError('This is not a Fusion mesh.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const blocks: { tag: number; start: number }[] = []
  for (let at = FIRST_BLOCK; at + 12 <= bytes.length && blocks.length < MAX_ITEMS; ) {
    const length = view.getUint32(at, true)
    if (view.getUint32(at + 4, true) !== 0 || at + 12 + length > bytes.length) break
    blocks.push({ tag: view.getUint32(at + 8, true), start: at + 12 })
    at += 12 + length
  }
  const map = blocks[1]?.tag === CHANNELS ? unpack(bytes, view, blocks[1].start)[0] : null
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new ParaMeshError('This mesh has no channel map.')
  const vertices = blocks[Number(map.v)]
  const triangles = blocks[Number(map.t)]
  if (!vertices || !triangles) throw new ParaMeshError('This mesh has no vertices or triangles.')

  const parts = channel(bytes, view, vertices.start).map(floats)
  const count = parts.length === 1 ? Math.floor(parts[0].length / 3) : Math.min(...parts.map((p) => p.length))
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++)
    for (let k = 0; k < 3; k++) positions[i * 3 + k] = parts.length === 1 ? parts[0][i * 3 + k] : parts[k][i]

  const raw = channel(bytes, view, triangles.start)[0]
  const deltas = new Int32Array(raw.buffer, raw.byteOffset, raw.byteLength >>> 2)
  const corners = deltas.length - (deltas.length % 3)
  const indices = new Uint32Array(corners)
  if (count === 0 || corners === 0) return { positions, indices }
  let index = 0
  for (let i = 0; i < deltas.length - 1; i++) index -= deltas[i]
  for (let i = 0; i < corners; i++) {
    index = (((index + deltas[(i + deltas.length - 1) % deltas.length]) % count) + count) % count
    indices[i] = index
  }
  return { positions, indices }
}
