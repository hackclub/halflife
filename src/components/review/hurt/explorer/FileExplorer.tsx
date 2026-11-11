import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { FileSource, HurtFile } from '../types'
import { formatBytes } from '../core/format'
import { isBomPage, isLibraryPath, pinnedGroups } from '../core/classify'
import { useBomPagesVersion, usePrepStatus } from '../core/prefetch'
import { useSizeVersion } from '../core/source'
import HurtIcon from '../ui/HurtIcon'
import { kindIcon, kindLabel } from './icons'

interface Folder {
  name: string
  path: string
  folders: Folder[]
  files: HurtFile[]
  interesting: boolean
}

const SEARCH_LIMIT = 300
const EXPAND_ROWS = 1500

function buildTree(files: HurtFile[]) {
  const root: Folder = { name: '', path: '', folders: [], files: [], interesting: false }
  const folders = new Map<string, Folder>([['', root]])
  for (const file of files) {
    let parent = root
    let path = ''
    for (const part of file.dir ? file.dir.split('/') : []) {
      path = path ? `${path}/${part}` : part
      let folder = folders.get(path)
      if (!folder) {
        folder = { name: part, path, folders: [], files: [], interesting: false }
        folders.set(path, folder)
        parent.folders.push(folder)
      }
      parent = folder
    }
    parent.files.push(file)
  }
  const mark = (folder: Folder): boolean => {
    const own =
      folder.files.some((f) => (f.kind === 'html' ? isBomPage(f) : !['text', 'binary', 'image'].includes(f.kind))) &&
      !isLibraryPath(folder.path)
    const nested = folder.folders.map(mark).some(Boolean)
    folder.interesting = own || nested
    folder.folders.sort((a, b) => a.name.localeCompare(b.name))
    folder.files.sort((a, b) => a.name.localeCompare(b.name))
    return folder.interesting
  }
  mark(root)
  return root
}

