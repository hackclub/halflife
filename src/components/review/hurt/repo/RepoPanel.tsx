import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { FileSource, HurtFile } from '../types'
import { loadCommits, type RepoEndpoints } from '../core/api'
import { useLoad } from '../core/useLoad'
import { useSizeVersion } from '../core/source'
import { formatBytes, plural, relativeTime } from '../core/format'
import { ToolButton } from '../ui/parts'
import HurtIcon, { type HurtIconName } from '../ui/HurtIcon'
import Viewer from '../viewers/Viewer'
import { kindIcon, kindLabel } from '../explorer/icons'

const FIND_LIMIT = 20
const TYPE_LIMIT = 8
const DOCS: { name: RegExp; label: string; icon: HurtIconName }[] = [
  { name: /^readme(\.|$)/i, label: 'README', icon: 'book' },
  { name: /^(licen[cs]e|copying)(\.|$)/i, label: 'License', icon: 'document' },
  { name: /^code[_-]of[_-]conduct(\.|$)/i, label: 'Code of conduct', icon: 'document' },
  { name: /^contributing(\.|$)/i, label: 'Contributing', icon: 'document' },
  { name: /^security(\.|$)/i, label: 'Security', icon: 'document' },
]

interface Doc {
  label: string
  icon: HurtIconName
  file: HurtFile
}

function listDir(files: HurtFile[], dir: string) {
  const prefix = dir ? `${dir}/` : ''
  const nested = new Map<string, string[]>()
  const own: HurtFile[] = []
  for (const file of files) {
    if (file.dir === dir) own.push(file)
    else if (file.path.startsWith(prefix)) {
      const [name, ...rest] = file.path.slice(prefix.length).split('/')
      const rests = nested.get(name) ?? []
      rests.push(rest.join('/'))
      nested.set(name, rests)
    }
  }
  const folders = [...nested].map(([name, rests]) => {
    let label = name
    for (;;) {
      const next = rests[0].split('/')[0]
      if (!rests.every((r) => r.startsWith(`${next}/`))) break
      label += `/${next}`
      rests = rests.map((r) => r.slice(next.length + 1))
    }
    return label
  })
  folders.sort((a, b) => a.localeCompare(b))
  own.sort((a, b) => a.name.localeCompare(b.name))
  const docs = (dir ? DOCS.slice(0, 1) : DOCS).flatMap(({ name, label, icon }): Doc[] => {
    const file =
      own.find((f) => f.kind === 'markdown' && name.test(f.name)) ??
      own.find((f) => f.kind === 'text' && name.test(f.name))
    return file ? [{ label, icon, file }] : []
  })
  return { folders, files: own, docs }
}

export function githubUrl(source: FileSource, sha: string, path: string) {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return source.byPath.has(path)
    ? source.webUrl?.(path)
    : `https://github.com/${source.label}/tree/${sha}${encoded ? `/${encoded}` : ''}`
}

