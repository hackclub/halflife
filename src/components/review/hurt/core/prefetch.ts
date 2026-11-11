import { useSyncExternalStore } from 'react'
import type { FileSource, HurtFile } from '../types'
import { loadRepo, shipEndpoints } from './api'
import {
  bomPagesVersion,
  isBackup,
  isBomPage,
  isLibraryPath,
  namedLikeBomPage,
  noteBomPage,
  pageSniffed,
  pinnedGroups,
} from './classify'
import { readHead } from './source'
import { detectEda } from './eda'
import { isBomHtml, SNIFF_BYTES } from '../viewers/ibom/sniff'
import { gerberBoards, type GerberBoardSet } from '../viewers/gerber/sets'
import { convertsOnServer } from '../viewers/model/server'

export type PrepStatus = 'queued' | 'working' | 'ready' | 'failed'

interface Job {
  source: string
  keys: string[]
  rank: number
  cpu: boolean
  run: () => Promise<unknown>
}

const MAX_FILE_BYTES = 150 * 1024 * 1024
const MAX_REPO_BYTES = 750 * 1024 * 1024
const PAGE_SNIFF_LIMIT = 60
const PAGE_SNIFF_CONCURRENCY = 4
const MAX_FILES = 400
const MAX_CAD_SOURCE_BYTES = 4 * 1024 * 1024
const MAX_BLEND_BYTES = 50 * 1024 * 1024
const STALE_RANK = 2
const NETWORK_SLOTS = 4
const CPU_SLOTS = 1
const SKIP_KINDS = new Set(['submodule', 'video', 'audio'])

const statuses = new Map<string, PrepStatus>()
const listeners = new Set<() => void>()
const planned = new Map<string, number>()
const queue: Job[] = []
let active = { net: 0, cpu: 0 }
let version = 0

function notify() {
  version++
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePrepVersion() {
  return useSyncExternalStore(subscribe, () => version)
}

export function usePrepStatus(source: FileSource, path: string) {
  return useSyncExternalStore(subscribe, () => statuses.get(`${source.id}|${path}`))
}

export function useBomPagesVersion() {
  return useSyncExternalStore(subscribe, bomPagesVersion)
}

export function noteSniffedPage(file: HurtFile, bom: boolean) {
  if (noteBomPage(file, bom)) notify()
}

export function prepStatus(source: FileSource, path: string) {
  return statuses.get(`${source.id}|${path}`)
}

export function prepSummary(source: FileSource) {
  let total = 0
  let ready = 0
  let failed = 0
  const prefix = `${source.id}|`
  for (const [key, status] of statuses) {
    if (!key.startsWith(prefix)) continue
    total++
    if (status === 'ready') ready++
    if (status === 'failed') failed++
  }
  return { total, ready, failed, pending: total - ready - failed }
}

function allowed() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection
  return !connection?.saveData && !/(^|-)2g$/.test(connection?.effectiveType ?? '')
}

export async function preprocessShip(shipId: string, rank = 0) {
  if (!allowed()) return
  const { source } = await loadRepo(shipEndpoints(shipId))
  preprocess(source, rank)
}

function rerank(id: string, rank: number) {
  planned.set(id, rank)
  for (const job of queue) if (job.source === id) job.rank = rank * 1e6 + (job.rank % 1e6)
  queue.sort((a, b) => a.rank - b.rank)
}

export function preprocess(source: FileSource, rank = 0) {
  if (rank === 0) for (const [id, r] of planned) if (id !== source.id && r === 0) rerank(id, STALE_RANK)
  const previous = planned.get(source.id)
  if (previous !== undefined) {
    if (rank < previous) rerank(source.id, rank)
    return
  }
  planned.set(source.id, rank)
  void Promise.all([Promise.resolve(source.resolveSizes?.()).catch(() => undefined), sniffPages(source)]).then(() =>
    plan(source),
  )
}

async function sniffPages(source: FileSource) {
  const pages = source.files
    .filter((f) => f.kind === 'html' && f.size > 0 && !isLibraryPath(f.path) && !pageSniffed(f))
    .sort((a, b) => Number(namedLikeBomPage(b)) - Number(namedLikeBomPage(a)))
    .slice(0, PAGE_SNIFF_LIMIT)
  let next = 0
  const worker = async () => {
    while (next < pages.length) {
      const file = pages[next++]
      const head = await readHead(source, file.path, SNIFF_BYTES).catch(() => null)
      if (head) noteSniffedPage(file, isBomHtml(head))
    }
  }
  await Promise.all(Array.from({ length: PAGE_SNIFF_CONCURRENCY }, worker))
}

