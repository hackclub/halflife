import { Decompress } from 'fzstd'
import { inflate, Sink } from '../../core/archive'
import type { ModelPreview } from '../model/analyze'

export interface Field {
  type: string
  pointer: boolean
  count: number
  elem: number
  offset: number
  size: number
}

export interface StructDef {
  name: string
  size: number
  fields: Map<string, Field>
}

export interface Block {
  index: number
  code: string
  len: number
  old: bigint
  sdna: number
  nr: number
  start: number
  owner: number
}

export interface Header {
  size: number
  pointerSize: 4 | 8
  little: boolean
  version: number
  wide: boolean
}

const CHUNK = 1 << 20
const SEEKABLE_MAGIC = 0x8f92eab1
const MAX_RATIO = 64
const MAX_THUMBNAIL = 1024
const MAX_FLOATS = 16
const NON_ID_CODES = new Set(['DATA', 'TEST', 'DNA1', 'ENDB', 'REND', 'GLOB', 'USER'])
const latin1 = new TextDecoder('latin1')
const utf8 = new TextDecoder()

export async function unpack(bytes: Uint8Array, limit: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const capped = (data: Uint8Array, compression: string) => ({
    data: data.subarray(0, limit),
    compression,
    truncated: data.length > limit,
  })
  const plausible = (size: number) => (size <= bytes.length * MAX_RATIO ? size : 0)
  if (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd) {
    const sink = new Sink(limit + 1, plausible(seekableSize(view)))
    let open = true
    const stream = new Decompress((chunk) => {
      if (open) open = sink.push(chunk)
    })
    for (let offset = 0; offset < bytes.length && open; offset += CHUNK)
      stream.push(bytes.subarray(offset, offset + CHUNK), offset + CHUNK >= bytes.length)
    return capped(sink.data(), 'zstd')
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const size = bytes.length >= 18 ? view.getUint32(bytes.length - 4, true) : 0
    return capped(await inflate(bytes, 'gzip', limit + 1, plausible(size)), 'gzip')
  }
  return capped(bytes, 'none')
}

function seekableSize(view: DataView) {
  const end = view.byteLength
  if (end < 17 || view.getUint32(end - 4, true) !== SEEKABLE_MAGIC) return 0
  const frames = view.getUint32(end - 9, true)
  const entry = view.getUint8(end - 5) & 0x80 ? 12 : 8
  const start = end - 9 - frames * entry
  if (frames === 0 || start < 0) return 0
  let total = 0
  for (let i = 0; i < frames; i++) total += view.getUint32(start + i * entry + 4, true)
  return total
}

export function parseHeader(data: Uint8Array): Header {
  const head = latin1.decode(data.subarray(0, 17))
  const classic = head.match(/^BLENDER([-_])([vV])(\d{3})/)
  if (classic)
    return {
      size: 12,
      pointerSize: classic[1] === '-' ? 8 : 4,
      little: classic[2] === 'v',
      version: Number(classic[3]),
      wide: false,
    }
  const modern = head.match(/^BLENDER(\d\d)([-_])(\d\d)([vV])(\d{4})/)
  if (!modern || Number(modern[3]) !== 1) throw new Error('This is not a Blender file the browser can read.')
  return {
    size: Number(modern[1]),
    pointerSize: modern[2] === '-' ? 8 : 4,
    little: modern[4] === 'v',
    version: Number(modern[5]),
    wide: true,
  }
}

