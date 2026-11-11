import { dibToBmp } from './cadsource/shared'

export interface ClosedCad {
  description: string
  preview: Blob | null
  damaged: string | null
}

export const PREVIEW_BYTES = 4 * 1024 * 1024

const DWG_SENTINEL = [0x1f, 0x25, 0x6d, 0x07, 0xd4, 0x36, 0x28, 0x28, 0x9d, 0x57, 0xca, 0x3f, 0x9d, 0x44, 0x10, 0x2b]
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const IEND = [0x49, 0x45, 0x4e, 0x44]
const DWG_PNG = 6
const DWG_BMP = 2
const SKP_SCAN = 64 * 1024

const at = (bytes: Uint8Array, offset: number, signature: number[]) =>
  offset >= 0 && offset + signature.length <= bytes.length && signature.every((b, i) => bytes[offset + i] === b)

export function dwgPreview(bytes: Uint8Array) {
  if (bytes.length < 0x11) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const address = view.getUint32(0x0d, true)
  if (!at(bytes, address, DWG_SENTINEL) || address + 21 > bytes.length) return null
  let offset = address + DWG_SENTINEL.length + 4
  const count = bytes[offset++]
  let fallback: Blob | null = null
  for (let i = 0; i < count && offset + 9 <= bytes.length; i++, offset += 9) {
    const code = bytes[offset]
    const start = view.getUint32(offset + 1, true)
    const size = view.getUint32(offset + 5, true)
    if (size === 0 || start + size > bytes.length) continue
    const data = bytes.subarray(start, start + size)
    if (code === DWG_PNG && at(data, 0, PNG)) return new Blob([data.slice()], { type: 'image/png' })
    const bmp = code === DWG_BMP ? dibToBmp(data) : null
    if (bmp) fallback = new Blob([bmp], { type: 'image/bmp' })
  }
  return fallback
}

function embeddedPng(bytes: Uint8Array) {
  const limit = Math.min(bytes.length, SKP_SCAN)
  for (let i = 0; i + PNG.length <= limit; i++) {
    if (!at(bytes, i, PNG)) continue
    for (let j = i + PNG.length; j + 8 <= bytes.length; j++)
      if (at(bytes, j, IEND)) return new Blob([bytes.slice(i, j + 8)], { type: 'image/png' })
    return null
  }
  return null
}

function skpInfo(bytes: Uint8Array): ClosedCad | null {
  const head = bytes.subarray(0, 96)
  const version = new TextDecoder('utf-16le').decode(head).match(/SketchUp Model\W*\{(\d+)\.[\d.]*\}/)?.[1]
  if (!version) {
    if (!new TextDecoder('latin1').decode(head).includes('SketchUp Model')) return null
    return {
      description: 'SketchUp model',
      preview: null,
      damaged:
        'This SketchUp file is damaged: it was converted to text somewhere along the way, so SketchUp can no longer open it.',
    }
  }
  const major = Number(version)
  return {
    description: `SketchUp ${major >= 13 ? 2000 + major : major} model`,
    preview: embeddedPng(bytes),
    damaged: null,
  }
}

export function closedCadInfo(ext: string, bytes: Uint8Array) {
  if (ext === 'skp') return skpInfo(bytes)
  return null
}