export default function RepoPanel({
  endpoints,
  source,
  branch,
  path,
  onNavigate,
  onOpen,
}: {
  endpoints: RepoEndpoints
  source: FileSource
  branch: string | null
  path: string
  onNavigate: (path: string) => void
  onOpen: (path: string, inner?: FileSource) => void
}) {
  const file = source.byPath.get(path)
  const dir = file ? file.dir : path
  const listing = useMemo(() => (file ? null : listDir(source.files, dir)), [source, dir, file])
  const parts = path ? path.split('/') : []
  const [copied, setCopied] = useState(false)

  const bar = (
    <div className={file ? 'hurt-repo__top is-file' : 'hurt-repo__top'}>
      <span className="hurt-repo__branch" title={source.id.split('@')[1]}>
        <HurtIcon name="branch" />
        {branch ?? 'default branch'}
      </span>
      {path && (
        <nav className="hurt-repo__crumbs" aria-label="Location">
          {[source.label.split('/').pop(), ...parts].map((part, i) => (
            <span key={i}>
              {i > 0 && <span aria-hidden="true">/</span>}
              {i === parts.length ? (
                <strong aria-current="page">{part}</strong>
              ) : (
                <button type="button" onClick={() => onNavigate(parts.slice(0, i).join('/'))}>
                  {part}
                </button>
              )}
            </span>
          ))}
          {!file && <span aria-hidden="true">/</span>}
          {file && (
            <ToolButton
              icon={copied ? 'check' : 'copy'}
              label="Copy path"
              onClick={() => {
                void navigator.clipboard.writeText(path).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            />
          )}
        </nav>
      )}
      <FindFile source={source} onOpen={onNavigate} hotkey={!file} />
    </div>
  )

  if (file)
    return (
      <div className="hurt-repo">
        {bar}
        <Viewer key={`${source.id}|${file.path}`} file={file} source={source} onOpen={onOpen} />
      </div>
    )

  return (
    <div className="hurt-repo">
      <div className="hurt-repo__scroll">
        <div className="hurt-repo__page">
          {!dir && (
            <h2 className="hurt-repo__title">
              <a href={githubUrl(source, source.id.split('@')[1] ?? '', '')} target="_blank" rel="noopener noreferrer">
                {source.label.split('/').pop()}
              </a>
            </h2>
          )}
          <div className={dir ? 'hurt-repo__layout' : 'hurt-repo__layout has-about'}>
            <div className="hurt-repo__content">
              {bar}
              {listing && (listing.folders.length > 0 || listing.files.length > 0) ? (
                <>
                  <div className="hurt-repo__table">
                    {dir ? (
                      <div className="hurt-repo__columns" aria-hidden="true">
                        <span>Name</span>
                        <span>Type</span>
                        <span>Size</span>
                      </div>
                    ) : (
                      <LatestCommit endpoints={endpoints} />
                    )}
                    {dir && (
                      <button
                        type="button"
                        className="hurt-repo__row"
                        onClick={() => onNavigate(dir.split('/').slice(0, -1).join('/'))}
                        aria-label="Parent folder"
                      >
                        <HurtIcon name="folder" className="hurt-repo__folder" />
                        <span className="hurt-repo__name">..</span>
                      </button>
                    )}
                    {listing.folders.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className="hurt-repo__row"
                        onClick={() => onNavigate(dir ? `${dir}/${name}` : name)}
                      >
                        <HurtIcon name="folder" className="hurt-repo__folder" />
                        <span className="hurt-repo__name">{name}</span>
                        <span className="hurt-repo__kind">Folder</span>
                      </button>
                    ))}
                    {listing.files.map((f) => (
                      <button
                        key={f.path}
                        type="button"
                        className={f.risky ? 'hurt-repo__row is-risky' : 'hurt-repo__row'}
                        onClick={() => onNavigate(f.path)}
                      >
                        <HurtIcon name={kindIcon(f)} />
                        <span className="hurt-repo__name">{f.name}</span>
                        <span className="hurt-repo__kind">{kindLabel(f)}</span>
                        <span className="hurt-repo__size">{f.kind === 'submodule' ? 'link' : formatBytes(f.size)}</span>
                      </button>
                    ))}
                  </div>
                  {listing.docs.length > 0 && <Docs key={dir} docs={listing.docs} source={source} onOpen={onOpen} />}
                </>
              ) : (
                <p className="hurt-empty">
                  {path ? 'This folder is not in the repository.' : 'This repository is empty.'}
                </p>
              )}
            </div>
            {!dir && listing && <About source={source} docs={listing.docs} onNavigate={onNavigate} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function About({ source, docs, onNavigate }: { source: FileSource; docs: Doc[]; onNavigate: (path: string) => void }) {
  const sizes = useSizeVersion()
  const total = useMemo(() => source.files.reduce((sum, f) => sum + f.size, 0), [source, sizes])
  const types = useMemo(() => {
    const counts = new Map<string, number>()
    for (const file of source.files) counts.set(kindLabel(file), (counts.get(kindLabel(file)) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, TYPE_LIMIT)
  }, [source])
  return (
    <aside className="hurt-repo__about">
      <section>
        <h3>About</h3>
        <ul>
          {docs.map((doc) => (
            <li key={doc.file.path}>
              <button type="button" onClick={() => onNavigate(doc.file.path)}>
                <HurtIcon name={doc.icon} />
                {doc.label}
              </button>
            </li>
          ))}
          <li>
            <HurtIcon name="file" />
            {plural(source.files.length, 'file')}
          </li>
          <li>
            <HurtIcon name="archive" />
            {formatBytes(total)}
          </li>
        </ul>
      </section>
      {types.length > 0 && (
        <section>
          <h3>File types</h3>
          <ul>
            {types.map(([label, count]) => (
              <li key={label} className="hurt-repo__type">
                <span>{label}</span>
                <span>{count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}

function Docs({
  docs,
  source,
  onOpen,
}: {
  docs: Doc[]
  source: FileSource
  onOpen: (path: string, inner?: FileSource) => void
}) {
  const [shownPath, setShownPath] = useState(docs[0].file.path)
  const shown = docs.find((doc) => doc.file.path === shownPath) ?? docs[0]
  return (
    <section className="hurt-repo__readme">
      <div className="hurt-repo__tabs" role="tablist">
        {docs.map((doc) => (
          <button
            key={doc.file.path}
            type="button"
            role="tab"
            aria-selected={doc === shown}
            className={doc === shown ? 'is-active' : undefined}
            onClick={() => setShownPath(doc.file.path)}
          >
            <HurtIcon name={doc.icon} />
            {doc.label}
          </button>
        ))}
      </div>
      <Viewer key={`${source.id}|${shown.file.path}`} file={shown.file} source={source} onOpen={onOpen} />
    </section>
  )
}

function LatestCommit({ endpoints }: { endpoints: RepoEndpoints }) {
  const history = useLoad(({ signal }) => loadCommits(endpoints, signal), [endpoints.commits])
  if (history.status === 'error') return null
  if (history.status === 'loading') return <div className="hurt-repo__commit">Loading the latest commit</div>
  const { commits, complete } = history.value
  const latest = commits[0]
  if (!latest) return null
  return (
    <div className="hurt-repo__commit">
      {latest.author && <span className="hurt-repo__author">{latest.author}</span>}
      <span className="hurt-repo__message" title={latest.message}>
        {latest.message.split('\n')[0]}
      </span>
      <span>
        {latest.sha.slice(0, 7)} · {relativeTime(latest.date)}
      </span>
      <span className="hurt-repo__count">
        <HurtIcon name="clock" />
        {complete ? plural(commits.length, 'Commit') : `${commits.length}+ Commits`}
      </span>
    </div>
  )
}

function FindFile({ source, onOpen, hotkey }: { source: FileSource; onOpen: (path: string) => void; hotkey: boolean }) {
  const list = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const needle = query.trim().toLowerCase()
  const matches = useMemo(
    () => (needle ? source.files.filter((f) => f.path.toLowerCase().includes(needle)).slice(0, FIND_LIMIT) : []),
    [needle, source],
  )

  useEffect(() => {
    if (!hotkey) return
    const press = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.key !== 't' || event.ctrlKey || event.metaKey || event.altKey) return
      if (target.closest('input, textarea, select, [contenteditable]')) return
      event.preventDefault()
      input.current?.focus()
    }
    document.addEventListener('keydown', press)
    return () => document.removeEventListener('keydown', press)
  }, [hotkey])

  const go = (file?: HurtFile) => {
    if (!file) return
    onOpen(file.path)
    setQuery('')
    setOpen(false)
  }

  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((i) => Math.max(0, Math.min(matches.length - 1, i + step)))
    } else if (event.key === 'Enter') go(matches[active])
    else if (event.key === 'Escape') {
      setQuery('')
      event.currentTarget.blur()
    }
  }

  return (
    <div className="hurt-repo__find">
      <div className="hurt-files__search">
        <HurtIcon name="search" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={key}
          placeholder="Go to file"
          aria-label="Go to file"
          role="combobox"
          aria-expanded={open && !!needle}
          aria-controls={list}
        />
        {hotkey && !query && <kbd>t</kbd>}
      </div>
      {open && needle && (
        <ul id={list} className="hurt-repo__matches" role="listbox">
          {matches.length > 0 ? (
            matches.map((f, i) => (
              <li key={f.path} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={i === active ? 'is-active' : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(f)}
                >
                  <HurtIcon name={kindIcon(f)} />
                  <span>{f.path}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="hurt-repo__nomatch">No files match.</li>
          )}
        </ul>
      )}
    </div>
  )
}