function plan(source: FileSource) {
  const rank = planned.get(source.id) ?? 0
  const pinned = pinnedGroups(source.files).flatMap((g) => g.files.filter((f) => !f.hidden).map((f) => f.file))
  const rest = source.files
    .filter((f) => !pinned.includes(f) && !isLibraryPath(f.path))
    .sort((a, b) => weight(a) - weight(b) || a.size - b.size)
  let budget = MAX_REPO_BYTES
  let count = 0
  const gerberBoardsSeen = new Set<GerberBoardSet>()
  const jobs: Job[] = []

  for (const file of [...pinned, ...rest]) {
    const server = convertsOnServer(file)
    if (
      count >= MAX_FILES ||
      file.risky ||
      isBackup(file) ||
      SKIP_KINDS.has(file.kind) ||
      file.size === 0 ||
      (!server && (file.size > MAX_FILE_BYTES || file.size > budget))
    )
      continue
    if (file.kind === 'binary' && file.size > 1024 * 1024) continue
    if (file.ext === 'blend' && (file.size > MAX_BLEND_BYTES || !pinned.includes(file))) continue
    if (file.kind === 'cadsource' && file.size > MAX_CAD_SOURCE_BYTES) continue
    if (!server) budget -= file.size
    count++
    const key = `${source.id}|${file.path}`
    if (file.kind === 'gerber') {
      const board = gerberBoards(source.files).find((b) => b.files.includes(file))
      if (!board || gerberBoardsSeen.has(board)) continue
      gerberBoardsSeen.add(board)
      const set = board.files
      jobs.push({
        source: source.id,
        keys: set.map((f) => `${source.id}|${f.path}`),
        rank: 0,
        cpu: true,
        run: () => import('../viewers/gerber/render').then((m) => m.renderBoard(source, set)),
      })
    } else if (file.kind === 'model') {
      jobs.push({
        source: source.id,
        keys: [key],
        rank: 0,
        cpu: !server,
        run: async () => {
          const { canPrepareModel, needsThree, prepareModel } = await import('../viewers/model/load')
          if (!canPrepareModel(file)) return source.read(file.path)
          return prepareModel(source, file, { lane: 'background' }).catch((error: unknown) =>
            needsThree(error) ? source.read(file.path) : Promise.reject(error),
          )
        },
      })
    } else if (file.kind === 'eagle' && file.size <= 32 * 1024 * 1024) {
      jobs.push({
        source: source.id,
        keys: [key],
        rank: 0,
        cpu: true,
        run: async () => {
          const bytes = await source.read(file.path)
          const head = new Uint8Array(bytes, 0, Math.min(4096, bytes.byteLength))
          if (detectEda(head, file.ext) !== 'eagle') return bytes
          return import('../viewers/eagle/load').then((m) => m.renderEagle(source, file))
        },
      })
    } else if (file.kind === 'altium' && file.ext !== 'prjpcb') {
      jobs.push({
        source: source.id,
        keys: [key],
        rank: 0,
        cpu: true,
        run: () => import('../viewers/altium/load').then((m) => m.loadAltium(source, file)),
      })
    } else if (file.kind === 'librepcb' && file.ext !== 'lp') {
      jobs.push({
        source: source.id,
        keys: [key],
        rank: 0,
        cpu: true,
        run: () => import('../viewers/librepcb/load').then((m) => m.loadLibrePcb(source, file)),
      })
    } else if (file.kind === 'html') {
      jobs.push({
        source: source.id,
        keys: [key],
        rank: 0,
        cpu: isBomPage(file),
        run: async () => {
          const bytes = await source.read(file.path)
          const bom = isBomHtml(new Uint8Array(bytes))
          noteSniffedPage(file, bom)
          if (!bom) return bytes
          return import('../viewers/ibom/load').then((m) => m.prepareIbom(source, file)).catch(() => bytes)
        },
      })
    } else if (file.kind === 'image' && ['psd', 'psb', 'xcf'].includes(file.ext)) {
      jobs.push({
        source: source.id,
        keys: [key],
        rank: 0,
        cpu: true,
        run: () => import('../viewers/office/raster').then((m) => m.decodeRaster(source, file)),
      })
    } else {
      jobs.push({ source: source.id, keys: [key], rank: 0, cpu: false, run: () => source.read(file.path) })
    }
  }

  jobs.forEach((job, i) => {
    job.rank = rank * 1e6 + i
    for (const key of job.keys) statuses.set(key, 'queued')
  })
  queue.push(...jobs)
  queue.sort((a, b) => a.rank - b.rank)
  notify()
  pump()
}

const WEIGHT: Record<string, number> = {
  markdown: 0,
  model: 1,
  kicad: 1,
  easyeda: 1,
  eagle: 1,
  altium: 1,
  fritzing: 1,
  librepcb: 1,
  gerber: 1,
  pdf: 2,
  document: 2,
  table: 2,
  html: 5,
  dxf: 2,
  image: 3,
  fusion: 3,
  cadsource: 3,
  archive: 4,
  text: 5,
  binary: 6,
}

function weight(file: HurtFile) {
  return isBomPage(file) ? 2 : (WEIGHT[file.kind] ?? 9)
}

function pump() {
  for (let i = 0; i < queue.length; ) {
    const job = queue[i]
    const lane = job.cpu ? 'cpu' : 'net'
    if (active[lane] >= (job.cpu ? CPU_SLOTS : NETWORK_SLOTS)) {
      i++
      continue
    }
    queue.splice(i, 1)
    active = { ...active, [lane]: active[lane] + 1 }
    for (const key of job.keys) statuses.set(key, 'working')
    notify()
    job
      .run()
      .then(
        () => job.keys.forEach((key) => statuses.set(key, 'ready')),
        () => job.keys.forEach((key) => statuses.set(key, 'failed')),
      )
      .finally(() => {
        active = { ...active, [lane]: active[lane] - 1 }
        notify()
        pump()
      })
  }
}
