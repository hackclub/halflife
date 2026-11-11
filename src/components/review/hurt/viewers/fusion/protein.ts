import { isZip, openZip } from '../../core/archive'

const INSTANCES = /AssetData\/InstanceProperties\.bin$/
const PAGE_HEADER = 16
const RECORD_HEADER = 8
const ASSET_START = 1
const ASSET_ID = 36
const MAX_STRING = 4096
const FALLBACK_SCHEMA = 'GenericSchema'
const GENERIC_LAYOUT = 41
const GENERIC_MODERN = 2
const GENERIC_COLOUR = [108, 112]
const GENERIC_TEXTURE = 10
const PRISM_TEXTURE = 32
const COLOUR_AT: Record<string, number> = {
  PrismOpaqueSchema: 8,
  PrismMetalSchema: 8,
  PrismLayeredSchema: 62,
  PrismTransparentSchema: 121,
}

const latin1 = new TextDecoder('latin1')

function assets(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const size = data.length >= PAGE_HEADER ? view.getUint32(0, true) : 0
  const out: Uint8Array[][] = []
  if (size <= RECORD_HEADER) return []
  for (let at = PAGE_HEADER; at + RECORD_HEADER <= data.length; at += size) {
    const length = view.getUint16(at + 4, true)
    if (view.getUint16(at + 6, true) & ASSET_START || out.length === 0) out.push([])
    out[out.length - 1].push(data.subarray(at + RECORD_HEADER, Math.min(at + RECORD_HEADER + length, data.length)))
  }
  return out.map((parts) => {
    const asset = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
      asset.set(part, at)
      at += part.length
    }
    return asset
  })
}

function colour(asset: Uint8Array) {
  const view = new DataView(asset.buffer, asset.byteOffset, asset.byteLength)
  let at = 0
  const text = () => {
    if (at + 4 > asset.length) return null
    const length = view.getUint32(at, true)
    if (length > MAX_STRING || at + 4 + length > asset.length) return null
    const value = latin1.decode(asset.subarray(at + 4, at + 4 + length))
    at += 4 + length
    return value
  }
  const [schema, id, , base] = [text(), text(), text(), text()]
  const offset = schema === FALLBACK_SCHEMA ? genericOffset(asset, at) : schema === null ? undefined : COLOUR_AT[schema]
  if (!id || base === null || offset === undefined || at + offset + PRISM_TEXTURE + 3 > asset.length) return null
  const flags = asset.subarray(at + offset + PRISM_TEXTURE, at + offset + PRISM_TEXTURE + 3)
  if (schema !== FALLBACK_SCHEMA && flags.every((flag) => flag === 1)) return null
  const rgb = [0, 1, 2].map((k) => view.getFloat64(at + offset + k * 8, true))
  return rgb.every((v) => v >= 0 && v <= 1)
    ? { id: id.slice(0, ASSET_ID).toUpperCase(), rgb, fallback: schema === FALLBACK_SCHEMA }
    : null
}

function genericOffset(asset: Uint8Array, at: number) {
  const offset = GENERIC_COLOUR[Number(asset[at + GENERIC_LAYOUT] === GENERIC_MODERN)]
  return asset[at + offset - GENERIC_TEXTURE] === 0 ? offset : undefined
}

export async function readProtein(bytes: Uint8Array) {
  const colours = new Map<string, number[]>()
  if (!isZip(bytes)) return colours
  const archive = openZip(bytes.slice().buffer as ArrayBuffer)
  for (const entry of archive.entries.filter((e) => INSTANCES.test(e.name)))
    for (const asset of assets(await archive.read(entry))) {
      const found = colour(asset)
      if (found && !(found.fallback && colours.has(found.id))) colours.set(found.id, found.rgb)
    }
  return colours
}
