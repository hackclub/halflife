export interface Clipboard {
  format: number | null
  data: Uint8Array
}

export type PropertyValue = string | number | boolean | Date | Clipboard | null

export interface PropertySet {
  fmtid: string
  props: Map<number, PropertyValue>
  names: Map<number, string>
}

const utf16 = new TextDecoder('utf-16le')

function guid(bytes: Uint8Array, o: number) {
  const h = (i: number) => bytes[o + i].toString(16).padStart(2, '0')
  return `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-${h(8)}${h(9)}-${[10, 11, 12, 13, 14, 15].map(h).join('')}`.toUpperCase()
}

const CODEPAGES: Record<number, string> = { 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 65001: 'utf-8' }

function decodeAnsi(bytes: Uint8Array, codepage: number) {
  const trim = (s: string) => s.replace(/\0+$/, '')
  if (codepage === 1200) return trim(utf16.decode(bytes))
  try {
    return trim(new TextDecoder(CODEPAGES[codepage] ?? `windows-${codepage || 1252}`).decode(bytes))
  } catch {
    return trim(new TextDecoder('windows-1252').decode(bytes))
  }
}

function readValue(view: DataView, bytes: Uint8Array, o: number, codepage: number): PropertyValue | undefined {
  const p = o + 4
  const stringAt = (n: number, wide: boolean) => {
    if (n > 1 << 20 || p + 4 + n * (wide ? 2 : 1) > bytes.length) return null
    const slice = bytes.subarray(p + 4, p + 4 + n * (wide ? 2 : 1))
    return wide ? utf16.decode(slice).replace(/\0+$/, '') : decodeAnsi(slice, codepage)
  }
  switch (view.getUint16(o, true)) {
    case 2:
      return view.getInt16(p, true)
    case 3:
      return view.getInt32(p, true)
    case 4:
      return view.getFloat32(p, true)
    case 5:
      return view.getFloat64(p, true)
    case 11:
      return view.getInt16(p, true) !== 0
    case 17:
      return bytes[p]
    case 18:
      return view.getUint16(p, true)
    case 19:
      return view.getUint32(p, true)
    case 20:
      return Number(view.getBigInt64(p, true))
    case 21:
      return Number(view.getBigUint64(p, true))
    case 8:
    case 30:
      return stringAt(view.getUint32(p, true), false)
    case 31:
      return stringAt(view.getUint32(p, true), true)
    case 64: {
      const ticks = view.getBigUint64(p, true)
      const ms = Number(ticks / 10000n) - 11644473600000
      return ticks === 0n || !Number.isFinite(ms) || Math.abs(ms) > 8.64e15 ? null : new Date(ms)
    }
    case 71: {
      const size = view.getUint32(p, true)
      const tag = view.getInt32(p + 4, true)
      const format = tag === -1 || tag === -2 ? view.getUint32(p + 8, true) : null
      const end = Math.min(bytes.length, p + 4 + size)
      return { format, data: bytes.subarray(format === null ? p + 8 : p + 12, end) }
    }
    default:
      return undefined
  }
}

export function readPropertySets(bytes: Uint8Array): PropertySet[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 48 || view.getUint16(0, true) !== 0xfffe) throw new Error('This is not a property set stream.')
  const sets: PropertySet[] = []
  const count = Math.min(view.getUint32(24, true), 4)
  for (let s = 0; s < count && 48 + s * 20 <= bytes.length; s++) {
    const fmtid = guid(bytes, 28 + s * 20)
    const base = view.getUint32(44 + s * 20, true)
    if (base + 8 > bytes.length) continue
    const total = Math.min(view.getUint32(base + 4, true), 4096, (bytes.length - base - 8) >> 3)
    const offsets: [number, number][] = []
    for (let k = 0; k < total; k++)
      offsets.push([view.getUint32(base + 8 + k * 8, true), base + view.getUint32(base + 12 + k * 8, true)])
    const codepageAt = offsets.find(([pid]) => pid === 1)?.[1]
    const codepage =
      codepageAt !== undefined && codepageAt + 6 <= bytes.length ? view.getUint16(codepageAt + 4, true) : 1252
    const props = new Map<number, PropertyValue>()
    const names = new Map<number, string>()
    for (const [pid, o] of offsets) {
      if (o + 8 > bytes.length) continue
      try {
        if (pid === 0) readDictionary(view, bytes, o, codepage, names)
        else {
          const value = readValue(view, bytes, o, codepage)
          if (value !== undefined) props.set(pid, value)
        }
      } catch {
        continue
      }
    }
    sets.push({ fmtid, props, names })
  }
  return sets
}

function readDictionary(view: DataView, bytes: Uint8Array, o: number, codepage: number, names: Map<number, string>) {
  const count = Math.min(view.getUint32(o, true), 4096)
  let q = o + 4
  for (let d = 0; d < count && q + 8 <= bytes.length; d++) {
    const id = view.getUint32(q, true)
    const length = Math.min(view.getUint32(q + 4, true), 1024)
    q += 8
    if (codepage === 1200) {
      names.set(id, utf16.decode(bytes.subarray(q, q + length * 2)).replace(/\0+$/, ''))
      q = (q + length * 2 + 3) & ~3
    } else {
      names.set(id, decodeAnsi(bytes.subarray(q, q + length), codepage))
      q += length
    }
  }
}
