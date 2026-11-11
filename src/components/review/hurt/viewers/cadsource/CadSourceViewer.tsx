import { lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HurtFile, ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { formatBytes } from '../../core/format'
import { Failure, Gate, ToolButton, ToolDivider, Toolbar } from '../../ui/parts'
import HurtIcon from '../../ui/HurtIcon'
import PanZoom, { type PanZoomHandle } from '../../ui/PanZoom'
import { decodeImage } from '../ImageViewer'
import { readCadSource, resolveReference, stepExport } from './load'
import { placeholderNote } from './shared'
import type { CadInfo } from './types'

interface Picture {
  label: string
  url: string
  width: number
  height: number
}

const FEATURE_LIMIT = 60
const SOLID_EXTENSIONS = new Set(['sldprt'])

const ModelViewer = lazy(() => import('../model/ModelViewer'))

function decode(preview: CadInfo['previews'][number]): Promise<Picture | null> {
  return decodeImage(new Blob([preview.bytes as BlobPart], { type: preview.mime })).then(
    (image) => ({ label: preview.label, ...image }),
    () => null,
  )
}

function formatDate(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function round(value: number) {
  return Number(value.toPrecision(4)).toLocaleString('en-US')
}

function Readings({ title, hint, rows }: { title: string; hint?: string; rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== '')
  if (shown.length === 0) return null
  return (
    <dl className="hurt-readings">
      <dt>{title}</dt>
      {hint && <dd>{hint}</dd>}
      {shown.map(([label, value], i) => (
        <div key={i} className="hurt-readings__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function References({
  info,
  file,
  files,
  onOpen,
}: {
  info: CadInfo
  file: HurtFile
  files: HurtFile[]
  onOpen: (path: string) => void
}) {
  const resolved = useMemo(
    () =>
      (info.references ?? [])
        .map((ref) => ({
          ...ref,
          file: resolveReference(ref.name, file, files),
          source: ref.importedFrom ? resolveReference(ref.importedFrom, file, files) : null,
          stored: ref.embedded || !!ref.library,
        }))
        .sort((a, b) => Number(!a.file) + Number(a.stored) - Number(!b.file) - Number(b.stored)),
    [info, file, files],
  )
  if (resolved.length === 0) return null
  const found = resolved.filter((r) => r.file).length
  const embedded = resolved.filter((r) => !r.file && r.embedded).length
  const library = resolved.filter((r) => !r.file && !r.embedded && r.library).length
  const missing = resolved.length - found - embedded - library
  const summary = [
    `${found} of ${resolved.length} in this repository`,
    embedded > 0 && `${embedded} embedded`,
    library > 0 && `${library} from a standard parts library`,
    missing > 0 && `${missing} missing`,
  ]
  return (
    <dl className="hurt-readings">
      <dt>Referenced files</dt>
      <dd>{summary.filter(Boolean).join(' · ')}</dd>
      <dd>
        <ul className="hurt-cadsource__refs">
          {resolved.map((ref) => (
            <li key={ref.name}>
              {ref.file ? (
                <button
                  type="button"
                  className="hurt-cadsource__ref"
                  title={ref.file.path}
                  onClick={() => onOpen(ref.file!.path)}
                >
                  <HurtIcon name="link" />
                  <span>{ref.name}</span>
                </button>
              ) : (
                <div className={ref.stored ? 'hurt-cadsource__ref' : 'hurt-cadsource__ref is-missing'}>
                  <HurtIcon name={ref.stored ? 'cube' : 'warning'} />
                  <span>{ref.name}</span>
                  <small>
                    {ref.embedded ? (
                      <>
                        Stored inside the {info.docType.toLowerCase()}
                        {ref.source ? (
                          <>
                            , imported from{' '}
                            <button type="button" title={ref.source.path} onClick={() => onOpen(ref.source!.path)}>
                              {ref.importedFrom}
                            </button>
                          </>
                        ) : (
                          ref.importedFrom && `, imported from ${ref.importedFrom}`
                        )}
                      </>
                    ) : ref.library ? (
                      `Standard part that ${info.family} rebuilds from its library`
                    ) : (
                      'Not in this repository'
                    )}
                  </small>
                </div>
              )}
            </li>
          ))}
        </ul>
      </dd>
    </dl>
  )
}

function Details({
  info,
  file,
  files,
  onOpen,
}: {
  info: CadInfo
  file: HurtFile
  files: HurtFile[]
  onOpen: (path: string) => void
}) {
  const { configurations, mass, features } = info
  const units = info.lengthUnit ? ` Lengths in ${info.lengthUnit}.` : ''
  return (
    <aside className="hurt-cadsource__side">
      <Readings
        title={`${info.family} ${info.docType.toLowerCase()}`}
        hint={info.container}
        rows={[
          ['Saved with', info.savedWith],
          ['Title', info.title],
          ['Part number', info.partNumber],
          ['Description', info.description],
          ['Material', info.material],
          ['Author', info.author],
          ['Last saved by', info.lastSavedBy],
          ['Created', formatDate(info.created)],
          ['Modified', formatDate(info.modified)],
          ['Component instances', info.instances || null],
          ['Configuration', configurations.length === 1 ? configurations[0] : null],
        ]}
      />
      {configurations.length > 1 && (
        <Readings
          title="Configurations"
          rows={configurations.slice(0, 50).map((name, i): [string, ReactNode] => [String(i + 1), name])}
        />
      )}
      {mass && (
        <Readings
          title="Mass properties"
          hint={
            mass.kg === null
              ? 'Cached by SolidWorks at the last rebuild. No material is assigned, so the mass is left out.'
              : 'Cached by SolidWorks at the last rebuild, so they may be out of date.'
          }
          rows={[
            ['Mass', mass.kg === null ? null : mass.kg < 1 ? `${round(mass.kg * 1000)} g` : `${round(mass.kg)} kg`],
            ['Volume', mass.m3 && `${round(mass.m3 * 1e6)} cm³`],
            ['Surface area', mass.m2 && `${round(mass.m2 * 1e4)} cm²`],
          ]}
        />
      )}
      <References info={info} file={file} files={files} onOpen={onOpen} />
      <Readings
        title="Custom properties"
        rows={info.properties.map((p): [string, ReactNode] => [p.config ? `${p.name} (${p.config})` : p.name, p.value])}
      />
      <Readings
        title="Dimensioned features"
        hint={
          (features.length > FEATURE_LIMIT
            ? `First ${FEATURE_LIMIT} of ${features.length}, from the saved feature tree.`
            : 'From the saved feature tree.') + units
        }
        rows={features.slice(0, FEATURE_LIMIT).map((f): [string, ReactNode] => [f.name, f.dimensions.join(', ')])}
      />
    </aside>
  )
}

export default function CadSourceViewer(props: ViewerProps) {
  const { file } = props
  const [solid, setSolid] = useState(SOLID_EXTENSIONS.has(file.ext))
  const note = placeholderNote(file.name, file.size)
  if (!note && solid)
    return (
      <ModelViewer
        {...props}
        file={{ ...file, kind: 'model' }}
        actions={<ToolButton icon="document" label="File details" text onClick={() => setSolid(false)} />}
      />
    )
  if (!note) return <CadSource {...props} onSolid={SOLID_EXTENSIONS.has(file.ext) ? () => setSolid(true) : undefined} />
  return (
    <div className="hurt-cadsource">
      <Toolbar title={file.name} meta={formatBytes(file.size)} />
      <div className="hurt-state">
        <p>{note}</p>
      </div>
    </div>
  )
}

function CadSource({ file, source, onOpen, onSolid }: ViewerProps & { onSolid?: () => void }) {
  const panzoom = useRef<PanZoomHandle>(null)
  const [scale, setScale] = useState(1)
  const [index, setIndex] = useState(0)
  const step = useMemo(() => stepExport(file, source.files), [file, source.files])
  const state = useLoad(
    async ({ signal, progress }) => {
      const info = await readCadSource(source, file, { signal, progress })
      const pictures = (await Promise.all(info.previews.map(decode))).filter((p): p is Picture => p !== null)
      if (signal.aborted) pictures.forEach((p) => URL.revokeObjectURL(p.url))
      return { info, pictures }
    },
    [source.id, file.path],
  )

  useEffect(() => setIndex(0), [source.id, file.path])

  useEffect(() => {
    if (state.status !== 'ready') return
    const { pictures } = state.value
    return () => pictures.forEach((p) => URL.revokeObjectURL(p.url))
  }, [state])

  const ready = state.status === 'ready' ? state.value : null
  const picture = ready?.pictures[Math.min(index, ready.pictures.length - 1)]
  const meta = [
    ready ? `${ready.info.family} ${ready.info.docType.toLowerCase()}` : null,
    ready?.info.savedWith,
    formatBytes(file.size),
    picture ? `${Math.round(scale * 100)}%` : null,
  ]

  return (
    <div className="hurt-cadsource">
      <Toolbar title={file.name} meta={meta.filter(Boolean).join(' · ')}>
        {ready && ready.pictures.length > 1 && (
          <>
            {ready.pictures.map((p, i) => (
              <ToolButton
                key={i}
                icon="image"
                label={p.label}
                text
                active={picture === p}
                onClick={() => setIndex(i)}
              />
            ))}
            <ToolDivider />
          </>
        )}
        {picture && (
          <>
            <ToolButton icon="minus" label="Zoom out" onClick={() => panzoom.current?.zoom(1 / 1.5)} />
            <ToolButton icon="plus" label="Zoom in" onClick={() => panzoom.current?.zoom(1.5)} />
            <ToolButton icon="fit" label="Fit" onClick={() => panzoom.current?.fit()} />
          </>
        )}
        {onSolid && <ToolButton icon="cube" label="3D model" text onClick={onSolid} />}
        {step && <ToolButton icon="cube" label="Open STEP export" text onClick={() => onOpen(step.path)} />}
      </Toolbar>
      {ready && (
        <p className="hurt-note">
          {onSolid
            ? 'The 3D model is rebuilt from the Parasolid bodies saved in this file.'
            : `${ready.info.family} stores geometry in a closed format that only ${ready.info.family} can open.`}{' '}
          {ready.pictures.length > 0 ? 'These are the preview images and properties' : 'These are the properties'}{' '}
          {ready.info.family} saved inside the file.{' '}
          {step
            ? 'A STEP export with the same name is in this repository.'
            : !onSolid && 'Ask for a STEP export to inspect the geometry.'}
        </p>
      )}
      {state.status === 'error' ? (
        <Failure message={state.error}>
          {source.webUrl && (
            <a
              className="btn btn--ghost btn--sm"
              href={source.webUrl(file.path)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open on GitHub
            </a>
          )}
        </Failure>
      ) : (
        <Gate state={state}>
          {({ info }) => (
            <div className="hurt-cadsource__body">
              <div className="hurt-cadsource__stage">
                {picture ? (
                  <PanZoom
                    key={picture.url}
                    ref={panzoom}
                    width={picture.width}
                    height={picture.height}
                    className="hurt-checker"
                    onViewChange={setScale}
                  >
                    <img
                      src={picture.url}
                      alt={`${picture.label} of ${file.name}`}
                      width={picture.width}
                      height={picture.height}
                      draggable={false}
                      className="hurt-image__img"
                      data-pixelated={scale > 1 ? '' : undefined}
                    />
                  </PanZoom>
                ) : (
                  <div className="hurt-cadsource__none">
                    {info.previews.length > 0 ? (
                      <>
                        <strong>Preview unreadable</strong>
                        <span>The preview image saved in this file could not be decoded.</span>
                      </>
                    ) : (
                      <>
                        <strong>No preview saved</strong>
                        <span>{info.family} did not store a preview image in this file.</span>
                      </>
                    )}
                  </div>
                )}
              </div>
              <Details info={info} file={file} files={source.files} onOpen={onOpen} />
            </div>
          )}
        </Gate>
      )}
    </div>
  )
}
