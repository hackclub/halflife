import type { CadProperty } from './types'

export const MAX_SECTION = 64 * 1024 * 1024
export const DAMAGED = 'This file is incomplete or damaged, so the browser could not read it.'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const utf8 = new TextDecoder('utf-8')

export function xmlText(bytes: Uint8Array) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64))
  return utf8.decode(bytes.subarray(Math.max(0, head.indexOf('<'))))
}

export function unescapeXml(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&amp;/g, '&')
}

export function attr(tag: string, name: string) {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return match ? unescapeXml(match[1]) : undefined
}

export function basename(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

export const LIBRARY_PATH = /\\(Content Center Files|Toolbox|SOLIDWORKS Data[^\\]*\\browser)\\/i

const LOCAL_PATH = /^[a-z]:\\|^\\\\|^\/(users|home)\//i

export function property(name: string, value: string, config?: string): CadProperty | null {
  const clean = value.trim()
  if (!name.trim() || !clean) return null
  return { name: name.trim(), value: LOCAL_PATH.test(clean) ? basename(clean.replace(/[\\/]+$/, '')) : clean, config }
}

export function dibToBmp(dib: Uint8Array) {
  if (dib.length < 40) return null
  const view = new DataView(dib.buffer, dib.byteOffset, dib.byteLength)
  const headerSize = view.getUint32(0, true)
  if (headerSize < 40 || headerSize > 124) return null
  const bpp = view.getUint16(14, true)
  const compression = view.getUint32(16, true)
  const used = view.getUint32(32, true)
  const masks = headerSize === 40 ? (compression === 3 ? 12 : compression === 6 ? 16 : 0) : 0
  const palette = bpp <= 8 ? Math.min(used || 1 << bpp, 256) * 4 : masks
  const out = new Uint8Array(14 + dib.length)
  const header = new DataView(out.buffer)
  out[0] = 0x42
  out[1] = 0x4d
  header.setUint32(2, out.length, true)
  header.setUint32(10, 14 + headerSize + palette, true)
  out.set(dib, 14)
  return out
}

export function isPng(bytes: Uint8Array | null | undefined, at = 0): bytes is Uint8Array {
  return !!bytes && bytes[at] === 0x89 && bytes[at + 1] === 0x50 && bytes[at + 2] === 0x4e && bytes[at + 3] === 0x47
}

export function placeholderNote(name: string, size: number, head?: Uint8Array) {
  if (name.startsWith('~$') && size < 512)
    return 'This is a lock file SolidWorks leaves behind while a document is open. It holds no model data.'
  if (name.startsWith('._') || (head && head[0] === 0 && head[1] === 5 && head[2] === 0x16 && head[3] === 7))
    return 'This is a macOS AppleDouble file, which Finder adds when it copies files. It holds no model data.'
  return null
}
