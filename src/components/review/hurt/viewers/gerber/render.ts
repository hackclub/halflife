// Half Life: Next bundles a worker only when it sees `new Worker(new URL(...))` written out, so this is a factory rather than Vite's `?worker&url` import.
const gerberWorker = (name: string) => new Worker(new URL('./gerber.worker.ts', import.meta.url), { name, type: 'module' })
import type { FileSource, HurtFile } from '../../types'
import { cacheGet, cachePut, sizeOf } from '../../core/cache'
import { WorkerClient } from '../../core/workers'
import type { GerberRender } from './gerber.worker'
import { gerberBoards } from './sets'

const VERSION = 4
const worker = new WorkerClient(gerberWorker, 'Gerber renderer')
const jobs = new Map<string, Promise<GerberRender>>()

export type { GerberLayer, GerberRender } from './gerber.worker'

function boardKey(source: FileSource, files: HurtFile[]) {
  const names = files
    .map((f) => f.path)
    .sort()
    .join('\n')
  let hash = 2166136261
  for (let i = 0; i < names.length; i++) hash = Math.imul(hash ^ names.charCodeAt(i), 16777619)
  return `gerber@${VERSION}|${source.id}|${(hash >>> 0).toString(36)}`
}

export function gerberSet(source: FileSource, file: HurtFile) {
  return gerberBoards(source.files).find((board) => board.files.includes(file))
}

export async function renderBoard(source: FileSource, files: HurtFile[], onProgress?: (message: string) => void) {
  const key = boardKey(source, files)
  const cached = await cacheGet<GerberRender>(key)
  if (cached) return cached
  let job = jobs.get(key)
  if (!job) {
    job = (async () => {
      onProgress?.('Downloading layers')
      const loaded = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: await source.read(f.path) })))
      const result = await worker.call<GerberRender>('render', { files: loaded }, { onProgress })
      await cachePut(key, result, sizeOf(result))
      return result
    })()
    jobs.set(key, job)
    void job.finally(() => jobs.delete(key)).catch(() => undefined)
  }
  return job
}
