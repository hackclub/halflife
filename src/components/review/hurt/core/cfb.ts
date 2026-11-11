const END_OF_CHAIN = 0xfffffffe
const FREE = 0xffffffff
const NO_STREAM = 0xffffffff
const STORAGE = 1
const STREAM = 2
const ROOT = 5
const STREAM_LIMIT = 256 * 1024 * 1024
const ENTRY_LIMIT = 65536

export interface Cfb {
  paths: string[]
  truncated: boolean
  has(path: string): boolean
  read(path: string, limit?: number): Uint8Array | null
}

interface DirEntry {
  name: string
  type: number
  left: number
  right: number
  child: number
  start: number
  size: number
}

export function isCfb(bytes: Uint8Array) {
  return bytes.length >= 512 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
}

export function openCfb(input: Uint8Array | ArrayBuffer): Cfb {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!isCfb(bytes)) throw new Error('Not an OLE compound file.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sectorShift = view.getUint16(0x1e, true)
  const miniShift = view.getUint16(0x20, true)
  if (sectorShift < 7 || sectorShift > 16 || miniShift > sectorShift) throw new Error('This compound file is damaged.')
  const sectorSize = 1 << sectorShift
  const miniSize = 1 << miniShift
  const perSector = sectorSize / 4
  const sectorCount = Math.ceil(bytes.length / sectorSize)
  const fatCount = Math.min(view.getUint32(0x2c, true), sectorCount)
  const firstDirectory = view.getUint32(0x30, true)
  const miniCutoff = view.getUint32(0x38, true)
  const firstMiniFat = view.getUint32(0x3c, true)
  const offsetOf = (sector: number) => (sector + 1) * sectorSize
  const word = (at: number) => (at >= 0 && at + 4 <= bytes.length ? view.getUint32(at, true) : FREE)

  const fatSectors: number[] = []
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(word(0x4c + i * 4))
  const seen = new Set<number>()
  for (
    let difat = view.getUint32(0x44, true);
    fatSectors.length < fatCount && difat < sectorCount && !seen.has(difat);
    difat = word(offsetOf(difat) + sectorSize - 4)
  ) {
    seen.add(difat)
    for (let i = 0; i < perSector - 1 && fatSectors.length < fatCount; i++)
      fatSectors.push(word(offsetOf(difat) + i * 4))
  }
  const fat = new Uint32Array(fatSectors.length * perSector).fill(FREE)
  fatSectors.forEach((sector, i) => {
    if (sector >= sectorCount) return
    for (let j = 0; j < perSector; j++) fat[i * perSector + j] = word(offsetOf(sector) + j * 4)
  })

  const chain = (start: number, table: Uint32Array) => {
    const sectors: number[] = []
    const visited = new Set<number>()
    for (let s = start; s !== END_OF_CHAIN && s < table.length && !visited.has(s); s = table[s]) {
      visited.add(s)
      sectors.push(s)
    }
    return sectors
  }
  const readChain = (start: number, size = Infinity) => {
    const sectors = chain(start, fat)
    const length = Math.min(size, sectors.length * sectorSize, bytes.length, STREAM_LIMIT)
    const out = new Uint8Array(length)
    for (let i = 0; i < sectors.length && i * sectorSize < length; i++) {
      const from = offsetOf(sectors[i])
      out.set(bytes.subarray(from, Math.min(from + sectorSize, from + length - i * sectorSize)), i * sectorSize)
    }
    return out
  }

  const directory = readChain(firstDirectory)
  const dirView = new DataView(directory.buffer)
  const entries: DirEntry[] = []
  for (let at = 0; at + 128 <= directory.length && entries.length < ENTRY_LIMIT; at += 128) {
    const nameLength = Math.min(64, dirView.getUint16(at + 0x40, true))
    let name = ''
    for (let i = 0; i + 1 < nameLength / 2; i++) name += String.fromCharCode(dirView.getUint16(at + i * 2, true))
    entries.push({
      name,
      type: directory[at + 0x42],
      left: dirView.getUint32(at + 0x44, true),
      right: dirView.getUint32(at + 0x48, true),
      child: dirView.getUint32(at + 0x4c, true),
      start: dirView.getUint32(at + 0x74, true),
      size: dirView.getUint32(at + 0x78, true),
    })
  }

  const streams = new Map<string, DirEntry>()
  const lower = new Map<string, DirEntry>()
  const visited = new Set<number>()
  const root = entries[0]?.type === ROOT ? entries[0] : entries.find((e) => e.type === ROOT)
  const stack: [number, string][] = root ? [[root.child, '']] : []
  while (stack.length) {
    const [id, prefix] = stack.pop()!
    if (id === NO_STREAM || id >= entries.length || visited.has(id)) continue
    visited.add(id)
    const entry = entries[id]
    if (entry.type === STREAM) {
      streams.set(prefix + entry.name, entry)
      lower.set((prefix + entry.name).toLowerCase(), entry)
    } else if (entry.type === STORAGE) stack.push([entry.child, `${prefix}${entry.name}/`])
    stack.push([entry.right, prefix], [entry.left, prefix])
  }

  const miniStream = root ? readChain(root.start, root.size) : new Uint8Array(0)
  const miniFatBytes = firstMiniFat < sectorCount ? readChain(firstMiniFat) : new Uint8Array(0)
  const miniFat = new Uint32Array(miniFatBytes.buffer, 0, miniFatBytes.byteLength >> 2)

  const find = (path: string) => streams.get(path) ?? lower.get(path.toLowerCase())

  return {
    paths: [...streams.keys()],
    truncated:
      fatSectors.length < view.getUint32(0x2c, true) ||
      [firstDirectory, ...fatSectors].some((sector) => sector >= sectorCount - 1),
    has: (path) => find(path) !== undefined,
    read(path, limit = STREAM_LIMIT) {
      const entry = find(path)
      if (!entry || entry.size > limit) return null
      if (entry.size >= miniCutoff) return readChain(entry.start, entry.size)
      const sectors = chain(entry.start, miniFat)
      const out = new Uint8Array(Math.min(entry.size, sectors.length * miniSize, miniStream.length))
      sectors.forEach((s, i) => {
        const at = i * miniSize
        if (at < out.length)
          out.set(miniStream.subarray(s * miniSize, s * miniSize + Math.min(miniSize, out.length - at)), at)
      })
      return out
    },
  }
}
