import { useEffect, useRef, useState } from 'react'
import type { ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { formatBytes } from '../core/format'
import { Gate, ToolButton, Toolbar } from '../ui/parts'
import PanZoom, { type PanZoomHandle } from '../ui/PanZoom'
import { RASTER_EXTENSIONS, decodeRaster } from './office/raster'

export const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

export function useObjectUrl(bytes: ArrayBuffer | null, type: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!bytes) return setUrl(null)
    const created = URL.createObjectURL(new Blob([bytes], { type }))
    setUrl(created)
    return () => URL.revokeObjectURL(created)
  }, [bytes, type])
  return url
}

export async function decodeImage(blob: Blob, signal?: AbortSignal) {
  if (!blob.size) throw new Error('This image file is empty (0 bytes).')
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.src = url
  const decoded = await image.decode().then(
    () => true,
    () => false,
  )
  if (!decoded || signal?.aborted) {
    URL.revokeObjectURL(url)
    signal?.throwIfAborted()
    throw new Error('The browser could not decode this image.')
  }
  return { url, width: image.naturalWidth || 1024, height: image.naturalHeight || 768 }
}

export default function ImageViewer({ file, source }: ViewerProps) {
  const panzoom = useRef<PanZoomHandle>(null)
  const [scale, setScale] = useState(1)
  const state = useLoad(
    async ({ signal, progress }) => {
      const onProgress = (l: number, t: number) => progress(t ? l / t : null, 'Downloading')
      const decoded = RASTER_EXTENSIONS.has(file.ext) ? await decodeRaster(source, file, { signal, onProgress }) : null
      const blob =
        decoded?.blob ??
        new Blob([await source.read(file.path, { signal, onProgress })], {
          type: IMAGE_MIME[file.ext] ?? 'application/octet-stream',
        })
      return { ...(await decodeImage(blob, signal)), note: decoded?.note ?? null }
    },
    [source.id, file.path],
  )

  useEffect(() => {
    if (state.status !== 'ready') return
    const { url } = state.value
    return () => URL.revokeObjectURL(url)
  }, [state])

  return (
    <div className="hurt-image">
      <Toolbar
        title={file.name}
        meta={
          state.status === 'ready'
            ? `${state.value.width} × ${state.value.height} px · ${formatBytes(file.size)} · ${Math.round(scale * 100)}%`
            : formatBytes(file.size)
        }
      >
        <ToolButton icon="minus" label="Zoom out" onClick={() => panzoom.current?.zoom(1 / 1.5)} />
        <ToolButton icon="plus" label="Zoom in" onClick={() => panzoom.current?.zoom(1.5)} />
        <ToolButton icon="fit" label="Fit" onClick={() => panzoom.current?.fit()} />
      </Toolbar>
      <Gate state={state}>
        {({ url, width, height, note }) => (
          <>
            {note && <p className="hurt-note">{note}</p>}
            <PanZoom ref={panzoom} width={width} height={height} className="hurt-checker" onViewChange={setScale}>
              <img
                src={url}
                alt={file.name}
                width={width}
                height={height}
                draggable={false}
                className="hurt-image__img"
                data-pixelated={scale > 1 && file.ext !== 'svg' ? '' : undefined}
              />
            </PanZoom>
          </>
        )}
      </Gate>
    </div>
  )
}
