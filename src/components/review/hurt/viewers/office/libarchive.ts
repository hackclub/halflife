// Half Life: Next bundles a worker only when it sees `new Worker(new URL(...))` written out, so this is a factory rather than Vite's `?worker&url` import.
const libarchiveWorker = (name: string) => new Worker(new URL('./libarchive.worker.ts', import.meta.url), { name, type: 'module' })
import type { Archive, ArchiveEntry } from '../../core/archive'
import { WorkerClient } from '../../core/workers'
import type { ExtractedEntry, ListedEntry } from './libarchive.worker'
import type { LibarchiveFormat } from './magic'

const HEAP_LIMIT = 256 * 1024 * 1024
const KEPT_LIMIT = 192 * 1024 * 1024

const worker = new WorkerClient(libarchiveWorker, 'archive reader')
const kept = new Map<string, Uint8Array>()
let keptBytes = 0
let restartPending = false
let nextId = 0

async function call<T>(type: string, payload: Record<string, unknown>) {
  try {
    const result = await worker.call<{ heap: number } & T>(type, payload)
    if (result.heap > HEAP_LIMIT) restartPending = true
    return result
  } finally {
    if (restartPending && !worker.busy) {
      restartPending = false
      worker.restart()
    }
  }
}

function keep(key: string, data: Uint8Array) {
  if (data.byteLength > KEPT_LIMIT / 2) return
  kept.set(key, data)
  keptBytes += data.byteLength
  for (const [oldKey, old] of kept) {
    if (keptBytes <= KEPT_LIMIT) break
    kept.delete(oldKey)
    keptBytes -= old.byteLength
  }
}

function recall(key: string) {
  const data = kept.get(key)
  if (data) {
    kept.delete(key)
    kept.set(key, data)
  }
  return data
}

export async function openLibarchive(buffer: ArrayBuffer, format: LibarchiveFormat): Promise<Archive> {
  const id = ++nextId
  const compressed = format === 'xz' || format === 'bzip2' || format === 'gzip'
  const onlyTar = 'Only tar archives compressed this way can be opened in the browser.'
  let listed: { entries: ListedEntry[]; damaged: boolean }
  try {
    listed = await call<{ entries: ListedEntry[]; damaged: boolean }>('list', { archive: id, bytes: buffer })
  } catch (error) {
    if (compressed) throw new Error(onlyTar)
    throw error
  }

  if (listed.entries.length === 0) throw new Error(compressed ? onlyTar : 'This archive is empty or cut short.')
  const entries: ArchiveEntry[] = listed.entries.map((entry, index) => ({
    ...entry,
    name: entry.name.replace(/\\/g, '/'),
    method: 0,
    compressedSize: 0,
    offset: index,
  }))
  const extract = async (indices: number[]) => {
    const result = await call<{ entries?: ExtractedEntry[] }>('read', { archive: id, indices })
    return (
      result.entries ??
      (await call<{ entries: ExtractedEntry[] }>('read', { archive: id, indices, bytes: buffer })).entries
    )
  }

  const waiting = new Map<number, { resolve: (data: Uint8Array) => void; reject: (error: Error) => void }[]>()
  let scheduled = false
  const flush = async () => {
    scheduled = false
    const batch = new Map(waiting)
    waiting.clear()
    const settle = (index: number, outcome: { data?: Uint8Array; error?: Error }) => {
      for (const waiter of batch.get(index) ?? []) {
        if (outcome.data) waiter.resolve(outcome.data)
        else waiter.reject(outcome.error ?? new Error('This file could not be unpacked.'))
      }
      batch.delete(index)
    }
    try {
      for (const entry of await extract([...batch.keys()])) {
        if ('data' in entry) keep(`${id}|${entry.index}`, entry.data)
        settle(entry.index, 'data' in entry ? { data: entry.data } : { error: new Error(entry.error) })
      }
      for (const index of [...batch.keys()])
        settle(index, { error: new Error('This file could not be unpacked because the archive is damaged.') })
    } catch (error) {
      for (const index of [...batch.keys()]) settle(index, { error: error as Error })
    }
  }

  return {
    format: compressed ? 'tar' : format,
    entries,
    damaged: listed.damaged,
    read(entry) {
      if (entry.encrypted) return Promise.reject(new Error(`${entry.name} is password protected.`))
      const hit = recall(`${id}|${entry.offset}`)
      if (hit) return Promise.resolve(hit)
      return new Promise((resolve, reject) => {
        const list = waiting.get(entry.offset) ?? []
        list.push({ resolve, reject })
        waiting.set(entry.offset, list)
        if (!scheduled) {
          scheduled = true
          setTimeout(() => void flush(), 0)
        }
      })
    },
  }
}
