import { useMemo, useState } from 'react'
import type { CommitData, CompareFile, FileSource, ShipMark } from '../types'
import { loadCommits, loadCompare, type RepoEndpoints } from '../core/api'
import { useLoad } from '../core/useLoad'
import { relativeTime } from '../core/format'
import { Gate, Toolbar } from '../ui/parts'
import HurtIcon from '../ui/HurtIcon'

interface Preset {
  label: string
  base: string
  head: string
}

const STATUS_LABEL: Record<string, string> = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Changed',
  changed: 'Changed',
  renamed: 'Renamed',
  copied: 'Copied',
  unchanged: 'Unchanged',
}

function commitAt(commits: CommitData[], iso: string | null) {
  if (!iso) return null
  const time = Date.parse(iso)
  return commits.find((c) => c.date && Date.parse(c.date) <= time) ?? null
}

function presets(commits: CommitData[], ships: ShipMark[], shipId: string | null): Preset[] {
  const head = commits[0]?.sha
  if (!head) return []
  const list: Preset[] = []
  const index = ships.findIndex((s) => s.id === shipId)
  const previous = index > 0 ? ships[index - 1] : null
  const atPrevious = previous && commitAt(commits, previous.reviewed_at ?? previous.submitted_at)
  if (atPrevious && atPrevious.sha !== head)
    list.push({
      // Half Life: hand-ins are named by phase – a cuid after '#' tells a reviewer nothing.
      label: `Since the ${previous.kind} hand-in was ${previous.reviewed_at ? 'reviewed' : 'submitted'}`,
      base: atPrevious.sha,
      head,
    })
  const atSubmission = index >= 0 ? commitAt(commits, ships[index].submitted_at) : null
  if (atSubmission && atSubmission.sha !== head)
    list.push({ label: 'Since this ship was submitted', base: atSubmission.sha, head })
  if (commits[1]) list.push({ label: 'Latest commit', base: commits[1].sha, head })
  return list
}

export default function ChangesPanel({
  endpoints,
  shipId,
  source,
  onOpen,
}: {
  endpoints: RepoEndpoints
  shipId: string | null
  source: FileSource
  onOpen: (path: string) => void
}) {
  const history = useLoad(({ signal }) => loadCommits(endpoints, signal), [endpoints.commits])
  return (
    <div className="hurt-changes">
      <Gate state={history}>
        {({ commits, complete, ships }) =>
          commits.length < 2 ? (
            <p className="hurt-empty">
              This repository has {commits.length === 1 ? 'one commit' : 'no commits'}, so there is nothing to compare.
            </p>
          ) : (
            <Compare
              commits={commits}
              complete={complete}
              ships={ships}
              shipId={shipId}
              endpoints={endpoints}
              source={source}
              onOpen={onOpen}
            />
          )
        }
      </Gate>
    </div>
  )
}

