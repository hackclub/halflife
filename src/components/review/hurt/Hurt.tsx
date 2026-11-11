import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FileSource, HurtFile } from './types'
import { loadRepo, repoEndpoints, shipEndpoints, type RepoEndpoints } from './core/api'
import { useLoad } from './core/useLoad'
import { defaultFile } from './core/classify'
import { prepSummary, preprocess, usePrepVersion } from './core/prefetch'
import { useSizeVersion } from './core/source'
import { Gate, ToolButton } from './ui/parts'
import HurtIcon from './ui/HurtIcon'
import ResizeHandle, { useStoredWidth } from './ui/ResizeHandle'
import FileExplorer from './explorer/FileExplorer'
import Viewer from './viewers/Viewer'
import ChangesPanel from './changes/ChangesPanel'
import RepoPanel, { githubUrl } from './repo/RepoPanel'

interface Selection {
  source: FileSource
  file: HurtFile
}

export default function Hurt({
  shipId = null,
  repo,
  tools,
}: {
  shipId?: string | null
  repo?: string
  tools?: ReactNode
}) {
  const endpoints = useMemo(() => (shipId === null ? repoEndpoints(repo ?? '') : shipEndpoints(shipId)), [shipId, repo])
  const loaded = useLoad(() => loadRepo(endpoints), [endpoints.files])
  if (tools && loaded.status !== 'ready')
    return (
      <div className="hurt">
        <header className="hurt__bar">
          <div className="hurt__actions">{tools}</div>
        </header>
        <Gate state={loaded}>{() => null}</Gate>
      </div>
    )
  return (
    <Gate state={loaded}>
      {({ snapshot, source }) => (
        <Browser
          shipId={shipId}
          endpoints={endpoints}
          source={source}
          branch={snapshot.branch}
          truncated={snapshot.truncated}
          tools={tools}
        />
      )}
    </Gate>
  )
}

