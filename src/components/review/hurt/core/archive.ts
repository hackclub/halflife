import { libarchiveFormat, type LibarchiveFormat } from '../viewers/office/magic'
import { crc32 } from '../viewers/cadsource/shared'

export interface ArchiveEntry {
  name: string
  size: number
  dir: boolean
  encrypted: boolean
  method: number
  compressedSize: number
  offset: number
}

export interface Archive {
  format: 'zip' | 'tar' | 'gzip' | LibarchiveFormat
  entries: ArchiveEntry[]
  damaged?: boolean
  read(entry: ArchiveEntry): Promise<Uint8Array>
}

const EOCD = 0x06054b50
const EOCD64 = 0x06064b50
const EOCD64_LOCATOR = 0x07064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const ZSTD = 93
const UTF8_FLAG = 0x800
const UNICODE_PATH = 0x7075
const UNPACKED_LIMIT = 512 * 1024 * 1024
const HIDDEN = /(^|\/)(__MACOSX\/|\._[^/]*$|\.DS_Store$)/
const CP437 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0'

const utf8 = new TextDecoder()
const strictUtf8 = new TextDecoder('utf-8', { fatal: true })

export function isHiddenPath(path: string) {
  return HIDDEN.test(path)
}

export function isZip(bytes: Uint8Array) {
  return isSigned(bytes, 0) || (isSpanned(bytes) && isSigned(bytes, 4))
}

function isSigned(bytes: Uint8Array, at: number) {
  return (
    bytes.length >= at + 4 &&
    bytes[at] === 0x50 &&
    bytes[at + 1] === 0x4b &&
    (bytes[at + 2] === 3 || bytes[at + 2] === 5)
  )
}

function isSpanned(bytes: Uint8Array) {
  return bytes.length >= 8 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 7 && bytes[3] === 8
}

function isGzip(bytes: Uint8Array) {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

export async function openArchive(buffer: ArrayBuffer, path = ''): Promise<Archive> {
  const archive = await unpack(buffer, path)
  return { ...archive, entries: tidy(archive.entries) }
}

async function unpack(buffer: ArrayBuffer, path: string): Promise<Archive> {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 4)
    throw new Error(bytes.length ? 'This file is too small to be an archive.' : 'This file is empty.')
  if (isZip(bytes)) return openZip(buffer)
  const packed = libarchiveFormat(bytes)
  if (packed) return openLibarchive(buffer, packed)
  if (isGzip(bytes)) {
    const inner = await inflate(bytes, 'gzip', UNPACKED_LIMIT + 1).catch(() => null)
    if (!inner)
      return openLibarchive(buffer, 'gzip').catch(() => {
        throw new Error('This compressed file is damaged or cut short.')
      })
    if (inner.length > UNPACKED_LIMIT) throw new Error('This archive is too large to unpack in the browser.')
    return isTar(inner) ? openTar(inner) : single(inner, gzipName(bytes, path))
  }
  if (isTar(bytes)) return openTar(bytes)
  throw new Error('This archive format cannot be opened in the browser.')
}

async function openLibarchive(buffer: ArrayBuffer, format: LibarchiveFormat) {
  return (await import('../viewers/office/libarchive')).openLibarchive(buffer, format)
}

function tidy(entries: ArchiveEntry[]) {
  const seen = new Set<string>()
  return entries.flatMap((entry, index) => {
    const clean = entry.name.replace(/^(\.?\/)+/, '')
    if (HIDDEN.test(clean)) return []
    if (entry.dir) return [{ ...entry, name: clean }]
    const base = clean || `unnamed-${index + 1}`
    let name = base
    for (let n = 2; seen.has(name); n++) name = base.replace(/(?<=[^/.])(\.[^./]*)?$/, ` (${n})$1`)
    seen.add(name)
    return [{ ...entry, name }]
  })
}

function legacyName(raw: Uint8Array) {
  try {
    return strictUtf8.decode(raw)
  } catch {
    return Array.from(raw, (b) => (b < 0x80 ? String.fromCharCode(b) : CP437[b - 0x80])).join('')
  }
}

function isDirectoryEnd(view: DataView, at: number) {
  if (at >= 20 && view.getUint32(at - 20, true) === EOCD64_LOCATOR) return true
  const start = at - view.getUint32(at + 12, true)
  if (view.getUint16(at + 10, true) === 0) return start === view.getUint32(at + 16, true)
  return start >= 0 && view.getUint32(start, true) === CENTRAL
}

