import type * as THREE from 'three'
// Half Life: Next bundles a worker only when it sees `new Worker(new URL(...))` written out, so this is a factory rather than Vite's `?worker&url` import.
const modelWorker = (name: string) => new Worker(new URL('./model.worker.ts', import.meta.url), { name, type: 'module' })
import type { FileSource, HurtFile } from '../../types'
import { cacheGet, cachePut, sizeOf } from '../../core/cache'
import { WorkerClient } from '../../core/workers'
import { formatBytes } from '../../core/format'
import { importWithThree } from './meshImport'
import type { ModelData, ModelHistory } from './analyze'
import { THREEMF_UNSUPPORTED } from './threemf'
import { OCCT_LIMIT } from './server'

const VERSION = 12
const RESTART_AFTER_BYTES = 20e6
const SLOW_BYTES = 30e6
const SPEED_KEY = 'hurt:read-speed'
const SERVER_MS_PER_MB = 1000
const SERVER_MS = 5000
const TASKS: Record<string, string> = {
  step: 'occt',
  stp: 'occt',
  iges: 'occt',
  igs: 'occt',
  brep: 'occt',
  brp: 'occt',
  fcstd: 'fcstd',
  fcbak: 'fcstd',
  fcstd1: 'fcstd',
  stl: 'stl',
  '3mf': '3mf',
  blend: 'blend',
  blend1: 'blend',
  f3d: 'fusion',
  f3z: 'fusion',
  x_t: 'parasolid',
  x_b: 'parasolid',
  xmt_txt: 'parasolid',
  xmt_bin: 'parasolid',
  sldprt: 'parasolid',
  dwg: 'dwg',
}

const lanes = {
  interactive: new WorkerClient(modelWorker, 'model reader'),
  background: new WorkerClient(modelWorker, 'background model reader'),
  history: new WorkerClient(modelWorker, 'design history builder'),
}

type Lane = keyof typeof lanes
type Progress = (fraction: number | null, message?: string) => void

type Job = { promise: Promise<unknown>; controller: AbortController; holders: number }

const jobs = new Map<string, Job>()
const needsServer = new Set<string>()
const TOO_BIG = /too (?:large|big) for the (?:in-browser reader|browser)/i
const watchers = new Map<string, Set<Progress>>()

export function canPrepareModel(file: HurtFile) {
  return file.kind === 'model' && file.ext in TASKS
}

export function needsThree(error: unknown) {
  return error instanceof Error && error.message === THREEMF_UNSUPPORTED
}

function modelKey(source: FileSource, file: HurtFile) {
  return `model@${VERSION}|${source.id}|${file.path}`
}

export async function prepareModel(
  source: FileSource,
  file: HurtFile,
  { lane = 'interactive', signal, progress }: { lane?: Lane; signal?: AbortSignal; progress?: Progress } = {},
): Promise<ModelData> {
  const key = modelKey(source, file)
  const cached = await cacheGet<ModelData>(key)
  if (cached) return cached

  const convert = TASKS[file.ext] === 'occt' ? source.convert : undefined
  const onServer = () =>
    shared(`${key}|server`, signal, progress, (controller, notify) =>
      convertModel(source, file, key, convert!, lanes[lane], controller, notify),
    )
  if (convert && (file.size > OCCT_LIMIT || needsServer.has(key))) return onServer()
  try {
    return await shared(key, signal, progress, (controller, notify) =>
      readModel(source, file, key, lanes[lane], controller, notify),
    )
  } catch (error) {
    if (TASKS[file.ext] !== 'occt' || !TOO_BIG.test(error instanceof Error ? error.message : '')) throw error
    needsServer.add(key)
    if (!convert) throw error
    return onServer()
  }
}

async function shared<T>(
  key: string,
  signal: AbortSignal | undefined,
  progress: Progress | undefined,
  start: (controller: AbortController, notify: Progress) => Promise<T>,
) {
  if (progress) {
    const set = watchers.get(key) ?? new Set()
    set.add(progress)
    watchers.set(key, set)
  }
  let job = jobs.get(key)
  if (!job || job.controller.signal.aborted) {
    const controller = new AbortController()
    const notify: Progress = (fraction, message) => watchers.get(key)?.forEach((watch) => watch(fraction, message))
    const created: Job = { promise: start(controller, notify), controller, holders: 0 }
    job = created
    jobs.set(key, created)
    void created.promise
      .finally(() => {
        if (jobs.get(key) !== created) return
        jobs.delete(key)
        watchers.delete(key)
      })
      .catch(() => undefined)
  }
  const held = job
  held.holders++
  try {
    return (await abortable(held.promise, signal)) as T
  } finally {
    if (progress) watchers.get(key)?.delete(progress)
    if (signal?.aborted && --held.holders === 0) held.controller.abort()
  }
}

