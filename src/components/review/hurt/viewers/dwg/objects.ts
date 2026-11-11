import type { Vec } from '../brep/types'
import { DwgError, type DwgFile } from './file'

const INSERT = 7
const SOLID = 38
const BODY = 39
const BLOCK_HEADER = 49
const MODEL_SPACE = 2
const MAX_DEPTH = 16
const MAX_PLACEMENTS = 10_000
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
const scratch = new DataView(new ArrayBuffer(8))

class Bits {
  constructor(
    private readonly bytes: Uint8Array,
    private bit: number,
  ) {}

  read(count: number) {
    let value = 0
    for (let i = 0; i < count; i++, this.bit++) {
      const byte = this.bytes[this.bit >> 3]
      if (byte === undefined) throw new DwgError('An object in this drawing ends early.')
      value = value * 2 + ((byte >> (7 - (this.bit & 7))) & 1)
    }
    return value
  }

  skip(bytes: number) {
    this.bit += bytes * 8
  }

  flag() {
    return this.read(1) === 1
  }

  byte() {
    return this.read(8)
  }

  short() {
    const code = this.read(2)
    return code === 0 ? this.byte() | (this.byte() << 8) : code === 1 ? this.byte() : code === 2 ? 0 : 256
  }

  long() {
    const code = this.read(2)
    if (code === 1) return this.byte()
    if (code !== 0) return 0
    let value = 0
    for (let i = 0; i < 4; i++) value += this.byte() * 2 ** (8 * i)
    return value
  }

  longLong() {
    let value = 0
    for (let i = 0, count = this.read(3); i < count; i++) value += this.byte() * 2 ** (8 * i)
    return value
  }

  raw() {
    for (let i = 0; i < 8; i++) scratch.setUint8(i, this.byte())
    return scratch.getFloat64(0, true)
  }

  double() {
    const code = this.read(2)
    return code === 0 ? this.raw() : code === 1 ? 1 : 0
  }

  fallback(value: number) {
    const code = this.read(2)
    if (code === 0) return value
    if (code === 3) return this.raw()
    scratch.setFloat64(0, value, true)
    if (code === 2) for (const i of [4, 5]) scratch.setUint8(i, this.byte())
    for (let i = 0; i < 4; i++) scratch.setUint8(i, this.byte())
    return scratch.getFloat64(0, true)
  }

  point(): Vec {
    return [this.double(), this.double(), this.double()]
  }

  handle(from: number) {
    const code = this.read(4)
    let value = 0
    for (let i = 0, count = this.read(4); i < count; i++) value = value * 256 + this.byte()
    if (code <= 5) return value
    if (code === 6) return from + 1
    if (code === 8) return from - 1
    if (code === 10) return from + value
    if (code === 12) return from - value
    throw new DwgError('An object in this drawing has a damaged reference.')
  }
}

interface Entity {
  owner: number | null
  data: Bits
  handles: Bits
}

function modular(bytes: Uint8Array, at: number, signed: boolean): [number, number] {
  let [value, scale] = [0, 1]
  while (at < bytes.length) {
    const byte = bytes[at++]
    if (byte & 0x80) value += (byte & 0x7f) * scale
    else if (!signed) return [value + byte * scale, at]
    else {
      value += (byte & 0x3f) * scale
      return [byte & 0x40 ? -value : value, at]
    }
    scale *= 128
  }
  throw new DwgError("This drawing's object map ends early.")
}

export function compose(a: number[], b: number[]) {
  const out: number[] = []
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 3; row++)
      out.push(
        a[row] * b[column * 3] +
          a[3 + row] * b[column * 3 + 1] +
          a[6 + row] * b[column * 3 + 2] +
          (column === 3 ? a[9 + row] : 0),
      )
  return out
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function unit(v: Vec): Vec {
  const length = Math.hypot(...v)
  return [v[0] / length, v[1] / length, v[2] / length]
}

function objectSpace(extrusion: Vec) {
  if (!(Math.hypot(...extrusion) > 0)) return IDENTITY
  const z = unit(extrusion)
  const x = unit(cross(Math.abs(z[0]) < 1 / 64 && Math.abs(z[1]) < 1 / 64 ? [0, 1, 0] : [0, 0, 1], z))
  return [...x, ...cross(z, x), ...z, 0, 0, 0]
}

export class DwgObjects {
  private readonly offsets = new Map<number, number>()
  private readonly objects: Uint8Array

  constructor(file: DwgFile) {
    const map = file.section('AcDb:Handles')
    const objects = file.section('AcDb:AcDbObjects')
    if (!map || !objects) throw new DwgError('This drawing has no object map.')
    this.objects = objects
    for (let at = 0; at + 2 <= map.length; ) {
      const size = (map[at] << 8) | map[at + 1]
      if (size <= 2) break
      const end = Math.min(at + size, map.length)
      let [handle, offset, i] = [0, 0, at + 2]
      while (i < end) {
        const [step, next] = modular(map, i, false)
        const [delta, after] = modular(map, next, true)
        ;[handle, offset, i] = [handle + step, offset + delta, after]
        this.offsets.set(handle, offset)
      }
      at = end + 2
    }
  }

