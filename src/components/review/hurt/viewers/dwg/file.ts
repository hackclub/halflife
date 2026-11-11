export class DwgError extends Error {}

const R2004_VERSIONS = new Set(['AC1018', 'AC1024', 'AC1027', 'AC1032'])
const HEADER_AT = 0x80
const HEADER_SIZE = 0x6c
const HEADER_MAGIC = 'AcFssFcAJMB'
const PAGES_START = 0x100
const PAGE_MAP = 0x41630e3b
const SECTION_MAP = 0x4163003b
const DATA_PAGE = 0x4163043b
const DATA_PAGE_KEY = 0x4164536b
const SYSTEM_HEADER = 20
const DATA_HEADER = 32
const NAME_SIZE = 64
const MAX_SECTION = 512 * 1024 * 1024
const latin1 = new TextDecoder('latin1')

interface SectionInfo {
  size: number
  pageSize: number
  compressed: boolean
  encrypted: boolean
  pages: { id: number; offset: number }[]
}

function headerData(bytes: Uint8Array) {
  if (bytes.length < HEADER_AT + HEADER_SIZE) throw new DwgError('This drawing ends early.')
  const out = bytes.slice(HEADER_AT, HEADER_AT + HEADER_SIZE)
  let seed = 1
  for (let i = 0; i < out.length; i++) {
    seed = (Math.imul(seed, 0x343fd) + 0x269ec3) >>> 0
    out[i] ^= (seed >>> 16) & 0xff
  }
  if (latin1.decode(out.subarray(0, HEADER_MAGIC.length)) !== HEADER_MAGIC)
    throw new DwgError('This drawing is encrypted or damaged.')
  return new DataView(out.buffer)
}

export function decompress(input: Uint8Array, size: number) {
  const out = new Uint8Array(size)
  let [at, to] = [0, 0]
  const next = () => {
    if (at >= input.length) throw new DwgError('A compressed part of this drawing ends early.')
    return input[at++]
  }
  const literal = (opcode: number) => {
    if (opcode >= 0x01 && opcode <= 0x0f) return opcode + 3
    if (opcode !== 0) return 0
    let total = 0x0f
    let byte = next()
    for (; byte === 0; byte = next()) total += 0xff
    return total + byte + 3
  }
  const long = () => {
    let total = 0
    let byte = next()
    if (byte === 0) for (total = 0xff, byte = next(); byte === 0; byte = next()) total += 0xff
    return total + byte
  }
  const copy = (count: number) => {
    if (to + count > size || at + count > input.length)
      throw new DwgError('A compressed part of this drawing is damaged.')
    out.set(input.subarray(at, at + count), to)
    at += count
    to += count
  }
  let opcode = next()
  if (!(opcode & 0xf0)) {
    copy(literal(opcode))
    opcode = 0
  }
  while (at < input.length) {
    if (opcode === 0) opcode = next()
    if (opcode === 0x11) break
    let count: number
    let offset: number
    let tail: number
    if (opcode >= 0x40) {
      count = (opcode >> 4) - 1
      offset = (next() << 2) | ((opcode & 0x0c) >> 2)
      tail = opcode & 0x03
    } else {
      if (opcode >= 0x21) count = opcode - 0x1e
      else if (opcode === 0x20) count = long() + 0x21
      else if (opcode >= 0x12) count = (opcode & 0x0f) + 2
      else if (opcode === 0x10) count = long() + 9
      else throw new DwgError('A compressed part of this drawing is damaged.')
      const [first, second] = [next(), next()]
      offset = ((first >> 2) | (second << 6)) + (opcode <= 0x1f ? 0x3fff : 0)
      tail = first & 0x03
    }
    if (tail === 0) {
      const following = next()
      tail = literal(following)
      opcode = tail === 0 ? following : 0
    } else opcode = 0
    const from = to - offset - 1
    if (from < 0 || to + count > size) throw new DwgError('A compressed part of this drawing is damaged.')
    for (let i = 0; i < count; i++) out[to + i] = out[from + i]
    to += count
    copy(tail)
  }
  return out
}