// Half Life: a file that starts like a ZIP but has no index at its end was cut off – an upload or a commit that did not finish – which is something the reviewer can ask the maker to fix, so say so rather than calling it unreadable.
function missingIndex(view: DataView, length: number) {
  if (length < 30 || view.getUint32(0, true) !== LOCAL) return 'Not a readable ZIP file.'
  const declaredEnd = 30 + view.getUint16(26, true) + view.getUint16(28, true) + view.getUint32(18, true)
  const sizesKnown = (view.getUint16(6, true) & 0x08) === 0
  const short = sizesKnown && declaredEnd > length ? `, about ${Math.round((declaredEnd - length) / 1e6)} MB short of its first file` : ''
  return `This archive is cut off${short}: it ends before the ZIP index, so the upload probably didn't finish. Ask the maker to upload it again.`
}

export function openZip(buffer: ArrayBuffer): Archive {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) !== EOCD) continue
    if (eocd < 0) eocd = i
    if (isDirectoryEnd(view, i)) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(missingIndex(view, bytes.length))

  let count = view.getUint16(eocd + 10, true)
  let cursor = view.getUint32(eocd + 16, true)
  let directorySize = view.getUint32(eocd + 12, true)
  let directoryEnd = eocd
  const locator = eocd - 20
  if ((count === 0xffff || cursor === 0xffffffff) && locator >= 0 && view.getUint32(locator, true) === EOCD64_LOCATOR) {
    const eocd64 = Number(view.getBigUint64(locator + 8, true))
    if (eocd64 + 56 <= bytes.length && view.getUint32(eocd64, true) === EOCD64) {
      count = Number(view.getBigUint64(eocd64 + 32, true))
      cursor = Number(view.getBigUint64(eocd64 + 48, true))
      directorySize = Number(view.getBigUint64(eocd64 + 40, true))
      directoryEnd = eocd64
    }
  }
  const prepended =
    cursor + 4 <= bytes.length && view.getUint32(cursor, true) === CENTRAL
      ? 0
      : Math.max(0, directoryEnd - directorySize - cursor)
  cursor += prepended

  const entries: ArchiveEntry[] = []
  const shift = isSpanned(bytes) ? 4 : 0
  const local = (offset: number) => {
    for (const at of shift ? [offset, offset + shift] : [offset])
      if (at + 30 <= bytes.length && view.getUint32(at, true) === LOCAL) return at
    return -1
  }
  for (let i = 0; i < count && cursor + 46 <= bytes.length; i++) {
    if (view.getUint32(cursor, true) !== CENTRAL) break
    const flags = view.getUint16(cursor + 8, true)
    const method = view.getUint16(cursor + 10, true)
    let compressedSize = view.getUint32(cursor + 20, true)
    let size = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    let offset = view.getUint32(cursor + 42, true)
    if (cursor + 46 + nameLength + extraLength > bytes.length) break
    const raw = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    let name = flags & UTF8_FLAG ? utf8.decode(raw) : legacyName(raw)

    let extra = cursor + 46 + nameLength
    const extraEnd = extra + extraLength
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true)
      const length = view.getUint16(extra + 2, true)
      if (id === 1) {
        let field = extra + 4
        const next = () => {
          const value = Number(view.getBigUint64(field, true))
          field += 8
          return value
        }
        if (size === 0xffffffff) size = next()
        if (compressedSize === 0xffffffff) compressedSize = next()
        if (offset === 0xffffffff) offset = next()
      }
      if (
        id === UNICODE_PATH &&
        extra + 9 <= extraEnd &&
        bytes[extra + 4] === 1 &&
        view.getUint32(extra + 5, true) === crc32(raw)
      )
        name = utf8.decode(bytes.subarray(extra + 9, Math.min(extra + 4 + length, extraEnd)))
      extra += 4 + length
    }
    name = name.replace(/\\/g, '/')

    entries.push({
      name,
      size,
      compressedSize,
      method,
      offset: offset + prepended,
      dir: name.endsWith('/'),
      encrypted: (flags & 1) === 1,
    })
    cursor = extraEnd + commentLength
  }
  if (count > 0 && entries.length === 0) throw new Error('This ZIP file is damaged.')

  return {
    format: 'zip',
    entries,
    damaged: entries.length < count,
    async read(entry) {
      if (entry.encrypted) throw new Error(`${entry.name} is password protected.`)
      const header = local(entry.offset)
      if (header < 0) throw new Error(`${entry.name} is damaged.`)
      const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true)
      const raw = bytes.subarray(start, start + entry.compressedSize)
      if (entry.method === 0) return raw
      if (entry.method === 8) return inflate(raw, 'deflate-raw', Math.min(entry.size, UNPACKED_LIMIT))
      if (entry.method === ZSTD) return (await import('fzstd')).decompress(raw)
      throw new Error(`${entry.name} uses a compression method the browser cannot read.`)
    },
  }
}