async function readModel(
  source: FileSource,
  file: HurtFile,
  key: string,
  client: WorkerClient,
  controller: AbortController,
  notify: Progress,
) {
  const task = TASKS[file.ext]
  if (task === 'occt' && file.size > OCCT_LIMIT) throw tooLarge(file.size)
  const bytes = await source.read(file.path, {
    signal: controller.signal,
    onProgress: (loaded, total) => notify(total ? loaded / total : null, 'Downloading'),
  })
  checkContent(bytes)
  if (task === 'occt' && bytes.byteLength > OCCT_LIMIT) throw tooLarge(bytes.byteLength)
  const slow = task !== 'stl' && bytes.byteLength > SLOW_BYTES
  notify(null, 'Processing')
  let estimate: Estimate | null = null
  let expected = 0
  const finish = () => {
    if (estimate) learnSpeed(estimate.stop() / expected)
    estimate = null
  }
  const model = await client
    .call<ModelData>(
      task,
      { bytes, ext: file.ext, name: file.name.slice(0, file.name.length - file.ext.length - 1) },
      {
        signal: controller.signal,
        onProgress: (message, expect) => {
          finish()
          if (!expect)
            return notify(
              null,
              slow ? `${message}. This ${formatBytes(bytes.byteLength)} model can take several minutes.` : message,
            )
          expected = expect
          estimate = estimated(notify, expect * readSpeed())
          estimate.update(message)
        },
      },
    )
    .finally(() => estimate?.stop())
  if (bytes.byteLength > RESTART_AFTER_BYTES && !client.busy) client.restart()
  await cachePut(key, model, sizeOf(model))
  return model
}

export async function loadModelHistory(
  source: FileSource,
  file: HurtFile,
  { signal, progress }: { signal?: AbortSignal; progress?: Progress } = {},
): Promise<ModelHistory> {
  const key = `history@${VERSION}|${source.id}|${file.path}`
  const cached = await cacheGet<ModelHistory>(key)
  if (cached) return cached
  return shared(key, signal, progress, async (controller, notify) => {
    const bytes = await source.read(file.path, { signal: controller.signal })
    let estimate: Estimate | null = null
    const history = await lanes.history
      .call<ModelHistory>(
        'fusionHistory',
        { bytes, name: file.name.slice(0, file.name.length - file.ext.length - 1) },
        {
          signal: controller.signal,
          onProgress: (message, expect) => {
            estimate?.stop()
            estimate = expect ? estimated(notify, expect * readSpeed()) : null
            if (estimate) estimate.update(message)
            else notify(null, message)
          },
        },
      )
      .finally(() => estimate?.stop())
    await cachePut(key, history, sizeOf(history))
    return history
  })
}

async function convertModel(
  source: FileSource,
  file: HurtFile,
  key: string,
  convert: NonNullable<FileSource['convert']>,
  client: WorkerClient,
  controller: AbortController,
  notify: Progress,
) {
  const estimate = estimated(notify, (SERVER_MS_PER_MB * file.size) / 1e6 + SERVER_MS)
  estimate.update('Too big for the browser, so converting it on the server')
  const bytes = await convert(file.path, { signal: controller.signal, onStatus: estimate.update }).finally(
    estimate.stop,
  )
  const imported = await importWithThree(source, { ...file, ext: 'glb' }, bytes, {
    signal: controller.signal,
    progress: notify,
  })
  const model = await client.call<ModelData>(
    'analyze',
    {
      parts: imported.parts,
      root: imported.root,
      meta: {
        unit: 'mm',
        upAxis: 'y',
        warnings: ['Converted on the server, because it is too big for the in-browser reader.'],
      },
    },
    { signal: controller.signal, onProgress: (message) => notify(null, message) },
  )
  await cachePut(key, model, sizeOf(model))
  return model
}

export async function loadModel(
  source: FileSource,
  file: HurtFile,
  options: { signal: AbortSignal; progress: Progress },
): Promise<{ model: ModelData; materials?: (THREE.Material | null)[] }> {
  if (canPrepareModel(file))
    try {
      return { model: await prepareModel(source, file, options) }
    } catch (error) {
      if (!needsThree(error)) throw error
    }
  const bytes = await source.read(file.path, {
    signal: options.signal,
    onProgress: (loaded, total) => options.progress(total ? loaded / total : null, 'Downloading'),
  })
  checkContent(bytes)
  const imported = await importWithThree(source, file, bytes, options)
  const model = await lanes.interactive.call<ModelData>(
    'analyze',
    {
      parts: imported.parts,
      root: imported.root,
      meta: { unit: imported.unit, upAxis: imported.upAxis, warnings: [] },
    },
    { onProgress: (message) => options.progress(null, message) },
  )
  options.signal.throwIfAborted()
  return { model, materials: imported.materials }
}

type Estimate = ReturnType<typeof estimated>

function estimated(notify: Progress, total: number) {
  const start = performance.now()
  let message = ''
  const tick = () => {
    const fraction = (performance.now() - start) / total
    notify(fraction < 1 ? fraction : null, message)
  }
  const timer = window.setInterval(tick, 500)
  return {
    update: (next: string) => {
      message = next
      tick()
    },
    stop: () => {
      window.clearInterval(timer)
      return performance.now() - start
    },
  }
}

function readSpeed() {
  try {
    return Number(localStorage.getItem(SPEED_KEY)) || 1
  } catch {
    return 1
  }
}

function learnSpeed(ratio: number) {
  try {
    localStorage.setItem(SPEED_KEY, String(readSpeed() * 0.7 + Math.min(4, Math.max(0.25, ratio)) * 0.3))
  } catch {}
}

function checkContent(bytes: ArrayBuffer) {
  if (bytes.byteLength > 64) return
  if (new Uint8Array(bytes).every((b) => b === 0x09 || b === 0x0a || b === 0x0d || b === 0x20))
    throw new Error(`This file is empty (${formatBytes(bytes.byteLength)}). The export or upload probably failed.`)
}

function tooLarge(size: number) {
  return new Error(
    `This model is ${formatBytes(size)}, too large for the in-browser reader. Download it to open it in CAD.`,
  )
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'))
      if (signal.aborted) abort()
      signal.addEventListener('abort', abort, { once: true })
    }),
  ])
}