function Compare({
  commits,
  complete,
  ships,
  shipId,
  endpoints,
  source,
  onOpen,
}: {
  commits: CommitData[]
  complete: boolean
  ships: ShipMark[]
  shipId: string | null
  endpoints: RepoEndpoints
  source: FileSource
  onOpen: (path: string) => void
}) {
  const options = useMemo(() => presets(commits, ships, shipId), [commits, ships, shipId])
  const [range, setRange] = useState({
    base: options[0]?.base ?? commits[1].sha,
    head: options[0]?.head ?? commits[0].sha,
  })
  const ordered = useMemo(() => {
    const at = (sha: string) => commits.findIndex((c) => c.sha === sha)
    return at(range.base) < at(range.head) ? { base: range.head, head: range.base } : range
  }, [commits, range])
  const diff = useLoad(
    ({ signal }) =>
      ordered.base === ordered.head
        ? Promise.resolve(null)
        : loadCompare(endpoints, ordered.base, ordered.head, signal),
    [endpoints.compare, ordered.base, ordered.head],
  )
  const partial = !complete
  const marks = useMemo(() => {
    const byCommit = new Map<string, string[]>()
    for (const ship of ships) {
      for (const [label, iso] of [
        [`${ship.kind} hand-in submitted`, ship.submitted_at],
        [`${ship.kind} hand-in ${ship.status}`, ship.reviewed_at],
      ] as const) {
        const commit = commitAt(commits, iso)
        if (!commit || !iso) continue
        byCommit.set(commit.sha, [...(byCommit.get(commit.sha) ?? []), label])
      }
    }
    return byCommit
  }, [commits, ships])

  const option = (c: CommitData, i: number) => (
    <option key={c.sha} value={c.sha}>
      {`${partial ? '' : `${commits.length - i}. `}${c.sha.slice(0, 7)} ${c.message.slice(0, 60)}${marks.has(c.sha) ? ` · ${marks.get(c.sha)!.join(', ')}` : ''}`}
    </option>
  )

  return (
    <>
      <Toolbar
        title="Changes between commits"
        meta={partial ? `Latest ${commits.length} commits (older history not loaded)` : `${commits.length} commits`}
      >
        {options.map((p) => (
          <button
            key={p.label}
            type="button"
            className={
              range.base === p.base && range.head === p.head
                ? 'hurt-tool hurt-tool--text is-active'
                : 'hurt-tool hurt-tool--text'
            }
            onClick={() => setRange({ base: p.base, head: p.head })}
          >
            {p.label}
          </button>
        ))}
      </Toolbar>
      <div className="hurt-changes__range">
        <label>
          <span>From</span>
          <select
            className="hurt-select"
            value={range.base}
            onChange={(e) => setRange((r) => ({ ...r, base: e.target.value }))}
          >
            {commits.map(option)}
          </select>
        </label>
        <label>
          <span>To</span>
          <select
            className="hurt-select"
            value={range.head}
            onChange={(e) => setRange((r) => ({ ...r, head: e.target.value }))}
          >
            {commits.map(option)}
          </select>
        </label>
      </div>
      <Gate state={diff}>
        {(result) =>
          !result ? (
            <p className="hurt-empty">Pick two different commits.</p>
          ) : (
            <div className="hurt-changes__body">
              <p className="hurt-changes__summary">
                {result.total_commits} {result.total_commits === 1 ? 'commit' : 'commits'} · {result.files.length}{' '}
                {result.files.length === 1 ? 'file' : 'files'} ·{' '}
                <span className="is-add">+{result.files.reduce((s, f) => s + f.additions, 0)}</span>{' '}
                <span className="is-del">−{result.files.reduce((s, f) => s + f.deletions, 0)}</span>
                {result.truncated && ' · GitHub lists at most 300 files'}
                {ordered !== range && ' · showing older to newer'}
              </p>
              <p className="hurt-changes__when">
                {commits.find((c) => c.sha === ordered.head)?.message} ·{' '}
                {relativeTime(commits.find((c) => c.sha === ordered.head)?.date ?? null)}
              </p>
              {result.files.map((file) => (
                <ChangedFile
                  key={file.filename}
                  file={file}
                  openable={source.byPath.has(file.filename)}
                  empty={source.byPath.get(file.filename)?.size === 0}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )
        }
      </Gate>
    </>
  )
}

function ChangedFile({
  file,
  openable,
  empty,
  onOpen,
}: {
  file: CompareFile
  openable: boolean
  empty: boolean
  onOpen: (path: string) => void
}) {
  const unchanged = file.additions + file.deletions === 0
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`hurt-change is-${file.status}`}>
      <div className="hurt-change__head">
        <button
          type="button"
          className="hurt-change__toggle"
          disabled={!file.patch}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <HurtIcon name={file.patch ? (expanded ? 'chevron-down' : 'chevron-right') : 'file'} />
          <span className="hurt-change__status">{STATUS_LABEL[file.status] ?? file.status}</span>
          <span className="hurt-change__name">
            {file.previous_filename && file.status === 'renamed'
              ? `${file.previous_filename} → ${file.filename}`
              : file.filename}
          </span>
          <span className="hurt-change__stat">
            {file.additions > 0 && <span className="is-add">+{file.additions}</span>}{' '}
            {file.deletions > 0 && <span className="is-del">−{file.deletions}</span>}
            {!file.patch &&
              file.status !== 'removed' &&
              (empty && unchanged
                ? ' empty file'
                : file.status === 'renamed' && unchanged
                  ? ' no text changes'
                  : ' binary or too large to diff')}
          </span>
        </button>
        {openable && (
          <button type="button" className="hurt-tool hurt-tool--text" onClick={() => onOpen(file.filename)}>
            Open
          </button>
        )}
      </div>
      {expanded && file.patch && (
        <pre className="hurt-patch">
          {file.patch.split('\n').map((line, i) => (
            <span
              key={i}
              className={
                line.startsWith('@@')
                  ? 'is-hunk'
                  : line.startsWith('+')
                    ? 'is-add'
                    : line.startsWith('-')
                      ? 'is-del'
                      : undefined
              }
            >
              {line || ' '}
              {'\n'}
            </span>
          ))}
          {file.patch_truncated && (
            <span className="is-hunk">Diff cut short; open the file on GitHub for the rest.</span>
          )}
        </pre>
      )}
    </div>
  )
}
