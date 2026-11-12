import { useEffect, useState } from 'react'
import { readableError } from './workers'

export type Loadable<T> =
  | { status: 'loading'; progress: number | null; message: string | null }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: string; retry?: () => void }

export interface LoadContext {
  signal: AbortSignal
  progress: (fraction: number | null, message?: string) => void
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function errorMessage(error: unknown) {
  return readableError(error)
}

export function useLoad<T>(load: (context: LoadContext) => Promise<T>, deps: unknown[]): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading', progress: null, message: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let frame = 0
    let settled = false
    let latest: { progress: number | null; message: string | null } | null = null
    setState({ status: 'loading', progress: null, message: null })

    const progress = (fraction: number | null, message?: string) => {
      latest = { progress: fraction, message: message ?? latest?.message ?? null }
      if (frame || settled) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (!settled && !controller.signal.aborted && latest) setState({ status: 'loading', ...latest })
      })
    }

    const settle = (next: Loadable<T>) => {
      settled = true
      cancelAnimationFrame(frame)
      if (!controller.signal.aborted) setState(next)
    }

    load({ signal: controller.signal, progress }).then(
      (value) => settle({ status: 'ready', value }),
      (error) => {
        if (!isAbort(error))
          settle({ status: 'error', error: errorMessage(error), retry: () => setAttempt((n) => n + 1) })
      },
    )
    return () => {
      controller.abort()
      cancelAnimationFrame(frame)
    }
  }, [...deps, attempt])

  return state
}
