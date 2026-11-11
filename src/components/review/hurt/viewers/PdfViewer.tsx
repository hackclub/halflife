import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { formatBytes } from '../core/format'
import { startWorker } from '../core/workers'
import { Gate, ToolButton, Toolbar } from '../ui/parts'

// Half Life: pdf.js's cmaps, standard fonts and wasm are served by app/api/reviews/assets from the installed package, in place of Vite's `import.meta.glob`.
const PDF_DATA_DIRS: Record<string, string> = { bcmap: 'cmaps', pfb: 'standard_fonts', ttf: 'standard_fonts', wasm: 'wasm' }
const PDF_DATA = (filename: string) => {
  const dir = PDF_DATA_DIRS[filename.split('.').pop() ?? '']
  return dir && /^[A-Za-z0-9._-]+$/.test(filename) ? `/api/reviews/assets/pdfjs/${dir}/${filename}` : null
}

class PdfData {
  async fetch({ filename }: { kind: string; filename: string }) {
    const url = PDF_DATA(filename)
    if (!url) throw new Error(`pdf.js asked for ${filename}, which is not bundled.`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not load ${filename}.`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

async function pdfjs() {
  const lib = await import('pdfjs-dist')
  if (!lib.GlobalWorkerOptions.workerPort) {
    const workerUrl = '/api/reviews/assets/pdfjs/pdf.worker.min.mjs'
    lib.GlobalWorkerOptions.workerPort = startWorker(workerUrl, 'pdf reader')
  }
  return lib
}

const ACTUAL_SIZE = 96 / 72
const MIN_SCALE = 0.2
const MAX_SCALE = 8

interface Loaded {
  task: PDFDocumentLoadingTask
  doc: PDFDocumentProxy
  width: number
  height: number
}

export default function PdfViewer({ file, source }: ViewerProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<number | 'fit'>(ACTUAL_SIZE)
  const anchor = useRef<{ x: number; y: number; ratio: number } | null>(null)
  const latestScale = useRef(ACTUAL_SIZE)
  const [fitScale, setFitScale] = useState(1)
  const [page, setPage] = useState(1)
  const state = useLoad(
    async ({ signal, progress }) => {
      const bytes = await source.read(file.path, {
        signal,
        onProgress: (l, t) => progress(t ? l / t : null, 'Downloading'),
      })
      progress(null, 'Opening document')
      const lib = await pdfjs()
      const task = lib.getDocument({
        data: new Uint8Array(bytes.slice(0)),
        cMapPacked: true,
        BinaryDataFactory: PdfData,
      })
      const doc = await task.promise
      const first = (await doc.getPage(1)).getViewport({ scale: 1 })
      return { task, doc, width: first.width, height: first.height } satisfies Loaded
    },
    [source.id, file.path],
  )

  useEffect(() => {
    if (state.status !== 'ready') return
    const { task } = state.value
    return () => void task.destroy()
  }, [state])

  useEffect(() => {
    const el = scroller.current
    if (!el || state.status !== 'ready') return
    const observer = new ResizeObserver(() => setFitScale(Math.max(0.2, (el.clientWidth - 32) / state.value.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [state])

  const scale = zoom === 'fit' ? fitScale : zoom
  latestScale.current = scale
  const step = (factor: number) => setZoom(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor)))

  useEffect(() => {
    const el = scroller.current
    if (!el || state.status !== 'ready') return
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const current = latestScale.current
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current * Math.exp(-event.deltaY * 0.002)))
      if (next === current) return
      const rect = el.getBoundingClientRect()
      anchor.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, ratio: next / current }
      setZoom(next)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [state])

  useLayoutEffect(() => {
    const el = scroller.current
    const point = anchor.current
    if (!el || !point) return
    anchor.current = null
    el.scrollLeft = (el.scrollLeft + point.x) * point.ratio - point.x
    el.scrollTop = (el.scrollTop + point.y) * point.ratio - point.y
  }, [scale])

  return (
    <div className="hurt-pdf">
      <Toolbar
        title={file.name}
        meta={
          state.status === 'ready'
            ? `Page ${page} of ${state.value.doc.numPages} · ${Math.round((scale / ACTUAL_SIZE) * 100)}% · ${formatBytes(file.size)}`
            : formatBytes(file.size)
        }
      >
        <ToolButton icon="minus" label="Zoom out" onClick={() => step(1 / 1.25)} />
        <ToolButton icon="plus" label="Zoom in" onClick={() => step(1.25)} />
        <button
          type="button"
          className={zoom === ACTUAL_SIZE ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
          title="Actual size"
          aria-pressed={zoom === ACTUAL_SIZE}
          onClick={() => setZoom(ACTUAL_SIZE)}
        >
          100%
        </button>
        <ToolButton icon="fit" label="Fit width" active={zoom === 'fit'} onClick={() => setZoom('fit')} />
      </Toolbar>
      <Gate state={state}>
        {({ doc, width, height }) => (
          <div
            ref={scroller}
            className="hurt-pdf__pages"
            onScroll={(e) => {
              const pageHeight = height * scale + 16
              setPage(
                Math.min(
                  doc.numPages,
                  Math.floor((e.currentTarget.scrollTop + e.currentTarget.clientHeight / 3) / pageHeight) + 1,
                ),
              )
            }}
          >
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} number={i + 1} scale={scale} width={width} height={height} />
            ))}
          </div>
        )}
      </Gate>
    </div>
  )
}

function PdfPage({
  doc,
  number,
  scale,
  width,
  height,
}: {
  doc: PDFDocumentProxy
  number: number
  scale: number
  width: number
  height: number
}) {
  const holder = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [size, setSize] = useState({ width, height })

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '800px 0px',
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let task: RenderTask | null = null
    let cancelled = false
    void doc.getPage(number).then((page) => {
      if (cancelled || !canvas.current) return
      const base = page.getViewport({ scale: 1 })
      setSize({ width: base.width, height: base.height })
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: scale * ratio })
      canvas.current.width = Math.floor(viewport.width)
      canvas.current.height = Math.floor(viewport.height)
      task = page.render({ canvas: canvas.current, viewport })
      task.promise.catch(() => undefined)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, number, scale, visible])

  return (
    <div ref={holder} className="hurt-pdf__page" style={{ width: size.width * scale, height: size.height * scale }}>
      <canvas ref={canvas} aria-label={`Page ${number}`} />
    </div>
  )
}
