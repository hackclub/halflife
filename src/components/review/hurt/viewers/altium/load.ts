// Half Life: Next bundles a worker only when it sees `new Worker(new URL(...))` written out, so this is a factory rather than Vite's `?worker&url` import.
const altiumWorker = (name: string) => new Worker(new URL('./altium.worker.ts', import.meta.url), { name, type: 'module' })
import type { FileSource, HurtFile } from '../../types'
import { cacheGet, cachePut, sizeOf } from '../../core/cache'
import { WorkerClient } from '../../core/workers'
import type { PcbModel } from './pcb'
import type { SchResult } from './schematic'

export type AltiumResult = SchResult | PcbModel

const VERSION = 1
const worker = new WorkerClient(altiumWorker, 'Altium reader')

export function isAltiumSchematic(file: HurtFile) {
  return file.ext === 'schdoc'
}

export async function loadAltium(
  source: FileSource,
  file: HurtFile,
  options: { signal?: AbortSignal; onProgress?: (fraction: number | null, message: string) => void } = {},
) {
  const key = `altium@${VERSION}|${source.id}|${file.path}`
  const cached = await cacheGet<AltiumResult>(key)
  if (cached) return cached
  const bytes = await source.read(file.path, {
    signal: options.signal,
    onProgress: (loaded, total) => options.onProgress?.(total ? loaded / total : null, 'Downloading'),
  })
  const result = await worker.call<AltiumResult>(
    'parse',
    { bytes, name: file.name, schematic: isAltiumSchematic(file) },
    { signal: options.signal, onProgress: (message) => options.onProgress?.(null, message) },
  )
  void cachePut(key, result, sizeOf(result))
  return result
}
