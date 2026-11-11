import { ArchiveReader, libarchiveWasm, type LibarchiveWasm } from 'libarchive-wasm'
// Half Life: served by app/api/reviews/assets from the installed package, in place of Vite's `?url` import.
const wasmUrl = '/api/reviews/assets/libarchive.wasm'
import { serveWorker } from '../../core/workers'

export interface ListedEntry {
  name: string
  size: number
  dir: boolean
  encrypted: boolean
}

export type ExtractedEntry = { index: number; data: Uint8Array } | { index: number; error: string }

const ENTRY_LIMIT = 256 * 1024 * 1024
const UNKNOWN_SIZE_CHUNK = 4 * 1024 * 1024
const STORED_LIMIT = 2

let module: Promise<LibarchiveWasm> | null = null
const stored = new Map<number, ArrayBuffer>()

class Refusal extends Error {}

function load() {
  module ??= fetch(new URL(wasmUrl, self.location.origin))
    .then((response) => {
      if (!response.ok) throw new Error('Could not load the archive reader.')
      return response.arrayBuffer()
    })
    .then((wasmBinary) => libarchiveWasm({ wasmBinary }))
  module.catch(() => (module = null))
  return module
}

async function withReader<T>(bytes: ArrayBuffer, use: (reader: ArchiveReader) => T) {
  const lib = await load()
  let reader: ArchiveReader
  try {
    reader = new ArchiveReader(lib, new Int8Array(bytes))
  } catch {
    module = null
    throw new Error('This archive is damaged or uses a format the browser cannot open.')
  }
  try {
    return { result: use(reader), heap: lib.module.HEAP8.length as number }
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) module = null
    throw error instanceof Refusal ? error : new Error('This archive is damaged or cut short.')
  } finally {
    try {
      reader.free()
    } catch {
      module = null
    }
  }
}

function remember(payload: Record<string, unknown>) {
  const id = payload.archive as number
  const bytes = (payload.bytes as ArrayBuffer | undefined) ?? stored.get(id)
  if (!bytes) return null
  stored.delete(id)
  stored.set(id, bytes)
  if (stored.size > STORED_LIMIT) stored.delete(stored.keys().next().value!)
  return bytes
}

function readUnknownSize(reader: ArchiveReader) {
  const chunks: Int8Array[] = []
  let total = 0
  for (;;) {
    const chunk = reader.readData(UNKNOWN_SIZE_CHUNK)
    if (chunk.length === 0) break
    total += chunk.length
    if (total > ENTRY_LIMIT) throw new Refusal('too large')
    chunks.push(chunk)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length), at)
    at += chunk.length
  }
  return out
}

serveWorker({
  async list(payload) {
    const { result, heap } = await withReader(remember(payload)!, (reader) => {
      const entries: ListedEntry[] = []
      try {
        for (const entry of reader.entries()) {
          const type = entry.getFiletype()
          entries.push({
            name: entry.getPathname() ?? '',
            size: type === 'File' ? entry.getSize() : 0,
            dir: type === 'Directory',
            encrypted: entry.isEncrypted(),
          })
        }
      } catch (error) {
        if (entries.length === 0 || error instanceof WebAssembly.RuntimeError) throw error
        return { entries, damaged: true }
      }
      if (entries.length === 0 && reader.hasEncryptedData()) throw new Refusal('This archive is password protected.')
      return { entries, damaged: false }
    })
    return { result: { ...result, heap } }
  },

  async read(payload) {
    const bytes = remember(payload)
    if (!bytes) return { result: { heap: 0 } }
    const wanted = new Set(payload.indices as number[])
    const last = Math.max(...wanted)
    const { result, heap } = await withReader(bytes, (reader) => {
      const out: ExtractedEntry[] = []
      let index = 0
      let returned = 0
      try {
        for (const entry of reader.entries()) {
          if (wanted.has(index)) {
            const name = entry.getPathname()
            const size = entry.getSize()
            try {
              if (entry.isEncrypted()) throw new Refusal(`${name} is password protected.`)
              if (returned + size > ENTRY_LIMIT) throw new Refusal('too large')
              const data = size > 0 ? entry.readData() : readUnknownSize(reader)
              if ((data?.length ?? 0) < size) throw new Error('cut short')
              returned += data?.length ?? 0
              out.push({
                index,
                data: data ? new Uint8Array(data.buffer, data.byteOffset, data.length) : new Uint8Array(0),
              })
            } catch (error) {
              if (error instanceof WebAssembly.RuntimeError) throw error
              out.push({
                index,
                error: !(error instanceof Refusal)
                  ? `${name} is damaged inside the archive.`
                  : error.message === 'too large'
                    ? `${name} is too large to unpack in the browser.`
                    : error.message,
              })
            }
          }
          if (index++ >= last) break
        }
      } catch (error) {
        if (error instanceof WebAssembly.RuntimeError) throw error
      }
      return out
    })
    const transfer = result.flatMap((entry) => ('data' in entry ? [entry.data.buffer as ArrayBuffer] : []))
    return { result: { entries: result, heap }, transfer }
  },
})
