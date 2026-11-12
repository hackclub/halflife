import { lazy, Suspense, useState } from 'react'
import type { ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { formatBytes } from '../core/format'
import { archiveSource } from '../core/source'
import { Gate, Loading, Toolbar } from '../ui/parts'
import HurtIcon from '../ui/HurtIcon'
import { kindIcon } from '../explorer/icons'
import { boardLabel, gerberBoards } from './gerber/sets'

const GerberBoard = lazy(() => import('./gerber/GerberBoard'))

const SEARCH_THRESHOLD = 100
const ROW_LIMIT = 1000

export default function ArchiveViewer({ file, source, onOpen }: ViewerProps) {
  const [tab, setTab] = useState<number | 'files' | null>(null)
  const [query, setQuery] = useState('')
  const state = useLoad(
    async ({ signal, progress }) => {
      const { archive, source: inner } = await archiveSource(source, file.path, {
        signal,
        onProgress: (l, t) => progress(t ? l / t : null, 'Downloading'),
      })
      return { archive, inner, boards: gerberBoards(inner.files).filter((b) => b.files.length >= 2) }
    },
    [source.id, file.path],
  )

  return (
    <div className="hurt-archive">
      <Gate state={state}>
        {({ archive, inner, boards }) => {
          const current = tab ?? (boards.length > 0 ? 0 : 'files')
          const board = current === 'files' ? undefined : boards[current]
          const risky = inner.files.filter((f) => f.risky)
          const total = inner.files.reduce((sum, f) => sum + f.size, 0)
          const needle = query.trim().toLowerCase()
          const matches = needle ? inner.files.filter((f) => f.path.toLowerCase().includes(needle)) : inner.files
          const tabs = boards.length > 0 && (
            <>
              {boards.map((b, i) => (
                <button
                  key={`${b.dir}|${b.stem}`}
                  type="button"
                  className={current === i ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
                  onClick={() => setTab(i)}
                >
                  {boards.length > 1 ? boardLabel(b) : 'Board'}
                </button>
              ))}
              <button
                type="button"
                className={current === 'files' ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
                onClick={() => setTab('files')}
              >
                Files
              </button>
            </>
          )
          return (
            <>
              {!board && (
                <Toolbar
                  title={file.name}
                  meta={`${inner.files.length} files · ${formatBytes(total)} unpacked · ${archive.format.toUpperCase()}`}
                >
                  {tabs}
                </Toolbar>
              )}
              {risky.length > 0 && (
                <p className="hurt-warning">
                  <HurtIcon name="warning" /> Contains programs or scripts:{' '}
                  {risky
                    .slice(0, 4)
                    .map((f) => f.name)
                    .join(', ')}
                  {risky.length > 4 ? ` and ${risky.length - 4} more` : ''}. Hardware projects rarely need these.
                </p>
              )}
              {archive.damaged && (
                <p className="hurt-warning">
                  <HurtIcon name="warning" /> This archive is damaged or cut short, so only the files before the damage
                  are listed.
                </p>
              )}
              {board ? (
                <Suspense fallback={<Loading message="Loading the Gerber renderer" />}>
                  <GerberBoard
                    key={`${board.dir}|${board.stem}`}
                    source={inner}
                    files={board.files}
                    title={file.name}
                    tabs={tabs}
                  />
                </Suspense>
              ) : inner.files.length === 0 ? (
                <p className="hurt-empty">This archive is empty.</p>
              ) : (
                <>
                  {inner.files.length > SEARCH_THRESHOLD && (
                    <div className="hurt-files__head">
                      <div className="hurt-files__search">
                        <HurtIcon name="search" />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder={`Search ${inner.files.length} files`}
                          aria-label="Search this archive"
                        />
                      </div>
                    </div>
                  )}
                  <ul className="hurt-archive__list">
                    {matches.slice(0, ROW_LIMIT).map((f) => (
                      <li key={f.path}>
                        <button
                          type="button"
                          className={f.risky ? 'hurt-archive__entry is-risky' : 'hurt-archive__entry'}
                          onClick={() => onOpen(f.path, inner)}
                        >
                          <HurtIcon name={kindIcon(f)} />
                          <span className="hurt-archive__path">{f.path}</span>
                          <span className="hurt-archive__size">{formatBytes(f.size)}</span>
                        </button>
                      </li>
                    ))}
                    {matches.length > ROW_LIMIT && (
                      <li className="hurt-note">{matches.length - ROW_LIMIT} more files. Search to narrow the list.</li>
                    )}
                  </ul>
                </>
              )}
            </>
          )
        }}
      </Gate>
    </div>
  )
}
