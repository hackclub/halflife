// Half Life: Next bundles a worker only when it sees `new Worker(new URL(...))` written out, so this is a factory rather than Vite's `?worker&url` import.
const rasterWorker = (name: string) => new Worker(new URL('./raster.worker.ts', import.meta.url), { name, type: 'module' })
import type { FileSource, HurtFile, ReadOptions } from '../../types'
import { cacheGet, cachePut } from '../../core/cache'
import { isZip, openZip } from '../../core/archive'
import { WorkerClient } from '../../core/workers'
import type { RasterResult } from './raster.worker'
import { isPsd, isXcf } from './magic'

export const RASTER_EXTENSIONS = new Set(['psd', 'psb', 'xcf', 'kra', 'kra~', 'ora'])
const MERGED = ['mergedimage.png', 'preview.png', 'Thumbnails/thumbnail.png']

const worker = new WorkerClient(rasterWorker, 'image decoder')

const pending = new Map<string, Promise<RasterResult>>()

export async function decodeRaster(source: FileSource, file: HurtFile, options: ReadOptions = {}) {
  const key = `${source.id}|${file.path}|raster`
  const cached = await cacheGet<RasterResult>(key)
  if (cached) return cached
  const buffer = await source.read(file.path, options)
  let job = pending.get(key)
  if (!job) {
    job = flatten(buffer)
      .then((result) => {
        void cachePut(key, result, result.blob.size)
        return result
      })
      .finally(() => pending.delete(key))
    pending.set(key, job)
  }
  return job
}

async function flatten(buffer: ArrayBuffer): Promise<RasterResult> {
  const bytes = new Uint8Array(buffer)
  if (isPsd(bytes) || isXcf(bytes)) return worker.call<RasterResult>(isPsd(bytes) ? 'psd' : 'xcf', { bytes: buffer })
  if (!isZip(bytes)) throw new Error('This file is not an image the browser can read.')
  const zip = openZip(buffer)
  const entry = MERGED.map((name) => zip.entries.find((e) => e.name === name)).find(Boolean)
  if (!entry) throw new Error('This file has no flattened image inside.')
  return {
    blob: new Blob([(await zip.read(entry)) as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    note: entry.name === 'mergedimage.png' ? null : 'This is the small preview saved with the file.',
  }
}