  solidPlacements() {
    const placements = new Map<number, number[][]>()
    const owned = new Map<number, number[]>()
    const inserts = new Set<number>()
    const roots: number[] = []
    for (const handle of this.offsets.keys()) {
      const type = this.type(handle)
      if (type !== INSERT && type !== SOLID && type !== BODY) continue
      if (type === INSERT) inserts.add(handle)
      const { owner } = this.entity(handle)
      if (owner === null) roots.push(handle)
      else if (owned.has(owner)) owned.get(owner)!.push(handle)
      else owned.set(owner, [handle])
    }
    let count = 0
    const visit = (handle: number, matrix: number[], depth: number) => {
      if (!inserts.has(handle)) {
        if (placements.has(handle)) placements.get(handle)!.push(matrix)
        else placements.set(handle, [matrix])
        count++
        return
      }
      if (depth >= MAX_DEPTH) return
      const { block, transform } = this.insert(this.entity(handle), handle)
      for (const child of owned.get(block) ?? []) {
        if (count >= MAX_PLACEMENTS) return
        visit(child, compose(matrix, transform), depth + 1)
      }
    }
    for (const root of roots) visit(root, IDENTITY, 0)
    return placements
  }

  private start(handle: number) {
    const at = this.offsets.get(handle)
    if (at === undefined) return null
    let [size, scale, i] = [0, 1, at]
    for (;;) {
      const word = this.objects[i] | (this.objects[i + 1] << 8)
      i += 2
      size += (word & 0x7fff) * scale
      scale *= 0x8000
      if (!(word & 0x8000) || i >= this.objects.length) break
    }
    const [handleBits, data] = modular(this.objects, i, false)
    return { data: new Bits(this.objects, data * 8), handles: new Bits(this.objects, data * 8 + size * 8 - handleBits) }
  }

  private type(handle: number) {
    const data = this.start(handle)?.data
    return data ? this.typeAt(data) : null
  }

  private typeAt(data: Bits) {
    const code = data.read(2)
    return code === 0 ? data.byte() : code === 1 ? data.byte() + 0x1f0 : data.byte() | (data.byte() << 8)
  }

  private common(data: Bits) {
    const self = data.handle(0)
    for (let size = data.short(); size > 0; size = data.short()) {
      data.handle(self)
      data.skip(size)
    }
    return self
  }

  private entity(handle: number): Entity {
    const start = this.start(handle)
    if (!start) throw new DwgError('This drawing refers to an object it does not contain.')
    const { data, handles } = start
    this.typeAt(data)
    this.common(data)
    if (data.flag()) data.skip(data.longLong())
    const mode = data.read(2)
    const reactors = data.long()
    const noDictionary = data.flag()
    data.flag()
    const colour = data.short() >> 8
    if (!(colour & 0x40) && colour & 0x80) data.long()
    if (colour & 0x20) data.long()
    data.double()
    const [lineType, material, plotStyle] = [data.read(2), data.read(2), data.read(2)]
    const shadow = data.byte()
    const styles = [data.flag(), data.flag(), data.flag()].filter(Boolean).length
    data.short()
    data.byte()
    if (colour & 0x40) handles.handle(handle)
    const owner = mode === 0 ? handles.handle(handle) : null
    const referenced =
      reactors +
      Number(!noDictionary) +
      1 +
      Number(lineType === 3) +
      Number(material === 3) +
      Number(shadow === 3) +
      Number(plotStyle === 3) +
      styles
    for (let i = 0; i < referenced; i++) handles.handle(handle)
    return { owner: mode === MODEL_SPACE ? null : (owner ?? -1), data, handles }
  }

  private insert({ data, handles }: Entity, handle: number) {
    const at = data.point()
    const mode = data.read(2)
    let scale: Vec = [1, 1, 1]
    if (mode === 0) {
      const x = data.raw()
      scale = [x, data.fallback(x), data.fallback(x)]
    } else if (mode === 1) scale = [1, data.fallback(1), data.fallback(1)]
    else if (mode === 2) scale = Array(3).fill(data.raw()) as Vec
    const angle = data.double()
    const extrusion = data.point()
    const block = handles.handle(handle)
    const base = this.basePoint(block)
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
    const linear = [cos * scale[0], sin * scale[0], 0, -sin * scale[1], cos * scale[1], 0, 0, 0, scale[2]]
    const shift = [0, 1, 2].map(
      (row) => at[row] - linear[row] * base[0] - linear[3 + row] * base[1] - linear[6 + row] * base[2],
    )
    return { block, transform: compose(objectSpace(extrusion), [...linear, ...shift]) }
  }

  private basePoint(block: number): Vec {
    const start = this.start(block)
    if (!start || this.typeAt(start.data) !== BLOCK_HEADER) return [0, 0, 0]
    const { data } = start
    this.common(data)
    data.long()
    data.flag()
    data.flag()
    data.short()
    data.read(2)
    const xref = data.read(2)
    data.flag()
    if (!xref) data.long()
    return data.point()
  }
}