function Browser({
  shipId,
  endpoints,
  source,
  branch,
  truncated,
  tools,
}: {
  shipId: string | null
  endpoints: RepoEndpoints
  source: FileSource
  branch: string | null
  truncated: boolean
  tools?: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const [trail, setTrail] = useState<Selection[]>([])
  const [selection, setSelection] = useState<Selection | null>(() => {
    const file = defaultFile(source.files)
    return file ? { source, file } : null
  })
  const [panel, setPanel] = useState<'files' | 'repo' | 'changes'>('files')
  const [repoPath, setRepoPath] = useState('')
  const [sidebar, setSidebar] = useState(true)
  const [sideWidth, setSideWidth] = useStoredWidth('hurt:side-width', 304)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => preprocess(source, 0), [source])

  useEffect(() => {
    if (!selection) return
    const { path, ext, kind } = selection.file
    window.dispatchEvent(new CustomEvent('hurt:open', { detail: { path, ext, kind } }))
  }, [selection])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('hurt:panel', { detail: panel }))
  }, [panel])

  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [])

  const open = useCallback(
    (path: string, inner?: FileSource) => {
      const target = inner ?? source
      const file = target.byPath.get(path)
      if (!file) return
      if (inner && selection) setTrail((t) => [...t, selection])
      if (!inner) setTrail([])
      setSelection({ source: target, file })
      setPanel('files')
    },
    [selection, source],
  )

  const select = useCallback(
    (file: HurtFile) => {
      setTrail([])
      setSelection({ source, file })
      setPanel('files')
    },
    [source],
  )

  const openFromRepo = useCallback(
    (path: string, inner?: FileSource) => {
      if (!inner) return setRepoPath(path)
      const file = inner.byPath.get(path)
      const from = source.byPath.get(repoPath)
      if (!file) return
      setTrail(from ? [{ source, file: from }] : [])
      setSelection({ source: inner, file })
      setPanel('files')
    },
    [repoPath, source],
  )

  const sha = source.id.split('@')[1] ?? ''
  const side = sidebar && panel !== 'repo'
  const github = panel === 'repo' ? githubUrl(source, sha, repoPath) : selection?.source.webUrl?.(selection.file.path)

  return (
    <div ref={root} className={fullscreen ? 'hurt is-fullscreen' : 'hurt'}>
      <header className="hurt__bar">
        {panel !== 'repo' && (
          <ToolButton
            icon="list"
            label={sidebar ? 'Hide file list' : 'Show file list'}
            active={sidebar}
            onClick={() => setSidebar((v) => !v)}
          />
        )}
        <div className="hurt__repo">
          <a href={`https://github.com/${source.label}/tree/${sha}`} target="_blank" rel="noopener noreferrer">
            {source.label}
          </a>
          <span className="hurt__meta">
            {branch ?? 'default branch'} · {sha.slice(0, 7)} · {source.files.length} files
            {truncated && ' · GitHub cut the file list short, so some folders are missing'}
          </span>
        </div>
        <PrepSummary source={source} />
        <div className="hurt__actions">
          {tools}
          <button
            type="button"
            className={panel === 'files' ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
            onClick={() => setPanel('files')}
          >
            Viewer
          </button>
          <button
            type="button"
            className={panel === 'repo' ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
            onClick={() => setPanel('repo')}
          >
            Repository
          </button>
          <button
            type="button"
            className={panel === 'changes' ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
            onClick={() => setPanel('changes')}
          >
            Changes
          </button>
          {github && (
            <a
              className="hurt-tool"
              href={github}
              target="_blank"
              rel="noopener noreferrer"
              title="Open on GitHub"
              aria-label="Open on GitHub"
            >
              <HurtIcon name="external" />
            </a>
          )}
          <ToolButton
            icon="expand"
            label={fullscreen ? 'Leave full screen' : 'Full screen'}
            active={fullscreen}
            onClick={() => (fullscreen ? void document.exitFullscreen() : void root.current?.requestFullscreen())}
          />
        </div>
      </header>
      <div
        className={side ? 'hurt__body' : 'hurt__body is-collapsed'}
        style={{ '--hurt-side': `${sideWidth}px` } as React.CSSProperties}
      >
        <aside className="hurt__side" hidden={!side}>
          <FileExplorer
            source={source}
            selected={selection?.source === source ? selection.file.path : null}
            onSelect={select}
          />
        </aside>
        {side && (
          <ResizeHandle
            edge="end"
            width={sideWidth}
            min={224}
            max={640}
            label="Resize file list"
            onResize={setSideWidth}
          />
        )}
        <main className="hurt__main">
          {panel === 'changes' ? (
            <ChangesPanel endpoints={endpoints} shipId={shipId} source={source} onOpen={(path) => open(path)} />
          ) : panel === 'repo' ? (
            <RepoPanel
              endpoints={endpoints}
              source={source}
              branch={branch}
              path={repoPath}
              onNavigate={setRepoPath}
              onOpen={openFromRepo}
            />
          ) : selection ? (
            <>
              {trail.length > 0 && (
                <nav className="hurt__trail" aria-label="Opened from">
                  <button
                    type="button"
                    className="hurt-tool hurt-tool--text"
                    onClick={() => {
                      setSelection(trail[trail.length - 1])
                      setTrail((t) => t.slice(0, -1))
                    }}
                  >
                    ← {trail[trail.length - 1].file.name}
                  </button>
                  <span>{selection.file.path}</span>
                </nav>
              )}
              <Viewer
                key={`${selection.source.id}|${selection.file.path}`}
                file={selection.file}
                source={selection.source}
                onOpen={(path, inner) =>
                  open(path, inner ?? (selection.source === source ? undefined : selection.source))
                }
              />
            </>
          ) : (
            <p className="hurt-empty">This repository is empty.</p>
          )}
        </main>
      </div>
    </div>
  )
}

function PrepSummary({ source }: { source: FileSource }) {
  usePrepVersion()
  useSizeVersion()
  const summary = prepSummary(source)
  return (
    <span className="hurt__prep" title="Files are downloaded and processed in the background so they open instantly">
      {summary.total === 0
        ? ''
        : summary.pending > 0
          ? `Preparing ${summary.ready}/${summary.total}`
          : `${summary.ready} files ready`}
      {summary.failed > 0 && ` · ${summary.failed} failed`}
    </span>
  )
}