export default function FileExplorer({
  source,
  selected,
  onSelect,
}: {
  source: FileSource
  selected: string | null
  onSelect: (file: HurtFile) => void
}) {
  const sizes = useSizeVersion()
  const [view, setView] = useState<'pinned' | 'all'>('pinned')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const sniffed = useBomPagesVersion()
  const groups = useMemo(() => pinnedGroups(source.files), [source, sniffed, sizes])
  const tree = useMemo(() => buildTree(source.files), [source])
  const list = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const latestSelect = useRef(onSelect)
  latestSelect.current = onSelect
  const select = useCallback((file: HurtFile) => latestSelect.current(file), [])

  useEffect(() => {
    const expanded = new Set<string>()
    const pending = [...tree.folders]
    let rows = tree.folders.length + tree.files.length
    for (let folder = pending.shift(); folder; folder = pending.shift()) {
      if (!folder.interesting) continue
      rows += folder.folders.length + folder.files.length
      if (rows > EXPAND_ROWS) break
      expanded.add(folder.path)
      pending.push(...folder.folders)
    }
    setOpen(expanded)
  }, [tree])

  useEffect(() => {
    if (!selected) return
    const group = groups.find((g) => g.files.some(({ file }) => file.path === selected))
    if (view === 'pinned' && !group) setView('all')
    if (group?.files.some(({ file, hidden }) => hidden && file.path === selected))
      setExpanded((current) => (current.has(group.title) ? current : new Set(current).add(group.title)))
    const parts = selected.split('/').slice(0, -1)
    if (parts.length === 0) return
    setOpen((current) => {
      const next = new Set(current)
      parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join('/')))
      return next.size === current.size ? current : next
    })
  }, [selected])

  useEffect(() => {
    list.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected, view])

  const needle = query.trim().toLowerCase()
  const found = useMemo(
    () => (needle ? source.files.filter((f) => f.path.toLowerCase().includes(needle)) : []),
    [needle, source],
  )
  const matches = found.slice(0, SEARCH_LIMIT)

  const row = (file: HurtFile, depth: number, label?: string, subtitle?: string) => (
    <FileRow
      key={`${file.path}|${label ?? ''}`}
      source={source}
      file={file}
      size={file.size}
      sniffed={sniffed}
      depth={depth}
      label={label}
      subtitle={subtitle}
      selected={selected === file.path}
      onSelect={select}
    />
  )

  const searchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && matches[0]) select(matches[0])
    else if (event.key === 'ArrowDown') {
      event.preventDefault()
      list.current?.querySelector<HTMLButtonElement>('.hurt-files__row')?.focus()
    }
  }

  const listKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>('.hurt-files__row') ?? [])]
    const index = rows.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = index + (event.key === 'ArrowDown' ? 1 : -1)
    if (next < 0) search.current?.focus()
    else rows[Math.min(next, rows.length - 1)].focus()
  }

  const folder = (node: Folder, depth: number): ReactNode =>
    node.folders.map((child) => (
      <div key={child.path} role="group">
        <button
          type="button"
          className="hurt-files__row hurt-files__folder"
          style={{ '--depth': depth } as React.CSSProperties}
          aria-expanded={open.has(child.path)}
          onClick={() =>
            setOpen((current) => {
              const next = new Set(current)
              if (next.has(child.path)) next.delete(child.path)
              else next.add(child.path)
              return next
            })
          }
        >
          <HurtIcon name={open.has(child.path) ? 'folder-open' : 'folder'} />
          <span className="hurt-files__name">{child.name}</span>
        </button>
        {open.has(child.path) && (
          <>
            {folder(child, depth + 1)}
            {child.files.map((f) => row(f, depth + 1))}
          </>
        )}
      </div>
    ))

  return (
    <div className="hurt-files">
      <div className="hurt-files__head">
        <div className="hurt-files__search">
          <HurtIcon name="search" />
          <input
            ref={search}
            value={query}
            onKeyDown={searchKey}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${source.files.length} files`}
            aria-label="Search files"
          />
        </div>
        {!needle && (
          <div className="hurt-files__views" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'pinned'}
              className={view === 'pinned' ? 'is-active' : ''}
              onClick={() => setView('pinned')}
            >
              Key files
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'all'}
              className={view === 'all' ? 'is-active' : ''}
              onClick={() => setView('all')}
            >
              All files
            </button>
          </div>
        )}
      </div>
      <div ref={list} className="hurt-files__list" onKeyDown={listKey}>
        {needle ? (
          matches.length > 0 ? (
            <>
              {matches.map((f) => row(f, 0, undefined, f.dir || undefined))}
              {found.length > matches.length && (
                <p className="hurt-note">
                  Showing {matches.length} of {found.length} matches. Narrow the search to see the rest.
                </p>
              )}
            </>
          ) : (
            <p className="hurt-empty">No files match.</p>
          )
        ) : view === 'pinned' ? (
          groups.length > 0 ? (
            groups.map((group) => {
              const more = group.files.filter((f) => f.hidden).length
              const all = expanded.has(group.title)
              return (
                <section key={group.title} className="hurt-files__group">
                  <h3 className="hurt-files__title">{group.title}</h3>
                  {group.files
                    .filter((f) => all || !f.hidden)
                    .map(({ file, label }) => row(file, 0, label, label ? undefined : file.dir || undefined))}
                  {more > 0 && (
                    <button
                      type="button"
                      className="hurt-files__more"
                      aria-expanded={all}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current)
                          if (all) next.delete(group.title)
                          else next.add(group.title)
                          return next
                        })
                      }
                    >
                      {all ? 'Show fewer' : `Show ${more} more`}
                    </button>
                  )}
                </section>
              )
            })
          ) : (
            <p className="hurt-empty">No key files found. Try All files.</p>
          )
        ) : (
          <>
            {folder(tree, 0)}
            {tree.files.map((f) => row(f, 0))}
          </>
        )}
      </div>
    </div>
  )
}

const FileRow = memo(function FileRow({
  source,
  file,
  size,
  depth,
  label,
  subtitle,
  selected,
  onSelect,
}: {
  source: FileSource
  file: HurtFile
  size: number
  sniffed: number
  depth: number
  label?: string
  subtitle?: string
  selected: boolean
  onSelect: (file: HurtFile) => void
}) {
  const status = usePrepStatus(source, file.path)
  return (
    <button
      type="button"
      className={`hurt-files__row${selected ? ' is-selected' : ''}${file.risky ? ' is-risky' : ''}`}
      style={{ '--depth': depth } as React.CSSProperties}
      onClick={() => onSelect(file)}
      title={file.path}
    >
      <HurtIcon name={kindIcon(file)} />
      <span className="hurt-files__name">
        <span>{label ?? file.name}</span>
        {subtitle && <span className="hurt-files__sub">{subtitle}</span>}
      </span>
      <span className="hurt-files__size">{file.kind === 'submodule' ? 'link' : formatBytes(size)}</span>
      <span
        className={`hurt-files__dot${status ? ` is-${status}` : ''}`}
        title={status ? `Preparation: ${status}` : `${kindLabel(file)} file`}
      />
    </button>
  )
})
