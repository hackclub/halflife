import { useSyncExternalStore } from 'react'
import type { FileSource, ReadOptions, SnapshotData } from '../types'
import { cacheGet, cacheHas, cachePut } from './cache'
import { makeFile } from './classify'
import { formatBytes } from './format'
import { isHiddenPath, openArchive, type Archive } from './archive'

const RAW = 'https://raw.githubusercontent.com'
const MEDIA = 'https://media.githubusercontent.com/media'
const LFS_POINTER = 'version https://git-lfs.github.com/spec/'
const POINTER_MIN = 100
const POINTER_MAX = 1024
const LFS_PROBE_LIMIT = 1000
const LFS_PROBE_CONCURRENCY = 6
const LINK_DEPTH = 4
const BYTE_CACHE_LIMIT = 200 * 1024 * 1024
const HEAD_THRESHOLD = 1024 * 1024
const STALL_MS = 30 * 1000

const inflight = new Map<string, Promise<ArrayBuffer>>()

class HurtError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

interface Pointer {
  size: number
  oid: string | null
}

const sizeListeners = new Set<() => void>()
let sizeVersion = 0
let sizeTimer = 0

function sizesChanged() {
  if (sizeTimer) return
  sizeTimer = window.setTimeout(() => {
    sizeTimer = 0
    sizeVersion++
    sizeListeners.forEach((listener) => listener())
  }, 100)
}

function subscribeSizes(listener: () => void) {
  sizeListeners.add(listener)
  return () => sizeListeners.delete(listener)
}

export function useSizeVersion() {
  return useSyncExternalStore(subscribeSizes, () => sizeVersion)
}

function encodePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function repoSource(snapshot: SnapshotData): FileSource {
  const files = snapshot.files.filter((f) => !isHiddenPath(f.path)).map((f) => makeFile(f.path, f.size, f.submodule))
  const byPath = new Map(files.map((f) => [f.path, f]))
  const blobSizes = new Map(snapshot.files.map((f) => [f.path, f.size]))
  const pointers = new Map<string, Pointer>()
  const probes = new Map<string, Promise<Pointer | ArrayBuffer | null>>()
  const id = `gh:${snapshot.repo}@${snapshot.sha}`
  const keyOf = (path: string) => `${id}|${path}`
  const url = (host: string, path: string) => `${host}/${snapshot.repo}/${snapshot.sha}/${encodePath(path)}`

  const setSize = (path: string, size: number) => {
    const file = byPath.get(path)
    if (!file || file.size === size) return
    file.size = size
    sizesChanged()
  }

  const notePointer = (path: string, pointer: Pointer | null) => {
    if (!pointer) return null
    pointers.set(path, pointer)
    setSize(path, pointer.size)
    return pointer
  }

  const mightBePointer = (path: string) => {
    const size = blobSizes.get(path) ?? 0
    return size >= POINTER_MIN && size <= POINTER_MAX
  }

  const noteContent = (path: string, bytes: ArrayBuffer) => {
    const blob = blobSizes.get(path)
    if (blob === undefined || bytes.byteLength === blob || pointers.has(path)) return
    notePointer(path, { size: bytes.byteLength, oid: null })
  }

  const probe = (path: string, signal?: AbortSignal) => {
    const known = pointers.get(path)
    if (known) return Promise.resolve(known)
    if (!mightBePointer(path)) return Promise.resolve(null)
    let pending = probes.get(path)
    if (!pending) {
      pending = (async () => {
        const key = keyOf(path)
        const cached = await cacheGet<ArrayBuffer>(key)
        if (cached) {
          noteContent(path, cached)
          return pointers.get(path) ?? cached
        }
        const bytes = await download(key, url(RAW, path), blobSizes.get(path))
        const pointer = notePointer(path, parsePointer(bytes))
        if (pointer) return pointer
        void cachePut(key, bytes, bytes.byteLength)
        return bytes
      })()
      probes.set(path, pending)
      pending.catch(() => probes.delete(path))
    }
    if (!signal) return pending
    return raceAbort(pending, signal)
  }

  const linkTarget = (path: string, bytes: ArrayBuffer | Uint8Array) => {
    const file = byPath.get(path)
    if (!file?.ext || bytes.byteLength > POINTER_MAX || bytes.byteLength !== blobSizes.get(path)) return null
    const text = new TextDecoder().decode(bytes)
    if (!text || /[\0\n\r]/.test(text)) return null
    const target = resolvePath(file.dir, text)
    return target !== path && byPath.get(target)?.ext === file.ext ? target : null
  }

  const load = async (path: string) => {
    const key = keyOf(path)
    let pointer = pointers.get(path) ?? null
    if (!pointer) {
      const bytes = await download(key, url(RAW, path), blobSizes.get(path))
      pointer = bytes.byteLength <= POINTER_MAX ? notePointer(path, parsePointer(bytes)) : null
      if (!pointer) return bytes
    }
    return download(key, url(MEDIA, path), pointer.size, pointer.oid).catch((error) => {
      throw lfsError(path, error)
    })
  }

  const read = async (path: string, options?: ReadOptions, depth = 0): Promise<ArrayBuffer> => {
    const bytes = await cachedRead(keyOf(path), options, () => load(path))
    const target = depth < LINK_DEPTH ? linkTarget(path, bytes) : null
    if (target) {
      const linked = await read(target, options, depth + 1)
      setSize(path, linked.byteLength)
      return linked
    }
    noteContent(path, bytes)
    return bytes
  }

  const head = async (path: string, length: number, options?: ReadOptions, depth = 0): Promise<Uint8Array> => {
    const signal = options?.signal
    let bytes: Uint8Array
    const found = (await cacheGet<ArrayBuffer>(keyOf(path))) ?? (await probe(path, signal))
    if (found instanceof ArrayBuffer) {
      noteContent(path, found)
      bytes = new Uint8Array(found, 0, Math.min(length, found.byteLength))
    } else if (found) {
      return downloadHead(url(MEDIA, path), length, signal).catch((error) => {
        throw lfsError(path, error)
      })
    } else {
      bytes = await downloadHead(url(RAW, path), length, signal)
    }
    const target = depth < LINK_DEPTH ? linkTarget(path, bytes) : null
    return target ? head(target, length, options, depth + 1) : bytes
  }

  let resolving: Promise<void> | null = null
  const resolveSizes = () =>
    (resolving ??= (async () => {
      const attributes = files.filter((f) => f.name === '.gitattributes')
      const texts = await Promise.all(
        attributes.map((f) =>
          read(f.path).then(
            (bytes) => new TextDecoder().decode(bytes),
            () => '',
          ),
        ),
      )
      if (!texts.some((text) => /filter=lfs/.test(text))) return
      const candidates = files
        .filter((f) => f.kind !== 'submodule' && mightBePointer(f.path))
        .sort((a, b) => Number(a.kind === 'text') - Number(b.kind === 'text'))
        .slice(0, LFS_PROBE_LIMIT)
      let next = 0
      const worker = async () => {
        while (next < candidates.length) await probe(candidates[next++].path).catch(() => null)
      }
      await Promise.all(Array.from({ length: LFS_PROBE_CONCURRENCY }, worker))
    })())

  const lfsSize = async (path: string, signal?: AbortSignal) => {
    if (!mightBePointer(path) || (await cacheHas(keyOf(path)))) return null
    const found = await probe(path, signal)
    return found && !(found instanceof ArrayBuffer) ? found.size : null
  }

  return {
    id,
    label: snapshot.repo,
    files,
    byPath,
    rawUrl: (path) => url(pointers.has(path) ? MEDIA : RAW, path),
    webUrl: (path) => `https://github.com/${snapshot.repo}/blob/${snapshot.sha}/${encodePath(path)}`,
    read: (path, options) => read(path, options),
    head: (path, length, options) => head(path, length, options),
    resolveSizes,
    lfsSize,
  }
}

