import { useState } from 'react'
import type { ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { formatBytes } from '../core/format'
import { Failure, Gate, Toolbar } from '../ui/parts'
import { useObjectUrl } from './ImageViewer'

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
}

export default function MediaViewer({ file, source }: ViewerProps) {
  const [broken, setBroken] = useState(false)
  const [audioOnly, setAudioOnly] = useState(false)
  const state = useLoad(
    ({ signal, progress }) =>
      source.read(file.path, { signal, onProgress: (l, t) => progress(t ? l / t : null, 'Downloading') }),
    [source.id, file.path],
  )
  const url = useObjectUrl(state.status === 'ready' ? state.value : null, MIME[file.ext] ?? 'application/octet-stream')
  const video = file.kind === 'video' && !audioOnly

  return (
    <div className="hurt-media">
      <Toolbar title={file.name} meta={formatBytes(file.size)} />
      <Gate state={state}>
        {() =>
          broken ? (
            <Failure message="This browser can't play this file's codec. Download it to watch it." />
          ) : (
            url && (
              <div className="hurt-media__stage">
                {video ? (
                  <video
                    src={url}
                    controls
                    preload="metadata"
                    onError={() => setBroken(true)}
                    onLoadedMetadata={(e) => setAudioOnly(!e.currentTarget.videoWidth && !e.currentTarget.videoHeight)}
                  />
                ) : (
                  <audio src={url} controls preload="metadata" onError={() => setBroken(true)} />
                )}
              </div>
            )
          )
        }
      </Gate>
    </div>
  )
}
