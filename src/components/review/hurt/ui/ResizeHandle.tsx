import { useRef, useState } from 'react'

const KEY_STEP = 16

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function stored(key: string, fallback: number) {
  try {
    const value = Number(localStorage.getItem(key))
    return value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

export function useStoredWidth(key: string, fallback: number) {
  const [width, setWidth] = useState(() => stored(key, fallback))
  const update = (next: number | null) => {
    setWidth(next ?? fallback)
    try {
      if (next == null) localStorage.removeItem(key)
      else localStorage.setItem(key, String(Math.round(next)))
    } catch {}
  }
  return [width, update] as const
}

export default function ResizeHandle({
  edge,
  width,
  min,
  max,
  label,
  onResize,
}: {
  edge: 'start' | 'end'
  width: number
  min: number
  max: number
  label: string
  onResize: (width: number | null) => void
}) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const sign = edge === 'end' ? 1 : -1
  const limit = () => Math.min(max, window.innerWidth * 0.6)

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title={`${label}. Double-click to reset.`}
      className={dragging ? 'resize-handle is-dragging' : 'resize-handle'}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, width }
        setDragging(true)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        onResize(clamp(drag.current.width + sign * (e.clientX - drag.current.x), min, limit()))
      }}
      onLostPointerCapture={() => {
        drag.current = null
        setDragging(false)
      }}
      onDoubleClick={() => onResize(null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        e.preventDefault()
        const direction = e.key === 'ArrowRight' ? 1 : -1
        onResize(clamp(width + sign * direction * KEY_STEP, min, limit()))
      }}
    />
  )
}
