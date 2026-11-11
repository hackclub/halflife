import { useState } from 'react'
import type { HurtFile, ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { Gate, TextToggle, ToolDivider } from '../../ui/parts'
import { Drawing } from '../eagle/EagleViewer'
import TextViewer from '../TextViewer'
import { loadLibrePcb, type LibrePcbOpened, type LibrePcbView } from './load'

const VIEW_LABEL = { schematic: 'Schematic', board: 'Board', library: 'Library' }

function kindLabel(view: LibrePcbView) {
  if (view.kind !== 'library') return `LibrePCB ${view.kind}`
  return view.render.sheets[0]?.group === 'Symbols' ? 'LibrePCB symbol' : 'LibrePCB package'
}

export default function LibrePcbViewer(props: ViewerProps) {
  const { file, source } = props
  const state = useLoad(
    ({ signal, progress }) => loadLibrePcb(source, file, { signal, onProgress: progress }),
    [source.id, file.path],
  )

  if (state.status === 'ready' && !state.value) return <TextViewer {...props} />

  return (
    <div className="hurt-eagle">
      <Gate state={state}>{(opened) => opened && <Project opened={opened} file={file} />}</Gate>
    </div>
  )
}

function Project({ opened: { render, entry }, file }: { opened: LibrePcbOpened; file: HurtFile }) {
  const start = Math.max(
    0,
    render.views.findIndex((v) => entry !== null && v.paths.includes(entry)),
  )
  const [index, setIndex] = useState(start)
  const view = render.views[index]
  return (
    <Drawing
      key={index}
      render={view.render}
      file={file}
      label={kindLabel(view)}
      initial={index === start && entry ? Math.max(0, view.paths.indexOf(entry)) : 0}
    >
      {render.views.length > 1 && (
        <>
          {render.views.map((v, i) => (
            <TextToggle key={v.kind} active={i === index} onClick={() => setIndex(i)}>
              {VIEW_LABEL[v.kind]}
            </TextToggle>
          ))}
          <ToolDivider />
        </>
      )}
    </Drawing>
  )
}