export async function readHead(source: FileSource, path: string, length: number, options?: ReadOptions) {
  const size = source.byPath.get(path)?.size ?? 0
  if (source.head && (size > Math.max(length, HEAD_THRESHOLD) || (size >= POINTER_MIN && size <= POINTER_MAX))) {
    try {
      return await source.head(path, length, options)
    } catch {
      options?.signal?.throwIfAborted()
    }
  }
  return new Uint8Array(await source.read(path, options))
}

export async function archiveSource(parent: FileSource, path: string, options?: ReadOptions) {
  const archive = await loadArchive(parent, path, options)
  const listed = archive.entries.filter((e) => !e.dir)
  const files = listed.map((e) => makeFile(e.name, e.size))
  const entries = new Map(listed.map((e) => [e.name, e]))
  const id = `${parent.id}|${path}`
  let recent: { inner: string; bytes: Promise<ArrayBuffer> } | null = null
  return {
    archive,
    source: {
      id,
      label: path.split('/').pop() ?? path,
      files,
      byPath: new Map(files.map((f) => [f.path, f])),
      read: (inner: string) => {
        if (recent?.inner === inner) return recent.bytes
        const entry = entries.get(inner)
        if (!entry) return Promise.reject(new HurtError(`${inner} is not in this archive.`))
        const bytes = archive
          .read(entry)
          .then((data) =>
            data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
              ? (data.buffer as ArrayBuffer)
              : (data.slice().buffer as ArrayBuffer),
          )
        recent = { inner, bytes }
        bytes.catch(() => {
          if (recent?.bytes === bytes) recent = null
        })
        return bytes
      },
    } satisfies FileSource,
  }
}

const archives = new Map<string, Promise<Archive>>()

function loadArchive(source: FileSource, path: string, options?: ReadOptions) {
  const key = `${source.id}|${path}`
  let archive = archives.get(key)
  if (!archive) {
    archive = source.read(path, { onProgress: options?.onProgress }).then((buffer) => openArchive(buffer, path))
    archive.catch(() => archives.delete(key))
    archives.set(key, archive)
    if (archives.size > 8) archives.delete(archives.keys().next().value!)
  }
  return archive
}

type ProgressListener = (loaded: number, total: number) => void
const listeners = new Map<string, Set<ProgressListener>>()

function raceAbort<T>(pending: Promise<T>, signal: AbortSignal) {
  return Promise.race([
    pending,
    new Promise<never>((_, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'))
      if (signal.aborted) abort()
      signal.addEventListener('abort', abort, { once: true })
    }),
  ])
}

async function cachedRead(key: string, options: ReadOptions | undefined, load: () => Promise<ArrayBuffer>) {
  const cached = await cacheGet<ArrayBuffer>(key)
  if (cached) {
    options?.onProgress?.(cached.byteLength, cached.byteLength)
    return cached
  }
  let pending = inflight.get(key)
  if (!pending) {
    pending = load().then((bytes) => {
      if (bytes.byteLength <= BYTE_CACHE_LIMIT) void cachePut(key, bytes, bytes.byteLength)
      return bytes
    })
    inflight.set(key, pending)
    void pending.finally(() => inflight.delete(key)).catch(() => undefined)
  }
  const onProgress = options?.onProgress
  if (onProgress) {
    const set = listeners.get(key) ?? new Set()
    set.add(onProgress)
    listeners.set(key, set)
  }
  const stop = () => {
    if (onProgress) listeners.get(key)?.delete(onProgress)
  }
  const signal = options?.signal
  return (signal ? raceAbort(pending, signal) : pending).finally(stop)
}

