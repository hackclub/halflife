import type { CommitData, CompareData, ConvertOptions, FileSource, ShipMark, SnapshotData } from '../types'
import { repoSource } from './source'

const SNAPSHOT_TTL_MS = 60 * 1000

export interface RepoEndpoints {
  files: string
  commits: string
  compare: string
  convert: string
  converted: string
  attachment: string
}

export function shipEndpoints(shipId: string): RepoEndpoints {
  return endpointsAt(`/api/reviews/${encodeURIComponent(shipId)}/files`)
}

export function repoEndpoints(repo: string): RepoEndpoints {
  return endpointsAt(`/admin/repos/${repo.split('/').map(encodeURIComponent).join('/')}/files`)
}

function endpointsAt(base: string): RepoEndpoints {
  return {
    files: base,
    commits: `${base}/commits`,
    compare: `${base}/compare`,
    convert: `${base}/convert`,
    converted: `${base}/converted`,
    attachment: `${base}/attachment`,
  }
}

export interface LoadedRepo {
  snapshot: SnapshotData
  source: FileSource
}

const repos = new Map<string, { at: number; promise: Promise<LoadedRepo> }>()

export function loadRepo(endpoints: RepoEndpoints): Promise<LoadedRepo> {
  const hit = repos.get(endpoints.files)
  if (hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.promise
  const promise = getJson<SnapshotData>(endpoints.files).then((snapshot) => {
    const source: FileSource = {
      ...repoSource(snapshot),
      convert: (path, options) => convertOnServer(endpoints, snapshot.sha, path, options),
      attachmentUrl: (path, id) => `${endpoints.attachment}?${new URLSearchParams({ path, id })}`,
    }
    return { snapshot, source }
  })
  repos.set(endpoints.files, { at: Date.now(), promise })
  promise.catch(() => repos.delete(endpoints.files))
  return promise
}

export function loadCommits(endpoints: RepoEndpoints, signal?: AbortSignal) {
  return getJson<{ commits: CommitData[]; complete: boolean; ships: ShipMark[] }>(endpoints.commits, signal)
}

export function loadCompare(endpoints: RepoEndpoints, base: string, head: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ base, head })
  return getJson<CompareData>(`${endpoints.compare}?${query}`, signal)
}

interface Conversion {
  state: 'queued' | 'working' | 'done' | 'failed'
  message?: string
  error?: string
}

const CONVERT_POLL_MS = 2000
const CONVERT_LIMIT_MS = 20 * 60 * 1000

async function convertOnServer(endpoints: RepoEndpoints, sha: string, path: string, options: ConvertOptions = {}) {
  const query = new URLSearchParams({ sha, path })
  const token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
  const started = Date.now()
  for (;;) {
    const response = await fetch(`${endpoints.convert}?${query}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-CSRF-Token': token },
      credentials: 'same-origin',
      signal: options.signal,
    })
    const status = (await response.json().catch(() => null)) as (Conversion & { error?: string }) | null
    if (!response.ok || !status) throw new Error(status?.error ?? `The server answered ${response.status}.`)
    if (status.state === 'failed') throw new Error(status.error ?? 'The server could not convert this model.')
    if (status.state === 'done') break
    options.onStatus?.(status.message ?? 'Converting on the server')
    if (Date.now() - started > CONVERT_LIMIT_MS) throw new Error('The server is taking too long to convert this model.')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, CONVERT_POLL_MS)
      options.signal?.addEventListener('abort', () => (clearTimeout(timer), reject(options.signal?.reason)), {
        once: true,
      })
    })
  }
  options.onStatus?.('Downloading the converted model')
  const response = await fetch(`${endpoints.converted}?${query}`, {
    credentials: 'same-origin',
    signal: options.signal,
  })
  if (!response.ok) throw new Error(`The server answered ${response.status}.`)
  return response.arrayBuffer()
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `The server answered ${response.status}.`)
  return body as T
}