function readBlocks(data: Uint8Array, header: Header, lenient: boolean) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const { little, pointerSize, wide } = header
  const headSize = wide ? 32 : 16 + pointerSize
  const blocks: Block[] = []
  let owner = -1
  let p = header.size
  while (p + headSize <= data.length) {
    const code = latin1.decode(data.subarray(p, p + 4)).replace(/\0+$/, '')
    let len: number, old: bigint, sdna: number, nr: number
    if (wide) {
      sdna = view.getInt32(p + 4, little)
      old = view.getBigUint64(p + 8, little)
      len = Number(view.getBigInt64(p + 16, little))
      nr = Number(view.getBigInt64(p + 24, little))
    } else {
      len = view.getInt32(p + 4, little)
      old = pointerSize === 8 ? view.getBigUint64(p + 8, little) : BigInt(view.getUint32(p + 8, little))
      sdna = view.getInt32(p + 8 + pointerSize, little)
      nr = view.getInt32(p + 12 + pointerSize, little)
    }
    const start = p + headSize
    if (code === 'ENDB') break
    if (len < 0 || nr < 0 || start + len > data.length) {
      if (lenient) break
      throw new Error('This .blend file is cut short or damaged.')
    }
    if (!NON_ID_CODES.has(code)) owner = blocks.length
    blocks.push({ index: blocks.length, code, len, old, sdna, nr, start, owner })
    p = start + len
  }
  return blocks
}

