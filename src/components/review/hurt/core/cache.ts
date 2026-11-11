const DB_NAME = 'fabricate-hurt'
const DB_VERSION = 1
const META = 'meta'
const DATA = 'data'
const MAX_DISK_BYTES = 3 * 1024 ** 3
const TOUCH_AFTER_MS = 10 * 60 * 1000

interface Meta {
  key: string
  size: number
  at: number
}

const memory = new Map<string, { value: unknown; size: number }>()
let memoryBytes = 0
const deviceGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
const memoryBudget = Math.min(768, Math.max(128, deviceGb * 48)) * 1024 * 1024

let database: Promise<IDBDatabase | null> | null = null
let pruneTimer: number | undefined

function open(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA)
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return database
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function remember(key: string, value: unknown, size: number) {
  if (size > memoryBudget / 3) return
  const previous = memory.get(key)
  if (previous) memoryBytes -= previous.size
  memory.delete(key)
  memory.set(key, { value, size })
  memoryBytes += size
  for (const [oldKey, entry] of memory) {
    if (memoryBytes <= memoryBudget) break
    memory.delete(oldKey)
    memoryBytes -= entry.size
  }
}

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const hot = memory.get(key)
  if (hot) {
    memory.delete(key)
    memory.set(key, hot)
    return hot.value as T
  }
  const db = await open()
  if (!db) return undefined
  try {
    const tx = db.transaction([DATA, META], 'readonly')
    const [value, meta] = await Promise.all([
      result(tx.objectStore(DATA).get(key)) as Promise<T | undefined>,
      result(tx.objectStore(META).get(key)) as Promise<Meta | undefined>,
    ])
    if (value === undefined || !meta) return undefined
    remember(key, value, meta.size)
    if (Date.now() - meta.at > TOUCH_AFTER_MS) void touch(db, meta)
    return value
  } catch {
    return undefined
  }
}

export async function cacheHas(key: string) {
  if (memory.has(key)) return true
  const db = await open()
  if (!db) return false
  try {
    return (await result(db.transaction(META, 'readonly').objectStore(META).getKey(key))) !== undefined
  } catch {
    return false
  }
}

export async function cachePut(key: string, value: unknown, size: number) {
  remember(key, value, size)
  const db = await open()
  if (!db || size > MAX_DISK_BYTES / 4) return
  try {
    const tx = db.transaction([DATA, META], 'readwrite')
    tx.objectStore(DATA).put(value, key)
    tx.objectStore(META).put({ key, size, at: Date.now() } satisfies Meta)
    await done(tx)
    window.clearTimeout(pruneTimer)
    pruneTimer = window.setTimeout(() => void prune(), 5000)
  } catch {
    // Quota or private browsing: the in-memory copy still serves this session.
  }
}

async function touch(db: IDBDatabase, meta: Meta) {
  try {
    const tx = db.transaction(META, 'readwrite')
    tx.objectStore(META).put({ ...meta, at: Date.now() })
    await done(tx)
  } catch {
    // A stale timestamp only makes this entry the first to be pruned.
  }
}

async function prune() {
  const db = await open()
  if (!db) return
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
  const budget = Math.min(MAX_DISK_BYTES, (estimate?.quota ?? MAX_DISK_BYTES * 4) / 4)
  const metas = (await result(db.transaction(META, 'readonly').objectStore(META).getAll())) as Meta[]
  metas.sort((a, b) => b.at - a.at)
  let total = 0
  const stale: string[] = []
  for (const meta of metas) {
    total += meta.size
    if (total > budget) stale.push(meta.key)
  }
  if (stale.length === 0) return
  const tx = db.transaction([DATA, META], 'readwrite')
  for (const key of stale) {
    tx.objectStore(DATA).delete(key)
    tx.objectStore(META).delete(key)
  }
  await done(tx).catch(() => undefined)
}

export function sizeOf(value: unknown, seen = new Set<unknown>()): number {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return 0
    seen.add(value)
  }
  if (value instanceof ArrayBuffer) return value.byteLength
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (typeof value === 'string') return value.length * 2
  if (Array.isArray(value)) return value.reduce((sum: number, item) => sum + sizeOf(item, seen), 0)
  if (value && typeof value === 'object')
    return Object.values(value).reduce((sum: number, item) => sum + sizeOf(item, seen), 64)
  return 8
}
