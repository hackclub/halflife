import { useEffect, useRef } from 'react'
import type { ModelData, ModelPreview } from '../model/analyze'

export function SavedPreview({ preview, className }: { preview: ModelPreview; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const pixels = new Uint8ClampedArray(preview.width * preview.height * 4)
    pixels.set(preview.rgba.subarray(0, pixels.length))
    context.putImageData(new ImageData(pixels, preview.width, preview.height), 0, 0)
  }, [preview])
  return (
    <canvas
      ref={canvas}
      className={className ?? 'hurt-blend__preview'}
      width={preview.width}
      height={preview.height}
      role="img"
      aria-label="Preview saved in the file"
    />
  )
}

export function NoGeometry({ model }: { model: ModelData }) {
  return (
    <div className="hurt-blend__empty">
      {model.preview ? (
        <figure className="hurt-blend__figure">
          <SavedPreview preview={model.preview} className="hurt-blend__still" />
          <figcaption>Preview saved in the file</figcaption>
        </figure>
      ) : null}
      <div className="hurt-blend__notes">
        {model.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>
      {model.info?.length ? (
        <dl className="hurt-readings hurt-blend__info">
          {model.info.map((row) => (
            <div key={row.label} className="hurt-readings__row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}