async function download(key: string, url: string, expected?: number, oid?: string | null): Promise<ArrayBuffer> {
  const notify = (loaded: number, total: number) => listeners.get(key)?.forEach((listener) => listener(loaded, total))
  const controller = new AbortController()
  let idle = 0
  const touch = () => {
    window.clearTimeout(idle)
    idle = window.setTimeout(() => controller.abort(), STALL_MS)
  }
  touch()
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal })
    if (!response.ok) throw new HurtError(`GitHub answered ${response.status} for this file.`, response.status)
    const bytes = response.body
      ? await collect(response.body, expected ?? 0, touch, notify)
      : await response.arrayBuffer()
    if (expected !== undefined && bytes.byteLength !== expected)
      throw new HurtError(
        `GitHub sent ${formatBytes(bytes.byteLength)} of ${formatBytes(expected)} for this file. Try again.`,
      )
    if (oid && bytes.byteLength <= BYTE_CACHE_LIMIT && crypto.subtle && (await sha256(bytes)) !== oid)
      throw new HurtError('GitHub sent a file that does not match its Git LFS checksum. Try again.')
    return bytes
  } catch (error) {
    if (controller.signal.aborted) throw new HurtError('GitHub stopped sending this file. Try again.')
    throw error
  } finally {
    window.clearTimeout(idle)
  }
}

async function collect(
  body: ReadableStream<Uint8Array>,
  expected: number,
  touch: () => void,
  notify: (loaded: number, total: number) => void,
) {
  const reader = body.getReader()
  let capacity = Math.max(expected, 64 * 1024)
  let buffer = new Uint8Array(capacity)
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    touch()
    if (loaded + value.byteLength > capacity) {
      capacity = Math.max(capacity * 2, loaded + value.byteLength)
      const grown = new Uint8Array(capacity)
      grown.set(buffer.subarray(0, loaded))
      buffer = grown
    }
    buffer.set(value, loaded)
    loaded += value.byteLength
    notify(loaded, Math.max(expected, loaded))
  }
  return loaded === buffer.byteLength ? buffer.buffer : buffer.slice(0, loaded).buffer
}

async function downloadHead(url: string, length: number, signal?: AbortSignal) {
  const response = await fetch(url, { credentials: 'omit', headers: { Range: `bytes=0-${length - 1}` }, signal })
  if (!response.ok) throw new HurtError(`GitHub answered ${response.status} for this file.`, response.status)
  if (response.status === 206 || !response.body) return new Uint8Array(await response.arrayBuffer()).subarray(0, length)
  const reader = response.body.getReader()
  const buffer = new Uint8Array(length)
  let loaded = 0
  while (loaded < length) {
    const { done, value } = await reader.read()
    if (done) break
    const take = Math.min(value.byteLength, length - loaded)
    buffer.set(value.subarray(0, take), loaded)
    loaded += take
  }
  void reader.cancel().catch(() => undefined)
  return buffer.subarray(0, loaded)
}

function lfsError(path: string, error: unknown) {
  const status = error instanceof HurtError ? error.status : undefined
  if (status === 404)
    return new HurtError(
      `${path} is stored in Git LFS, but GitHub has no copy of it. It was probably never uploaded with git lfs push.`,
      404,
    )
  if (status === 403 || status === 429)
    return new HurtError(
      `GitHub refused to serve ${path} from Git LFS (${status}), usually because of a bandwidth or rate limit. Try again later.`,
      status,
    )
  if (error instanceof HurtError && status === undefined) return error
  return new HurtError(
    `${path} is stored in Git LFS and GitHub would not hand it over${status ? ` (${status})` : ''}.`,
    status,
  )
}

function parsePointer(bytes: ArrayBuffer | Uint8Array): Pointer | null {
  if (bytes.byteLength > POINTER_MAX) return null
  const text = new TextDecoder().decode(bytes)
  if (!text.startsWith(LFS_POINTER)) return null
  const size = text.match(/^size (\d+)$/m)?.[1]
  if (!size) return null
  return { size: Number(size), oid: text.match(/^oid sha256:([0-9a-f]{64})$/m)?.[1] ?? null }
}

async function sha256(bytes: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function resolvePath(from: string, target: string) {
  const parts = from ? from.split('/') : []
  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}
