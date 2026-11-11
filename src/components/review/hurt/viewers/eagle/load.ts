// Half Life: Next bundles a worker only when it sees `new Worker(new URL(...))` written out, so this is a factory rather than Vite's `?worker&url` import.
const eagleWorker = (name: string) => new Worker(new URL('./eagle.worker.ts', import.meta.url), { name, type: 'module' })
import type { FileSource, HurtFile } from '../../types'
import { cacheGet, cachePut, sizeOf } from '../../core/cache'
import { WorkerClient } from '../../core/workers'
import type { EagleRender } from './render'

const VERSION = 3
const MAX_BYTES = 64 * 1024 * 1024
const worker = new WorkerClient(eagleWorker, 'Eagle renderer')
const jobs = new Map<string, Promise<EagleRender>>()

export type { EaglePart, EagleRender, EagleSheet, EagleLayerSvg } from './render'

export async function renderEagle(source: FileSource, file: HurtFile, onProgress?: (message: string) => void) {
  if (file.size > MAX_BYTES) throw new Error('This Eagle file is too large to draw in the browser.')
  const key = `eagle@${VERSION}|${source.id}|${file.path}`
  const cached = await cacheGet<EagleRender>(key)
  if (cached) return cached
  let job = jobs.get(key)
  if (!job) {
    job = (async () => {
      const bytes = await source.read(file.path)
      const result = await worker.call<EagleRender>('render', { bytes }, { onProgress })
      await cachePut(key, result, sizeOf(result))
      return result
    })()
    jobs.set(key, job)
    void job.finally(() => jobs.delete(key)).catch(() => undefined)
  }
  return job
}