function parseSdna(data: Uint8Array, block: Block, header: Header) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const end = block.start + block.len
  let p = block.start
  const need = (bytes: number) => {
    if (p + bytes > end) throw new Error('The structure table in this .blend file is damaged.')
  }
  const int = () => {
    need(4)
    const value = view.getInt32(p, header.little)
    p += 4
    return value
  }
  const tag = (expected: string) => {
    need(4)
    if (latin1.decode(data.subarray(p, p + 4)) !== expected)
      throw new Error('The structure table in this .blend file is damaged.')
    p += 4
  }
  const align = () => (p = block.start + ((p - block.start + 3) & ~3))
  const strings = (count: number) => {
    if (count < 0 || count > 1e6) throw new Error('The structure table in this .blend file is damaged.')
    const out: string[] = []
    for (let i = 0; i < count; i++) {
      const stop = data.indexOf(0, p)
      if (stop < 0 || stop >= end) throw new Error('The structure table in this .blend file is damaged.')
      out.push(latin1.decode(data.subarray(p, stop)))
      p = stop + 1
    }
    return out
  }

  tag('SDNA')
  tag('NAME')
  const names = strings(int())
  align()
  tag('TYPE')
  const types = strings(int())
  align()
  tag('TLEN')
  need(types.length * 2)
  const lengths = types.map((_, i) => view.getInt16(p + i * 2, header.little))
  p += types.length * 2
  align()
  tag('STRC')
  const count = int()
  if (count < 0 || count > 1e5) throw new Error('The structure table in this .blend file is damaged.')
  const structs: StructDef[] = []
  for (let i = 0; i < count; i++) {
    need(4)
    const type = view.getInt16(p, header.little)
    const total = view.getInt16(p + 2, header.little)
    p += 4
    need(total * 4)
    const fields = new Map<string, Field>()
    let offset = 0
    for (let f = 0; f < total; f++) {
      const fieldType = view.getInt16(p, header.little)
      const raw = names[view.getInt16(p + 2, header.little)] ?? ''
      p += 4
      const pointer = raw.startsWith('*') || raw.startsWith('(*')
      let items = 1
      for (const m of raw.matchAll(/\[(\d+)\]/g)) items *= Number(m[1])
      const elem = pointer ? header.pointerSize : Math.max(0, lengths[fieldType] ?? 0)
      const name = raw
        .replace(/^\(?\**/, '')
        .replace(/\)\(.*$/, '')
        .replace(/\[.*$/, '')
      fields.set(name, { type: types[fieldType] ?? '', pointer, count: items, elem, offset, size: elem * items })
      offset += elem * items
    }
    structs.push({ name: types[type] ?? '', size: Math.max(0, lengths[type] ?? 0), fields })
  }
  return structs
}

export class Blend {
  readonly view: DataView
  readonly blocks: Block[]
  readonly structs: StructDef[] = []
  readonly byName = new Map<string, StructDef>()
  readonly #addresses = new Map<bigint, Block[]>()

  constructor(
    readonly data: Uint8Array,
    readonly header: Header,
    readonly compression: string,
    readonly truncated: boolean,
  ) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    this.blocks = readBlocks(data, header, truncated)
    const dna = this.blocks.find((b) => b.code === 'DNA1')
    if (!dna) {
      if (truncated) return
      throw new Error('This .blend file has no structure table, so it is damaged.')
    }
    this.structs = parseSdna(data, dna, header)
    for (const s of this.structs) this.byName.set(s.name, s)
    for (const b of this.blocks) {
      if (!b.old) continue
      const list = this.#addresses.get(b.old)
      if (list) list.push(b)
      else this.#addresses.set(b.old, [b])
    }
  }

  get readable() {
    return this.structs.length > 0
  }

  get versionLabel() {
    return `${Math.floor(this.header.version / 100)}.${this.header.version % 100}`
  }

  resolve(pointer: bigint, from?: Block) {
    const list = pointer ? this.#addresses.get(pointer) : undefined
    if (!list) return undefined
    if (list.length === 1 || !from) return list[0]
    const same = list.filter((b) => b.owner === from.owner)
    const pool = same.length ? same : list
    return pool.find((b) => b.index >= from.index) ?? pool[pool.length - 1]
  }

  ref(block: Block | undefined, type?: string, offset = block?.start ?? 0): Ref | null {
    if (!block) return null
    const def = type ? this.byName.get(type) : this.structs[block.sdna]
    if (!def || offset < block.start || offset + def.size > block.start + block.len) return null
    return new Ref(this, def, offset, block)
  }

  array(block: Block | undefined, type: string, count: number) {
    const def = this.byName.get(type)
    if (!block || !def || def.size <= 0 || count < 0 || count * def.size > block.len) return null
    return {
      def,
      block,
      stride: def.size,
      at: (i: number) => new Ref(this, def, block.start + i * def.size, block),
      column: (name: string) => {
        const field = def.fields.get(name)
        if (!field || field.pointer) return null
        const out = new Int32Array(count)
        for (let i = 0; i < count; i++) out[i] = this.number(field, block.start + i * def.size + field.offset)
        return out
      },
    }
  }

  number(field: Field, offset: number) {
    const { view } = this
    const { little } = this.header
    switch (field.elem) {
      case 1:
        return field.type === 'int8_t' ? view.getInt8(offset) : view.getUint8(offset)
      case 2:
        return field.type === 'ushort' || field.type === 'uint16_t'
          ? view.getUint16(offset, little)
          : view.getInt16(offset, little)
      case 4:
        return field.type === 'float' ? view.getFloat32(offset, little) : view.getInt32(offset, little)
      case 8:
        return field.type === 'double' ? view.getFloat64(offset, little) : Number(view.getBigInt64(offset, little))
      default:
        return 0
    }
  }

  ids(code: string) {
    return this.blocks
      .filter((b) => b.code === code)
      .map((b) => this.ref(b))
      .filter((r): r is Ref => r !== null)
  }

  pointerAt(offset: number) {
    return this.header.pointerSize === 8
      ? this.view.getBigUint64(offset, this.header.little)
      : BigInt(this.view.getUint32(offset, this.header.little))
  }

  cString(start: number, max: number) {
    const end = Math.min(start + max, this.data.length)
    const stop = this.data.subarray(start, end).indexOf(0)
    return utf8.decode(this.data.subarray(start, stop >= 0 ? start + stop : end))
  }

  floats(block: Block | undefined, count: number) {
    if (!block || count <= 0 || block.len < count * 4) return null
    const offset = this.data.byteOffset + block.start
    if (this.header.little && offset % 4 === 0) return new Float32Array(this.data.buffer, offset, count).slice()
    const out = new Float32Array(count)
    for (let i = 0; i < count; i++) out[i] = this.view.getFloat32(block.start + i * 4, this.header.little)
    return out
  }

  ints(block: Block | undefined, count: number) {
    if (!block || count <= 0 || block.len < count * 4) return null
    const offset = this.data.byteOffset + block.start
    if (this.header.little && offset % 4 === 0) return new Int32Array(this.data.buffer, offset, count).slice()
    const out = new Int32Array(count)
    for (let i = 0; i < count; i++) out[i] = this.view.getInt32(block.start + i * 4, this.header.little)
    return out
  }

  thumbnail(): ModelPreview | null {
    const block = this.blocks.find((b) => b.code === 'TEST')
    if (!block || block.len < 8) return null
    const width = this.view.getInt32(block.start, this.header.little)
    const height = this.view.getInt32(block.start + 4, this.header.little)
    if (width <= 0 || height <= 0 || width > MAX_THUMBNAIL || height > MAX_THUMBNAIL) return null
    const row = width * 4
    if (8 + row * height > block.len) return null
    const rgba = new Uint8Array(row * height)
    const source = this.data.subarray(block.start + 8, block.start + 8 + row * height)
    for (let y = 0; y < height; y++) rgba.set(source.subarray((height - 1 - y) * row, (height - y) * row), y * row)
    let lit = false
    for (let i = 0; i < rgba.length && !lit; i += 4) lit = rgba[i + 3] > 8 && rgba[i] + rgba[i + 1] + rgba[i + 2] > 24
    return lit ? { width, height, rgba } : null
  }
}

