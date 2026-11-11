import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent,
  type ReactNode,
} from 'react'

export interface PanZoomHandle {
  fit: () => void
  zoom: (factor: number) => void
  toContent: (clientX: number, clientY: number) => { x: number; y: number }
  scale: () => number
}

interface Props {
  width: number
  height: number
  children: ReactNode
  className?: string
  onPointerClick?: (point: { x: number; y: number }, event: PointerEvent) => void
  onPointerMove?: (point: { x: number; y: number }) => void
  onViewChange?: (scale: number) => void
  focus?: { x: number; y: number; width: number; height: number }
}

const MIN_SCALE = 0.02
const MAX_SCALE = 400

const PanZoom = forwardRef<PanZoomHandle, Props>(function PanZoom(
  { width, height, children, className, onPointerClick, onPointerMove, onViewChange, focus },
  ref,
) {
  const fx = focus?.x ?? 0
  const fy = focus?.y ?? 0
  const fw = focus?.width ?? width
  const fh = focus?.height ?? height
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const view = useRef({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const frame = useRef(0)

  const apply = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const { x, y, scale } = view.current
      if (content.current) content.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
      onViewChange?.(scale)
    })
  }, [onViewChange])

  const fit = useCallback(() => {
    const el = viewport.current
    if (!el || fw <= 0 || fh <= 0) return
    const scale = Math.min(el.clientWidth / fw, el.clientHeight / fh) * 0.94
    view.current = {
      scale,
      x: (el.clientWidth - fw * scale) / 2 - fx * scale,
      y: (el.clientHeight - fh * scale) / 2 - fy * scale,
    }
    apply()
  }, [fx, fy, fw, fh, apply])

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      const current = view.current
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor))
      const ratio = scale / current.scale
      view.current = { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio }
      apply()
    },
    [apply],
  )

  const toContent = useCallback((clientX: number, clientY: number) => {
    const rect = viewport.current!.getBoundingClientRect()
    const { x, y, scale } = view.current
    return { x: (clientX - rect.left - x) / scale, y: (clientY - rect.top - y) / scale }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      fit,
      toContent,
      scale: () => view.current.scale,
      zoom: (factor) => {
        const el = viewport.current
        if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2)
      },
    }),
    [fit, toContent, zoomAt],
  )

  useEffect(() => {
    fit()
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(() => fit())
    observer.observe(el)
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(
        Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015)),
        event.clientX - rect.left,
        event.clientY - rect.top,
      )
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', wheel)
      cancelAnimationFrame(frame.current)
    }
  }, [fit, zoomAt])

  return (
    <div
      ref={viewport}
      className={className ? `hurt-panzoom ${className}` : 'hurt-panzoom'}
      onPointerDown={(event) => {
        if (event.button !== 0 && event.button !== 1) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
      }}
      onPointerMove={(event) => {
        const state = drag.current
        if (state && state.id === event.pointerId) {
          const dx = event.clientX - state.x
          const dy = event.clientY - state.y
          if (!state.moved && Math.hypot(dx, dy) < 3) return
          state.moved = true
          state.x = event.clientX
          state.y = event.clientY
          view.current = { ...view.current, x: view.current.x + dx, y: view.current.y + dy }
          apply()
        } else if (onPointerMove) {
          onPointerMove(toContent(event.clientX, event.clientY))
        }
      }}
      onPointerUp={(event) => {
        const state = drag.current
        drag.current = null
        if (state && !state.moved && onPointerClick) onPointerClick(toContent(event.clientX, event.clientY), event)
      }}
      onDoubleClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        zoomAt(2, event.clientX - rect.left, event.clientY - rect.top)
      }}
    >
      <div ref={content} className="hurt-panzoom__content" style={{ width, height }}>
        {children}
      </div>
    </div>
  )
})

export default PanZoom
