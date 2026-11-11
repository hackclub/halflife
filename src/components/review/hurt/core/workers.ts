export function startWorker(url: string, name: string) {
  // Half Life: against the page, not `import.meta.url` – Turbopack reads `new URL(x, import.meta.url)` as an asset to bundle, and every URL passed here is a server path.
  const absolute = new URL(url, location.href)
  if (absolute.origin === location.origin) return new Worker(absolute, { type: 'module', name })
  const shim = URL.createObjectURL(new Blob([`import ${JSON.stringify(absolute.href)}`], { type: 'text/javascript' }))
  return new Worker(shim, { type: 'module', name })
}

const STALL_MS = 5 * 60 * 1000

export function readableError(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'The reader hit an internal error on this file. It may be damaged or too large for the browser.'
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  onProgress?: (message: string, expect?: number) => void
}

export class WorkerClient {
  #worker: Worker | null = null
  #pending = new Map<number, Pending>()
  #nextId = 0
  #busy = 0
  #failed: string | null = null
  #stall = 0

  constructor(
    private readonly spawn: (name: string) => Worker,
    private readonly name: string,
  ) {}

  get busy() {
    return this.#busy > 0
  }

  call<T>(
    type: string,
    payload: Record<string, unknown>,
    options: {
      transfer?: Transferable[]
      onProgress?: (message: string, expect?: number) => void
      signal?: AbortSignal
    } = {},
  ): Promise<T> {
    if (this.#failed) return Promise.reject(new Error(this.#failed))
    const worker = this.#spawn()
    const id = ++this.#nextId
    this.#busy++
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        reject(new DOMException('Aborted', 'AbortError'))
        this.#pending.delete(id)
        if (this.#pending.size === 0 && this.#worker === worker) this.#stop()
      }
      if (options.signal?.aborted) return abort()
      options.signal?.addEventListener('abort', abort, { once: true })
      this.#pending.set(id, {
        resolve: (value) => {
          options.signal?.removeEventListener('abort', abort)
          resolve(value as T)
        },
        reject: (error) => {
          options.signal?.removeEventListener('abort', abort)
          reject(error)
        },
        onProgress: options.onProgress,
      })
      worker.postMessage({ id, type, ...payload }, options.transfer ?? [])
      this.#watch()
    }).finally(() => this.#busy--)
  }

  restart() {
    this.#failed = null
    this.#stop(`The ${this.name} stopped.`)
  }

  #stop(reason?: string) {
    window.clearTimeout(this.#stall)
    this.#worker?.terminate()
    this.#worker = null
    for (const pending of this.#pending.values()) pending.reject(new Error(reason ?? `The ${this.name} stopped.`))
    this.#pending.clear()
  }

  #watch() {
    window.clearTimeout(this.#stall)
    if (this.#pending.size === 0) return
    this.#stall = window.setTimeout(
      () => this.#stop(`The ${this.name} stopped responding on this file. It may be too large for the browser.`),
      STALL_MS,
    )
  }

  #spawn() {
    if (this.#worker) return this.#worker
    const worker = this.spawn(this.name)
    let started = false
    worker.onmessage = (
      event: MessageEvent<{
        id: number
        ready?: boolean
        ok?: boolean
        progress?: string
        expect?: number
        result?: unknown
        error?: string
      }>,
    ) => {
      const { id, ready, ok, progress, expect, result, error } = event.data
      if (ready) {
        started = true
        return
      }
      const pending = this.#pending.get(id)
      if (!pending) return
      if (progress === undefined) this.#pending.delete(id)
      this.#watch()
      if (progress !== undefined) return pending.onProgress?.(progress, expect)
      if (ok) pending.resolve(result)
      else pending.reject(new Error(error || `The ${this.name} failed.`))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      console.error(`[hurt] The ${this.name} ${started ? 'crashed' : 'could not start'}.`, event)
      if (!started) this.#failed = `The ${this.name} could not start. Reload the page to try again.`
      const message =
        (event instanceof ErrorEvent && event.message) ||
        this.#failed ||
        `The ${this.name} crashed. The file may be too large for the browser.`
      if (this.#worker === worker) this.#stop(message)
      else worker.terminate()
    }
    this.#worker = worker
    return worker
  }
}

type Handler = (
  payload: Record<string, unknown>,
  progress: (message: string, expect?: number) => void,
) => Promise<{ result: unknown; transfer?: Transferable[] }>

export function serveWorker(handlers: Record<string, Handler>) {
  self.onmessage = async (event: MessageEvent<{ id: number; type: string } & Record<string, unknown>>) => {
    const { id, type, ...payload } = event.data
    const progress = (message: string, expect?: number) => self.postMessage({ id, progress: message, expect })
    try {
      const handler = handlers[type]
      if (!handler) throw new Error(`Unknown task ${type}`)
      const { result, transfer } = await handler(payload, progress)
      ;(self as unknown as Worker).postMessage({ id, ok: true, result }, transfer ?? [])
    } catch (error) {
      self.postMessage({ id, ok: false, error: readableError(error) })
    }
  }
  self.postMessage({ ready: true })
}

export function transferablesOf(value: unknown, into: Transferable[] = [], seen = new Set<ArrayBufferLike>()) {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer && !seen.has(value.buffer)) {
      seen.add(value.buffer)
      into.push(value.buffer)
    }
  } else if (Array.isArray(value)) {
    for (const item of value) transferablesOf(item, into, seen)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) transferablesOf(item, into, seen)
  }
  return into
}