export class Ref {
  constructor(
    readonly blend: Blend,
    readonly def: StructDef,
    readonly base: number,
    readonly block: Block,
  ) {}

  has(name: string) {
    return this.def.fields.has(name)
  }

  int(name: string, i = 0) {
    const f = this.def.fields.get(name)
    return !f || f.pointer || i >= f.count ? 0 : this.blend.number(f, this.base + f.offset + i * f.elem)
  }

  float(name: string, i = 0) {
    const f = this.def.fields.get(name)
    if (!f || f.pointer || i >= f.count) return 0
    const o = this.base + f.offset + i * f.elem
    return f.type === 'double'
      ? this.blend.view.getFloat64(o, this.blend.header.little)
      : this.blend.view.getFloat32(o, this.blend.header.little)
  }

  floats(name: string, fallback: number[] = []) {
    const f = this.def.fields.get(name)
    if (!f || f.type !== 'float') return fallback
    return Array.from({ length: Math.min(f.count, MAX_FLOATS) }, (_, i) => this.float(name, i))
  }

  ptr(name: string, i = 0) {
    const f = this.def.fields.get(name)
    if (!f || !f.pointer || i >= f.count) return 0n
    return this.blend.pointerAt(this.base + f.offset + i * f.elem)
  }

  str(name: string) {
    const f = this.def.fields.get(name)
    return f && !f.pointer ? this.blend.cString(this.base + f.offset, f.size) : ''
  }

  sub(name: string, type?: string): Ref | null {
    const f = this.def.fields.get(name)
    return f && !f.pointer ? this.blend.ref(this.block, type ?? f.type, this.base + f.offset) : null
  }

  target(name: string, i = 0) {
    return this.blend.resolve(this.ptr(name, i), this.block)
  }

  at(name: string, type?: string) {
    return this.blend.ref(this.target(name), type)
  }

  list(name: string, type: string, limit = 100_000) {
    const out: Ref[] = []
    const seen = new Set<bigint>()
    let pointer = this.sub(name, 'ListBase')?.ptr('first') ?? 0n
    let from: Ref = this
    while (pointer && !seen.has(pointer) && out.length < limit) {
      seen.add(pointer)
      const item = this.blend.ref(this.blend.resolve(pointer, from.block), type)
      if (!item) break
      out.push(item)
      from = item
      pointer = item.ptr('next')
    }
    return out
  }

  get idName(): string {
    return this.sub('id', 'ID')?.str('name').slice(2) ?? ''
  }
}
