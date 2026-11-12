// Half Life: Next bundles a worker only when it sees `new Worker(new URL(...))` written out, so this is a factory rather than Vite's `?worker&url` import.
const librepcbWorker = (name: string) => new Worker(new URL('./librepcb.worker.ts', import.meta.url), { name, type: 'module' })
import type { FileSource, HurtFile } from '../../types'
import { cacheGet, cachePut, sizeOf } from '../../core/cache'
import { archiveSource } from '../../core/source'
import { WorkerClient } from '../../core/workers'
import type { LibrePcbRender } from './render'

export type { LibrePcbRender, LibrePcbView, LibrePcbViewKind } from './render'

export interface LibrePcbOpened {
  render: LibrePcbRender
  entry: string | null
}

interface LoadOptions {
  signal?: AbortSignal
  onProgress?: (fraction: number | null, message: string) => void
}

const VERSION = 1
const MAX_BYTES = 64 * 1024 * 1024
const MAX_FILES = 6000
const PARALLEL = 8
const PROJECT_FILE = /^(boards|schematics|circuit|project|library)\/.+\.lp$/
const PROJECT_ROOT = /^\s*\(librepcb_(board|schematic)\s/
const ELEMENT_ROOT = /^\s*\(librepcb_(symbol|package)\s/
const worker = new WorkerClient(librepcbWorker, 'LibrePCB reader')
const jobs = new Map<string, Promise<LibrePcbRender>>()

function once(key: string, run: () => Promise<LibrePcbRender>) {
  let job = jobs.get(key)
  if (!job) {
    job = (async () => {
      const cached = await cacheGet<LibrePcbRender>(key)
      if (cached) return cached
      const result = await run()
      await cachePut(key, result, sizeOf(result))
      return result
    })()
    jobs.set(key, job)
    void job.finally(() => jobs.delete(key)).catch(() => undefined)
  }
  return job
}

async function readProject(source: FileSource, root: string, options: LoadOptions) {
  const wanted = source.files
    .filter((f) => f.path.startsWith(root) && PROJECT_FILE.test(f.path.slice(root.length)))
    .slice(0, MAX_FILES)
  const total = wanted.reduce((sum, f) => sum + f.size, 0)
  if (total > MAX_BYTES) throw new Error('This LibrePCB project is too large to draw in the browser.')
  const files: Record<string, ArrayBuffer> = {}
  let next = 0
  let done = 0
  const pull = async () => {
    while (next < wanted.length) {
      const file = wanted[next++]
      files[file.path] = await source.read(file.path, { signal: options.signal })
      options.onProgress?.(++done / wanted.length, 'Downloading the project')
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, pull))
  return files
}

function loadProject(source: FileSource, root: string, options: LoadOptions) {
  return once(`librepcb@${VERSION}|${source.id}|${root}`, async () => {
    const files = await readProject(source, root, options)
    return worker.call<LibrePcbRender>(
      'project',
      { files, root },
      { signal: options.signal, onProgress: (message) => options.onProgress?.(null, message) },
    )
  })
}

function projectRoot(files: HurtFile[]) {
  const circuits = files
    .filter((f) => /(^|\/)circuit\/circuit\.lp$/.test(f.path))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  return circuits[0] ? circuits[0].path.slice(0, -'circuit/circuit.lp'.length) : ''
}

export async function loadLibrePcb(
  source: FileSource,
  file: HurtFile,
  options: LoadOptions = {},
): Promise<LibrePcbOpened | null> {
  if (file.ext === 'lppz') {
    const { source: inner } = await archiveSource(source, file.path, {
      signal: options.signal,
      onProgress: (loaded, total) => options.onProgress?.(total ? loaded / total : null, 'Downloading'),
    })
    return { render: await loadProject(inner, projectRoot(inner.files), options), entry: null }
  }
  if (file.ext === 'lpp') {
    return { render: await loadProject(source, file.dir ? `${file.dir}/` : '', options), entry: null }
  }
  const bytes = await source.read(file.path, {
    signal: options.signal,
    onProgress: (loaded, total) => options.onProgress?.(total ? loaded / total : null, 'Downloading'),
  })
  const head = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 256)))
  if (PROJECT_ROOT.test(head)) {
    const parts = file.path.split('/')
    const root = parts.length > 3 ? `${parts.slice(0, -3).join('/')}/` : ''
    return { render: await loadProject(source, root, options), entry: file.path }
  }
  if (!ELEMENT_ROOT.test(head)) return null
  const render = await once(`librepcb@${VERSION}|${source.id}|${file.path}`, () =>
    worker.call<LibrePcbRender>('element', { bytes }, { signal: options.signal }),
  )
  return { render, entry: null }
}
