import { useEffect, useRef } from 'react'
import { useLoad } from '../../core/useLoad'
import { Gate, ToolButton } from '../../ui/parts'
import PanZoom, { type PanZoomHandle } from '../../ui/PanZoom'
import { decodeImage } from '../ImageViewer'

export default function ImageSheet({ image, title }: { image: Blob; title: string }) {
  const pan = useRef<PanZoomHandle>(null)
  const state = useLoad(({ signal }) => decodeImage(image, signal), [image])

  useEffect(() => {
    if (state.status !== 'ready') return
    const { url } = state.value
    return () => URL.revokeObjectURL(url)
  }, [state])

  return (
    <div className="hurt-easyeda__canvas hurt-easyeda__image">
      <Gate state={state}>
        {({ url, width, height }) => (
          <>
            <div className="hurt-easyeda__tools">
              <ToolButton icon="minus" label="Zoom out" onClick={() => pan.current?.zoom(0.8)} />
              <ToolButton icon="plus" label="Zoom in" onClick={() => pan.current?.zoom(1.25)} />
              <ToolButton icon="fit" label="Fit" onClick={() => pan.current?.fit()} />
            </div>
            <PanZoom ref={pan} width={width} height={height}>
              <img src={url} alt={title} width={width} height={height} draggable={false} />
            </PanZoom>
          </>
        )}
      </Gate>
    </div>
  )
}
