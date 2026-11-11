import type { Cfb } from '../../core/cfb'
import { readPropertySets, type PropertySet, type PropertyValue } from './propset'
import { emptyInfo, type CadInfo, type CadReference } from './types'
import { LIBRARY_PATH, basename, dibToBmp, isPng, property } from './shared'

const DOC_TYPES: Record<string, string> = { ipt: 'Part', iam: 'Assembly', idw: 'Drawing', ipn: 'Presentation' }
const REFERENCE = /^[^\0-\x1f]+\.(ipt|iam|ipn|idw|dwg|step|stp|iges|igs|sat|x_t)$/i
const CF_DIB = 8

function propertySets(cfb: Cfb) {
  const sets = new Map<string, PropertySet>()
  for (const path of cfb.paths) {
    if (!path.startsWith('\u0005') || path.includes('/')) continue
    try {
      const stream = cfb.read(path, 4 * 1024 * 1024)
      if (!stream) continue
      for (const set of readPropertySets(stream)) {
        const name = set.props.get(255)
        sets.set(typeof name === 'string' ? name : set.fmtid, set)
      }
    } catch {
      continue
    }
  }
  return sets
}

function text(value: PropertyValue | undefined) {
  if (typeof value === 'string') return value.trim() || null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function repairUtf8(name: string) {
  if (!/[\x80-\xff]/.test(name) || /[^\0-\xff]/.test(name)) return name
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(name, (c) => c.charCodeAt(0)))
  } catch {
    return name
  }
}

function references(cfb: Cfb, ext: string) {
  const stream = cfb.read('UFRxDoc', 16 * 1024 * 1024)
  if (!stream) return []
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength)
  const utf16 = new TextDecoder('utf-16le')
  const found = new Map<string, CadReference>()
  let self = true
  for (let i = 0; i + 8 < stream.length && found.size < 1000; i++) {
    const n = view.getUint32(i, true)
    if (n < 5 || n > 520 || i + 4 + n * 2 > stream.length) continue
    const path = utf16.decode(stream.subarray(i + 4, i + 4 + n * 2))
    if (!REFERENCE.test(path) || /\\Templates\\/i.test(path)) continue
    i += 3 + n * 2
    const name = repairUtf8(basename(path))
    if (self && name.toLowerCase().endsWith(`.${ext}`)) self = false
    else found.set(name.toLowerCase(), { name, embedded: false, library: LIBRARY_PATH.test(path) })
  }
  return [...found.values()]
}

export function inventorInfo(cfb: Cfb, ext: string): CadInfo {
  const info = emptyInfo('Inventor', DOC_TYPES[ext] ?? 'Document', 'OLE compound file')
  const sets = propertySets(cfb)

  const summary = sets.get('Inventor Summary Information')
  const thumbnail = summary?.props.get(17)
  if (thumbnail && typeof thumbnail === 'object' && 'data' in thumbnail) {
    const data = thumbnail.data
    const pngAt = isPng(data, 8) ? 8 : isPng(data) ? 0 : -1
    const bmp = pngAt < 0 && thumbnail.format === CF_DIB ? dibToBmp(data) : null
    if (pngAt >= 0) info.previews.push({ label: 'Preview', mime: 'image/png', bytes: data.slice(pngAt) })
    else if (bmp) info.previews.push({ label: 'Preview', mime: 'image/bmp', bytes: bmp })
  }
  info.title = text(summary?.props.get(2))
  info.author = text(summary?.props.get(4))
  info.lastSavedBy = text(summary?.props.get(8))

  const tracking = sets.get('Design Tracking Properties')?.props
  if (tracking) {
    const updated = text(tracking.get(67))
    info.savedWith = updated ? `Inventor ${updated.replace(/\s*\(Build.*$/i, '')}` : null
    info.partNumber = text(tracking.get(5))
    info.material = text(tracking.get(20))
    info.description = text(tracking.get(29))
    info.author ??= text(tracking.get(41))
    info.created = text(tracking.get(4))
  }
  info.modified = text(sets.get('Design Tracking Control')?.props.get(17))

  const user = sets.get('Inventor User Defined Properties')
  if (user) {
    for (const [pid, name] of user.names) {
      if (pid === 255) continue
      const p = property(name, text(user.props.get(pid)) ?? '')
      if (p && info.properties.length < 200) info.properties.push(p)
    }
  }
  if (ext !== 'ipt') info.references = references(cfb, ext)
  return info
}

export function isInventor(cfb: Cfb) {
  return cfb.has('UFRxDoc') || cfb.paths.some((p) => p.startsWith('RSeStorage/'))
}
