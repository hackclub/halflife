import type { ViewerProps } from '../../types'
import GerberBoard from './GerberBoard'
import { gerberSet } from './render'

export default function GerberViewer({ file, source }: ViewerProps) {
  const board = gerberSet(source, file)
  const dir = file.dir ? `${file.dir}/` : ''
  return (
    <GerberBoard
      source={source}
      files={board?.files ?? [file]}
      title={board?.stem ? `${dir}${board.stem}` : dir || file.name}
    />
  )
}