export class DwgFile {
  private readonly view: DataView
  private readonly pages = new Map<number, number>()
  private readonly sections = new Map<string, SectionInfo>()

  constructor(readonly bytes: Uint8Array) {
    if (!R2004_VERSIONS.has(latin1.decode(bytes.subarray(0, 6))))
      throw new DwgError("This drawing was saved in an AutoCAD format the viewer can't read solids from.")
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const header = headerData(bytes)
    this.readPageMap(Number(header.getBigUint64(0x54, true)) + PAGES_START)
    const mapAt = this.pages.get(header.getUint32(0x5c, true))
    if (mapAt === undefined) throw new DwgError('This drawing has no section map.')
    this.readSectionMap(mapAt)
  }

  section(name: string) {
    const info = this.sections.get(name)
    if (!info) return null
    if (info.encrypted) throw new DwgError(`The ${name} section of this drawing is encrypted.`)
    if (info.size > MAX_SECTION) throw new DwgError('This drawing is too big for the in-browser reader.')
    const out = new Uint8Array(info.size)
    for (const page of info.pages) {
      const at = this.pages.get(page.id)
      if (at === undefined || at + DATA_HEADER > this.bytes.length) continue
      const key = (DATA_PAGE_KEY ^ at) >>> 0
      const field = (i: number) => (this.view.getUint32(at + i * 4, true) ^ key) >>> 0
      if (field(0) !== DATA_PAGE || page.offset >= out.length) continue
      const data = this.bytes.subarray(at + DATA_HEADER, at + DATA_HEADER + field(2))
      const decoded = info.compressed ? decompress(data, info.pageSize) : data
      out.set(decoded.subarray(0, out.length - page.offset), page.offset)
    }
    return out
  }

  private system(at: number, type: number) {
    if (at + SYSTEM_HEADER > this.bytes.length || this.view.getUint32(at, true) !== type)
      throw new DwgError('This drawing is damaged.')
    const size = this.view.getUint32(at + 4, true)
    const stored = this.view.getUint32(at + 8, true)
    const data = this.bytes.subarray(at + SYSTEM_HEADER, at + SYSTEM_HEADER + stored)
    const out = this.view.getUint32(at + 12, true) === 2 ? decompress(data, size) : data.slice(0, size)
    return new DataView(out.buffer, out.byteOffset, out.byteLength)
  }

  private readPageMap(at: number) {
    const map = this.system(at, PAGE_MAP)
    let address = PAGES_START
    for (let i = 0; i + 8 <= map.byteLength; ) {
      const id = map.getInt32(i, true)
      const size = map.getUint32(i + 4, true)
      i += id < 0 ? 24 : 8
      if (id >= 0) this.pages.set(id, address)
      address += size
    }
  }

  private readSectionMap(at: number) {
    const map = this.system(at, SECTION_MAP)
    const count = map.getUint32(0, true)
    let i = 20
    for (let s = 0; s < count && i + 32 + NAME_SIZE <= map.byteLength; s++) {
      const size = Number(map.getBigUint64(i, true))
      const pageCount = map.getUint32(i + 8, true)
      const pageSize = map.getUint32(i + 12, true)
      const compressed = map.getUint32(i + 20, true) === 2
      const encrypted = map.getUint32(i + 28, true) === 1
      const raw = new Uint8Array(map.buffer, map.byteOffset + i + 32, NAME_SIZE)
      const end = raw.indexOf(0)
      const name = latin1.decode(raw.subarray(0, end < 0 ? NAME_SIZE : end))
      i += 32 + NAME_SIZE
      const pages: SectionInfo['pages'] = []
      for (let p = 0; p < pageCount && i + 16 <= map.byteLength; p++, i += 16)
        pages.push({ id: map.getUint32(i, true), offset: Number(map.getBigUint64(i + 8, true)) })
      if (name) this.sections.set(name, { size, pageSize, compressed, encrypted, pages })
    }
  }
}
