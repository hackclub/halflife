import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import HurtIcon, { type HurtIconName } from './HurtIcon'
import type { Loadable } from '../core/useLoad'

interface LoadStep {
  message: string
  start: number
  end?: number
  first?: { at: number; progress: number }
}

const ESTIMATE_AFTER = 1000
const MB = 1024 * 1024
const HISTORY_KEY = 'hurt:step-times'

export const LoadingSize = createContext(0)

function stepName(message: string) {
  return message.split('. ')[0]
}

function history(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function remember(step: LoadStep, size: number) {
  const took = (step.end ?? 0) - step.start
  if (step.first || size < MB || took < ESTIMATE_AFTER) return
  try {
    const times = history()
    const name = stepName(step.message)
    const rate = took / (size / MB)
    times[name] = times[name] ? (times[name] + rate) / 2 : rate
    localStorage.setItem(HISTORY_KEY, JSON.stringify(times))
  } catch {}
}

const DEFAULT_RATES: Record<string, number> = {
  'Tessellating solids': 350,
  'Retrying shapes that could not be meshed': 300,
}
const DEFAULT_RATE = 100

function expected(step: LoadStep, size: number, now: number) {
  const name = stepName(step.message)
  const rate = size >= MB ? (history()[name] ?? DEFAULT_RATES[name] ?? DEFAULT_RATE) : 0
  const left = rate * (size / MB) - (now - step.start)
  return left > ESTIMATE_AFTER ? `about ${seconds(left)} left` : null
}

function seconds(ms: number) {
  const total = Math.max(1, Math.round(ms / 1000))
  if (total < 60) return `${total} s`
  const minutes = Math.floor(total / 60)
  return total % 60 ? `${minutes} min ${total % 60} s` : `${minutes} min`
}

function remaining(step: LoadStep, progress: number, now: number) {
  if (!step.first || progress <= step.first.progress || now - step.first.at < ESTIMATE_AFTER) return null
  const left = ((1 - progress) * (now - step.first.at)) / (progress - step.first.progress)
  return left < 3000 ? 'a few seconds left' : `about ${seconds(left)} left`
}

export function Loading({ progress, message }: { progress?: number | null; message?: string | null }) {
  const percent = progress == null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100)
  const label = message ?? 'Loading'
  const size = useContext(LoadingSize)
  const steps = useRef<LoadStep[]>([])
  const [now, setNow] = useState(() => performance.now())
  const at = performance.now()
  if (message == null && steps.current.some((s) => s.message !== label)) steps.current = []
  let step = steps.current[steps.current.length - 1]
  if (step?.message !== label) {
    if (step) {
      step.end = at
      remember(step, size)
    }
    step = { message: label, start: at }
    steps.current.push(step)
  }
  if (progress != null && progress > 0 && !step.first) step.first = { at, progress }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 1000)
    return () => {
      window.clearInterval(timer)
      const last = steps.current[steps.current.length - 1]
      if (last && !last.end) {
        last.end = performance.now()
        remember(last, size)
      }
    }
  }, [size])

  const clock = Math.max(now, at)
  const estimate =
    progress != null && progress > 0
      ? progress < 1
        ? remaining(step, progress, clock)
        : null
      : step.first
        ? null
        : expected(step, size, clock)
  const done = steps.current.slice(0, -1)
  const elapsed = clock - steps.current[0].start
  return (
    <div className="hurt-state" role="status">
      <div className={percent == null ? 'hurt-state__bar is-indeterminate' : 'hurt-state__bar'}>
        <span style={percent == null ? undefined : { width: `${percent}%` }} />
      </div>
      <p className="hurt-state__step">
        {label}
        {percent != null && percent < 100 ? ` · ${percent}%` : ''}
        <span aria-hidden="true">
          {estimate
            ? ` · ${estimate}`
            : clock - step.start >= ESTIMATE_AFTER * 2
              ? ` · ${seconds(clock - step.start)}`
              : ''}
        </span>
      </p>
      {done.length > 0 && (
        <ol className="hurt-state__steps" aria-hidden="true">
          {done.map((s, i) => (
            <li key={i}>
              <HurtIcon name="check" />
              {stepName(s.message)} · {seconds((s.end ?? clock) - s.start)}
            </li>
          ))}
        </ol>
      )}
      {elapsed >= ESTIMATE_AFTER * 3 && (
        <p className="hurt-state__elapsed" aria-hidden="true">
          {seconds(elapsed)} so far
        </p>
      )}
    </div>
  )
}

export function Failure({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="hurt-state hurt-state--error" role="alert">
      <HurtIcon name="warning" />
      <p>{message}</p>
      {children}
    </div>
  )
}

export function Gate<T>({ state, children }: { state: Loadable<T>; children: (value: T) => ReactNode }) {
  if (state.status === 'loading') return <Loading progress={state.progress} message={state.message} />
  if (state.status === 'error')
    return (
      <Failure message={state.error}>
        {state.retry && <ToolButton icon="undo" label="Try again" text onClick={state.retry} />}
      </Failure>
    )
  return <>{children(state.value)}</>
}

export function Toolbar({ title, meta, children }: { title?: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="hurt-toolbar">
      {(title || meta) && (
        <div className="hurt-toolbar__heading">
          {title && <span className="hurt-toolbar__title">{title}</span>}
          {meta && <span className="hurt-toolbar__meta">{meta}</span>}
        </div>
      )}
      {children && <div className="hurt-toolbar__tools">{children}</div>}
    </div>
  )
}

export function ToolButton({
  icon,
  label,
  onClick,
  active,
  disabled,
  shortcut,
  text,
}: {
  icon: HurtIconName
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  shortcut?: string
  text?: boolean
}) {
  return (
    <button
      type="button"
      className={active ? 'hurt-tool is-active' : 'hurt-tool'}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
    >
      <HurtIcon name={icon} />
      {text && <span>{label}</span>}
    </button>
  )
}

export function TextToggle({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={active ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function ToolDivider() {
  return <span className="hurt-toolbar__divider" aria-hidden="true" />
}