function isTar(bytes: Uint8Array) {
  return bytes.length >= 512 && new TextDecoder().decode(bytes.subarray(257, 262)) === 'ustar'
}

function openTar(bytes: Uint8Array): Archive {
  const decoder = new TextDecoder()
  const text = (from: number, length: number) =>
    decoder.decode(bytes.subarray(from, from + length)).replace(/\0.*$/s, '')
  const entries: ArchiveEntry[] = []
  let cursor = 0
  let longName: string | null = null
  let paxName: string | null = null
  while (cursor + 512 <= bytes.length) {
    const name = text(cursor, 100)
    if (!name) break
    const size = parseInt(text(cursor + 124, 12).trim() || '0', 8)
    if (!(size >= 0)) break
    const type = String.fromCharCode(bytes[cursor + 156])
    const prefix = text(cursor + 345, 155)
    const data = cursor + 512
    if (type === 'L') {
      longName = text(data, size)
    } else if (type === 'x') {
      paxName = paxPath(bytes.subarray(data, data + size)) ?? paxName
    } else if (type !== 'g' && type !== 'K') {
      const full = paxName ?? longName ?? (prefix ? `${prefix}/${name}` : name)
      longName = null
      paxName = null
      if (type === '0' || type === '\0' || type === '5')
        entries.push({
          name: full,
          size,
          compressedSize: size,
          method: 0,
          offset: data,
          dir: type === '5',
          encrypted: false,
        })
    }
    cursor = data + Math.ceil(size / 512) * 512
  }
  return { format: 'tar', entries, read: async (entry) => bytes.subarray(entry.offset, entry.offset + entry.size) }
}

function paxPath(data: Uint8Array) {
  let path: string | null = null
  for (let at = 0; at < data.length; ) {
    const space = data.indexOf(0x20, at)
    const length = space < 0 ? 0 : parseInt(utf8.decode(data.subarray(at, space)), 10)
    if (!(length > space - at)) break
    const record = utf8.decode(data.subarray(space + 1, at + length - 1))
    if (record.startsWith('path=')) path = record.slice(5)
    at += length
  }
  return path
}

const GZIP_FEXTRA = 4
const GZIP_FNAME = 8
const GZIP_NAME_LIMIT = 1024

function gzipName(bytes: Uint8Array, path: string) {
  const outer = path.slice(path.lastIndexOf('/') + 1)
  const stripped = outer.replace(/\.(gz|gzip)$/i, '')
  if (stripped && stripped !== outer) return stripped
  const flags = bytes[3]
  if (!(flags & GZIP_FNAME)) return null
  let at = 10
  if (flags & GZIP_FEXTRA) at += 2 + (bytes[at] | (bytes[at + 1] << 8))
  const field = bytes.subarray(at, at + GZIP_NAME_LIMIT)
  const end = field.indexOf(0)
  if (end < 0) return null
  const name = new TextDecoder('latin1').decode(field.subarray(0, end)).split(/[\\/]/).pop()
  return name && name !== '.' && name !== '..' ? name : null
}

function single(bytes: Uint8Array, name: string | null): Archive {
  const entry = {
    name: name ?? 'contents',
    size: bytes.length,
    compressedSize: bytes.length,
    method: 0,
    offset: 0,
    dir: false,
    encrypted: false,
  }
  return { format: 'gzip', entries: [entry], read: async () => bytes }
}

export async function inflate(data: Uint8Array, format: CompressionFormat, limit = Infinity, sizeHint = 0) {
  const sink = new Sink(limit, sizeHint)
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format)).getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!sink.push(value)) {
        await reader.cancel()
        break
      }
    }
  } catch {
    throw new Error('This compressed data is damaged or cut short.')
  }
  return sink.data()
}

export class Sink {
  readonly #limit: number
  readonly #chunks: Uint8Array[] = []
  #buffer: Uint8Array | null
  length = 0

  constructor(limit: number, sizeHint = 0) {
    this.#limit = limit
    this.#buffer = sizeHint > 0 ? new Uint8Array(Math.min(sizeHint, limit)) : null
  }

  push(chunk: Uint8Array) {
    const room = this.#limit - this.length
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk
    if (this.#buffer && this.length + part.length <= this.#buffer.length) this.#buffer.set(part, this.length)
    else {
      if (this.#buffer) this.#chunks.push(this.#buffer.subarray(0, this.length))
      this.#buffer = null
      this.#chunks.push(part)
    }
    this.length += part.length
    return chunk.length <= room
  }

  data() {
    if (this.#buffer) return this.#buffer.subarray(0, this.length)
    if (this.#chunks.length === 1) return this.#chunks[0]
    const out = new Uint8Array(this.length)
    let offset = 0
    while (this.#chunks.length) {
      const chunk = this.#chunks.shift()!
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }
}
