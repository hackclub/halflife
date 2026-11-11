import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import * as THREE from 'three'
import type { ViewerProps } from '../../types'
import { useLoad } from '../../core/useLoad'
import { Failure, Loading, ToolButton, ToolDivider, Toolbar } from '../../ui/parts'
import HurtIcon from '../../ui/HurtIcon'
import { formatBytes } from '../../core/format'
import { loadModel, loadModelHistory } from './load'
import { ModelScene, type Hit, type SectionState, type Snap, type ViewName } from './engine'
import AssemblyTree from './AssemblyTree'
import Timeline from './Timeline'
import {
  describe,
  edgeEntity,
  faceEntity,
  formatArea,
  formatLength,
  formatVolume,
  relate,
  single,
  type Entity,
  type Measurement,
} from './measure'
import type { ModelData, ModelHistory, ModelUnit } from './analyze'
import { NoGeometry, SavedPreview } from '../blender/Extras'

type Mode = 'select' | 'measure' | 'hide'

const VIEWS: { name: ViewName; label: string; key: string }[] = [
  { name: 'iso', label: 'Iso', key: '0' },
  { name: 'front', label: 'Front', key: '1' },
  { name: 'back', label: 'Back', key: '2' },
  { name: 'left', label: 'Left', key: '3' },
  { name: 'right', label: 'Right', key: '4' },
  { name: 'top', label: 'Top', key: '5' },
  { name: 'bottom', label: 'Bottom', key: '6' },
]

const NO_SECTION: SectionState = { enabled: false, axis: 2, position: 0.5, flip: false }
const BLENDER = /^blend\d?$/
const UNITS: { unit: ModelUnit; label: string }[] = [
  { unit: 'mm', label: 'millimetres' },
  { unit: 'cm', label: 'centimetres' },
  { unit: 'm', label: 'metres' },
  { unit: 'in', label: 'inches' },
]

export default function ModelViewer({ file, source, actions }: ViewerProps & { actions?: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState<ModelScene | null>(null)
  const state = useLoad(({ signal, progress }) => loadModel(source, file, { signal, progress }), [source.id, file.path])
  const model = state.status === 'ready' ? state.value.model : null
  const empty = model?.parts.length === 0

  const [mode, setMode] = useState<Mode>('select')
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [history, setHistory] = useState<Set<number>[]>([])
  const [isolation, setIsolation] = useState<{ before: Set<number>; after: Set<number> } | null>(null)
  const isolated = isolation?.after === hidden
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [reveal, setReveal] = useState<number | null>(null)
  const [edges, setEdges] = useState(true)
  const [xray, setXray] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [grid, setGrid] = useState(true)
  const [perspective, setPerspective] = useState(false)
  const [up, setUp] = useState<'y' | 'z'>('z')
  const [section, setSection] = useState<SectionState>(NO_SECTION)
  const explodeInput = useRef<HTMLInputElement>(null)
  const [exploding, setExploding] = useState(false)
  const [tree, setTree] = useState(true)
  const [pending, setPending] = useState<Entity | null>(null)
  const [measurements, setMeasurements] = useState<Measurement[]>([])
  const [preview, setPreview] = useState(false)
  const [unitOverride, setUnitOverride] = useState<ModelUnit | null>(null)
  const [step, setStep] = useState<number | null>(null)
  const [past, setPast] = useState<{ first: number; history: ModelHistory } | null>(null)
  const [pastStatus, setPastStatus] = useState<string | null>(null)

  useLayoutEffect(() => {
    const created = new ModelScene(stage.current!, overlay.current!)
    setScene(created)
    return () => created.dispose()
  }, [])

  useEffect(() => {
    if (!scene || state.status !== 'ready') return
    scene.load(state.value.model, state.value.materials)
    const initial = new Set(state.value.model.hidden)
    if (initial.size) {
      scene.setHidden(initial)
      scene.fit()
    }
    setHidden(initial)
    setHistory([])
    setIsolation(null)
    setSelected(new Set())
    setPending(null)
    setMeasurements([])
    setSection(NO_SECTION)
    scene.setExplode(0)
    if (explodeInput.current) explodeInput.current.value = '0'
    setUnitOverride(null)
    setUp(state.value.model.upAxis)
    setTree(state.value.model.parts.length > 1)
    setStep(state.value.model.timeline ? state.value.model.timeline.steps.length - 1 : null)
    setPast(null)
    setPastStatus(null)
  }, [scene, state])

  const timeline = model?.timeline ?? null
  const open = step !== null
  useEffect(() => {
    if (!open || !scene || !timeline?.keys || past) return
    const controller = new AbortController()
    setPastStatus('Rebuilding the design history')
    loadModelHistory(source, file, {
      signal: controller.signal,
      progress: (fraction, message) =>
        setPastStatus(
          `${message ?? 'Rebuilding the design history'}${fraction === null ? '' : ` ${Math.round(fraction * 100)}%`}`,
        ),
    })
      .then((history) => {
        if (controller.signal.aborted) return
        setPast({ first: scene.append(history.parts, history.tools), history })
        setPastStatus(null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setPastStatus('The earlier shapes could not be rebuilt.')
      })
    return () => controller.abort()
  }, [open, scene, timeline, past, source.id, file.path])
  const finals = useMemo(
    () => (past && timeline?.keys ? timeline.keys.map((key) => past.history.finals[key]) : null),
    [past, timeline],
  )
  const future = useMemo(() => {
    const ids: number[] = []
    const earlier = past?.history
    if (!timeline || step === null) {
      if (earlier) earlier.parts.forEach((_, i) => ids.push(past.first + i))
      return ids
    }
    timeline.appear.forEach((at, i) => {
      const from = finals?.[i] ?? at
      if (from !== null && from > step) ids.push(i)
    })
    earlier?.appear.forEach((at, i) => {
      const until = earlier.until[i]
      if (at > step || (until !== null && until <= step)) ids.push(past!.first + i)
    })
    return ids
  }, [timeline, step, past, finals])
  const changed = useMemo(() => {
    if (!timeline || step === null) return []
    const ids = timeline.changed.flatMap((steps, i) => {
      const from = finals?.[i]
      return (from === undefined ? steps.includes(step) : from === step) ? [i] : []
    })
    const tools = new Set(past?.history.tools)
    past?.history.appear.forEach((at, i) => {
      if (at === step && !tools.has(i)) ids.push(past.first + i)
    })
    return ids
  }, [timeline, step, past, finals])

  useEffect(() => scene?.setHidden(future.length ? new Set([...hidden, ...future]) : hidden), [scene, hidden, future])
  useEffect(
    () => scene?.setSelected(changed.length ? new Set([...selected, ...changed]) : selected),
    [scene, selected, changed],
  )
  useEffect(() => scene?.setEdges(edges), [scene, edges])
  useEffect(() => scene?.setXray(xray), [scene, xray])
  useEffect(() => scene?.setWireframe(wireframe), [scene, wireframe])
  useEffect(() => scene?.setGrid(grid), [scene, grid])
  useEffect(() => scene?.setOrthographic(!perspective), [scene, perspective])
  useEffect(() => scene?.setSection(section), [scene, section])
  useEffect(() => {
    if (scene && model && scene.upAxis !== up) scene.setUp(up)
  }, [scene, model, up])

  const oversized = useMemo(
    () => model?.unit === 'm' && !BLENDER.test(file.ext) && largestSpan(model) > 10,
    [model, file.ext],
  )
  const unit = unitOverride ?? (model?.unit === 'unknown' || oversized ? 'mm' : (model?.unit ?? 'mm'))
  const unitPicker = model?.unit === 'unknown' || model?.unit === 'm'
  const notes = mode === 'hide' || unitPicker || (model?.warnings.length ?? 0) > 0
  const current = pending ? single(pending, unit) : null

  useEffect(() => {
    if (!scene) return
    if (mode !== 'measure') return scene.setMeasurements([])
    const items: { anchors: THREE.Vector3[]; label: string; path?: THREE.Vector3[] }[] = measurements.map((m) => ({
      anchors: m.anchors,
      label: m.primary,
    }))
    if (current && pending) items.push({ anchors: current.anchors, label: current.primary, path: entityPath(pending) })
    scene.setMeasurements(items)
  }, [scene, mode, measurements, current, pending])

  const hide = useCallback(
    (ids: number[]) => {
      if (ids.length === 0) return
      setHistory((h) => [...h.slice(-49), hidden])
      setHidden(new Set([...hidden, ...ids]))
      setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))))
    },
    [hidden],
  )

  const showAll = useCallback(() => {
    if (hidden.size === 0) return
    setHistory((h) => [...h.slice(-49), hidden])
    setHidden(new Set())
  }, [hidden])

  const isolate = useCallback(() => {
    if (isolation && isolated) {
      setHistory((h) => [...h.slice(-49), hidden])
      setHidden(isolation.before)
      setIsolation(null)
      return
    }
    if (!model || selected.size === 0) return
    const after = new Set([...hidden, ...model.parts.map((_, i) => i).filter((i) => !selected.has(i))])
    setHistory((h) => [...h.slice(-49), hidden])
    setHidden(after)
    setIsolation({ before: hidden, after })
  }, [model, selected, hidden, isolation, isolated])

  const undoHide = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h
      setHidden(h[h.length - 1])
      return h.slice(0, -1)
    })
  }, [])

  const selectParts = useCallback((parts: number[], additive: boolean) => {
    setSelected((s) => (additive ? new Set([...s, ...parts]) : new Set(parts)))
  }, [])

  const setVisibility = useCallback(
    (parts: number[], visible: boolean) => {
      if (!visible) return hide(parts)
      setHistory((h) => [...h.slice(-49), hidden])
      setHidden((h) => {
        const next = new Set(h)
        for (const p of parts) next.delete(p)
        return next
      })
    },
    [hide, hidden],
  )

  const focusParts = useCallback((parts: number[]) => scene?.fit(parts), [scene])

  const handlers = useRef({ mode, hide, pending, unit })
  handlers.current = { mode, hide, pending, unit }

  useEffect(() => {
    if (!scene) return
    scene.onHover = (hit: Hit | null, event: PointerEvent) => {
      if (handlers.current.mode === 'measure') {
        scene.setHovered(null)
        scene.showSnap(hit ? scene.snap(hit, event.clientX, event.clientY) : null)
      } else {
        scene.showSnap(null)
        scene.setHovered(hit?.view.id ?? null)
      }
    }
    scene.onClick = (hit: Hit | null, event: PointerEvent) => {
      const { mode: currentMode, hide: hideParts, pending: first, unit: currentUnit } = handlers.current
      if (currentMode === 'measure') {
        if (!hit) return setPending(null)
        const entity = entityOf(scene.snap(hit, event.clientX, event.clientY))
        if (!first) return setPending(entity)
        setMeasurements((list) => [relate(first, entity, currentUnit), ...list].slice(0, 12))
        setPending(null)
        return
      }
      if (!hit) return setSelected(new Set())
      if (currentMode === 'hide' || event.altKey) return hideParts([hit.view.id])
      const id = hit.view.id
      setReveal(id)
      setSelected((s) => {
        if (!(event.shiftKey || event.ctrlKey || event.metaKey))
          return s.size === 1 && s.has(id) ? new Set() : new Set([id])
        const next = new Set(s)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    }
    scene.onDoubleClick = (hit: Hit | null) => {
      if (hit && handlers.current.mode === 'select') handlers.current.hide([hit.view.id])
    }
    return () => {
      scene.onHover = null
      scene.onClick = null
      scene.onDoubleClick = null
    }
  }, [scene])

  useEffect(() => {
    if (mode !== 'measure') {
      setPending(null)
      scene?.showSnap(null)
    }
  }, [mode, scene])

  const summary = useMemo(
    () =>
      model
        ? summarize(past ? { ...model, parts: [...model.parts, ...past.history.parts] } : model, selected, unit)
        : null,
    [model, past, selected, unit],
  )

  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (!scene || !model || empty || target.closest('input, textarea, select, [contenteditable]')) return
    const key = event.key.toLowerCase()
    const view = VIEWS.find((v) => v.key === event.key)
    if ((event.ctrlKey || event.metaKey) && key === 'z') undoHide()
    else if (view) scene.setView(view.name)
    else if (key === 'f') scene.fit(selected.size ? [...selected] : undefined)
    else if (key === 'h' && event.shiftKey) showAll()
    else if (key === 'h' || key === 'delete')
      hide(selected.size ? [...selected] : scene.hovered !== null ? [scene.hovered] : [])
    else if (key === 'i') isolate()
    else if (key === 'm') setMode((m) => (m === 'measure' ? 'select' : 'measure'))
    else if (key === 'x') setXray((v) => !v)
    else if (key === 'e') setEdges((v) => !v)
    else if (key === 's') setSection((s) => ({ ...s, enabled: !s.enabled }))
    else if (key === 'escape') {
      setSelected(new Set())
      setPending(null)
      setMode('select')
    } else return
    event.preventDefault()
  }

  return (
    <div className="hurt-model" tabIndex={0} onKeyDown={onKey}>
      <Toolbar
        title={file.name}
        meta={
          model
            ? `${model.parts.length} ${model.parts.length === 1 ? 'part' : 'parts'} · ${formatBytes(file.size)}`
            : formatBytes(file.size)
        }
      >
        {!empty && (
          <>
            <ToolButton icon="cursor" label="Select" active={mode === 'select'} onClick={() => setMode('select')} />
            <ToolButton
              icon="ruler"
              label="Measure"
              shortcut="M"
              active={mode === 'measure'}
              onClick={() => setMode('measure')}
            />
            <ToolButton
              icon="hide"
              label="Click to hide (or double-click a part)"
              active={mode === 'hide'}
              onClick={() => setMode('hide')}
            />
            <ToolDivider />
            <ToolButton
              icon="fit"
              label="Fit to view"
              shortcut="F"
              onClick={() => scene?.fit(selected.size ? [...selected] : undefined)}
            />
            <select
              className="hurt-select"
              aria-label="Camera view"
              value=""
              onChange={(e) => {
                if (e.target.value) scene?.setView(e.target.value as ViewName)
              }}
            >
              <option value="">View</option>
              {VIEWS.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label} ({v.key})
                </option>
              ))}
            </select>
            <ToolButton
              icon="cube"
              label="Perspective camera"
              active={perspective}
              onClick={() => setPerspective((v) => !v)}
            />
            <button
              type="button"
              className="hurt-tool hurt-tool--text"
              title="Which axis points up"
              onClick={() => setUp((u) => (u === 'z' ? 'y' : 'z'))}
            >
              {up.toUpperCase()} up
            </button>
            <ToolDivider />
            <ToolButton icon="edges" label="Edges" shortcut="E" active={edges} onClick={() => setEdges((v) => !v)} />
            <ToolButton icon="xray" label="X-ray" shortcut="X" active={xray} onClick={() => setXray((v) => !v)} />
            <ToolButton icon="layers" label="Wireframe" active={wireframe} onClick={() => setWireframe((v) => !v)} />
            <ToolButton icon="grid" label="Grid" active={grid} onClick={() => setGrid((v) => !v)} />
            <ToolButton
              icon="section"
              label="Section"
              shortcut="S"
              active={section.enabled}
              onClick={() => setSection((s) => ({ ...s, enabled: !s.enabled }))}
            />
            <ToolButton icon="explode" label="Explode" active={exploding} onClick={() => setExploding((v) => !v)} />
            <ToolDivider />
            <ToolButton
              icon="eye"
              label="Isolate selection"
              shortcut="I"
              active={isolated}
              disabled={!isolated && selected.size === 0}
              onClick={isolate}
            />
            <ToolButton
              icon="eye-off"
              label="Hide selection"
              shortcut="H"
              disabled={selected.size === 0}
              onClick={() => hide([...selected])}
            />
            <ToolButton
              icon="undo"
              label="Undo hide"
              shortcut="Ctrl+Z"
              disabled={history.length === 0}
              onClick={undoHide}
            />
            <ToolButton
              icon="expand"
              label="Show everything"
              shortcut="Shift+H"
              disabled={hidden.size === 0}
              onClick={showAll}
            />
          </>
        )}
        {model?.preview && model.parts.length > 0 && (
          <ToolButton icon="image" label="Saved preview" active={preview} onClick={() => setPreview((v) => !v)} />
        )}
        {model && model.parts.length > 1 && (
          <ToolButton icon="list" label="Parts list" active={tree} onClick={() => setTree((v) => !v)} />
        )}
        {timeline && (
          <ToolButton
            icon="clock"
            label="Design timeline"
            active={step !== null}
            onClick={() => setStep((s) => (s === null ? timeline.steps.length - 1 : null))}
          />
        )}
        {actions}
      </Toolbar>

      {!empty && (section.enabled || exploding) && (
        <div className="hurt-subbar">
          {section.enabled && (
            <div className="hurt-subbar__group">
              <span className="hurt-subbar__label">Section</span>
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <button
                  key={axis}
                  type="button"
                  className={section.axis === i ? 'hurt-tool hurt-tool--text is-active' : 'hurt-tool hurt-tool--text'}
                  onClick={() => setSection((s) => ({ ...s, axis: i as 0 | 1 | 2 }))}
                >
                  {axis}
                </button>
              ))}
              <input
                type="range"
                min={0}
                max={1}
                step={0.001}
                value={section.position}
                aria-label="Section position"
                onChange={(e) => setSection((s) => ({ ...s, position: Number(e.target.value) }))}
              />
              <ToolButton icon="flip" label="Flip side" onClick={() => setSection((s) => ({ ...s, flip: !s.flip }))} />
            </div>
          )}
          {exploding && (
            <div className="hurt-subbar__group">
              <span className="hurt-subbar__label">Explode</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                ref={explodeInput}
                defaultValue={scene?.explode ?? 0}
                aria-label="Explode distance"
                onChange={(e) => {
                  scene?.setExplode(Number(e.target.value))
                  if (measurements.length) setMeasurements([])
                  if (pending) setPending(null)
                }}
              />
            </div>
          )}
        </div>
      )}

      <div className="hurt-model__body">
        <div className={`hurt-model__stage hurt-model__stage--${mode}`}>
          <div ref={stage} className="hurt-model__canvas" />
          <div ref={overlay} className="hurt-model__overlay" />
          {state.status === 'loading' && (
            <Loading progress={state.progress} message={state.message ?? 'Loading model'} />
          )}
          {state.status === 'error' && <Failure message={state.error} />}
          {model && model.parts.length === 0 && <NoGeometry model={model} />}
          {preview && model?.preview && <SavedPreview preview={model.preview} />}
          {model && model.parts.length > 0 && (mode === 'measure' || summary || notes) && (
            <div className="hurt-model__info">
              {mode === 'measure' ? (
                <MeasurePanel
                  pending={pending}
                  current={current}
                  measurements={measurements}
                  unit={unit}
                  onClear={() => setMeasurements([])}
                />
              ) : (
                summary && (
                  <dl className="hurt-readings">
                    {summary.title && (
                      <>
                        <dt>{summary.title}</dt>
                        <dd />
                      </>
                    )}
                    {summary.readings.map((r) => (
                      <div key={r.label} className="hurt-readings__row">
                        <dt>{r.label}</dt>
                        <dd>{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                )
              )}
              {mode === 'hide' && (
                <p className="hurt-model__hint">
                  Click parts to hide them. Hidden parts can't be clicked, so you can dig into an assembly.
                </p>
              )}
              {model.warnings.map((warning) => (
                <p key={warning} className="hurt-model__hint">
                  {warning}
                </p>
              ))}
              {unitPicker && (
                <p className="hurt-model__hint">
                  {model.unit === 'unknown' && "This file doesn't record its units reliably. "}
                  {oversized && 'In metres this model would be over 10 m across. '}
                  Sizes assume{' '}
                  <select
                    className="hurt-select"
                    aria-label="File units"
                    value={unit}
                    onChange={(e) => setUnitOverride(e.target.value as ModelUnit)}
                  >
                    {UNITS.map((u) => (
                      <option key={u.unit} value={u.unit}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </p>
              )}
            </div>
          )}
        </div>
        {model && tree && model.parts.length > 1 && (
          <aside className="hurt-model__side">
            <AssemblyTree
              model={model}
              hidden={hidden}
              selected={selected}
              reveal={reveal}
              onSelect={selectParts}
              onVisibility={setVisibility}
              onFocus={focusParts}
            />
          </aside>
        )}
        {timeline && step !== null && !empty && (
          <Timeline timeline={timeline} step={step} onStep={setStep} status={pastStatus} />
        )}
      </div>
    </div>
  )
}

function MeasurePanel({
  pending,
  current,
  measurements,
  unit,
  onClear,
}: {
  pending: Entity | null
  current: Measurement | null
  measurements: Measurement[]
  unit: ModelData['unit']
  onClear: () => void
}) {
  return (
    <div className="hurt-measure">
      {!pending && measurements.length === 0 && (
        <p className="hurt-model__hint">
          Click a corner, edge, hole or face. Click a second one to measure between them. Green dots snap to corners and
          hole centers.
        </p>
      )}
      {pending && current && (
        <dl className="hurt-readings">
          <dt>{describe(pending, unit).title}</dt>
          <dd>Click something else to measure to it</dd>
          {current.readings.map((r) => (
            <div key={r.label} className="hurt-readings__row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {measurements.map((m, i) => (
        <dl key={i} className="hurt-readings">
          <dt>
            {describe(m.entities[0], unit).title} to {describe(m.entities[1], unit).title.toLowerCase()}
          </dt>
          <dd />
          {m.readings.map((r) => (
            <div key={r.label} className="hurt-readings__row">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      ))}
      {measurements.length > 0 && (
        <button type="button" className="hurt-tool hurt-tool--text" onClick={onClear}>
          <HurtIcon name="x" />
          <span>Clear measurements</span>
        </button>
      )}
    </div>
  )
}

function entityOf(snap: Snap): Entity {
  const matrix = snap.view.mesh.matrixWorld
  if (snap.type === 'vertex') return { type: 'point', point: snap.point, via: 'vertex' }
  if (snap.type === 'center' || snap.type === 'edge') return edgeEntity(snap.view.part, snap.chain, matrix)
  if (snap.face >= 0) return faceEntity(snap.view.part, snap.face, snap.point, matrix)
  return { type: 'point', point: snap.point, via: 'face' }
}

function entityPath(entity: Entity) {
  if (entity.type === 'line') return [entity.a, entity.b]
  if (entity.type === 'curve') return entity.points
  if (entity.type === 'circle') {
    const points: THREE.Vector3[] = []
    const axis = entity.normal.clone().normalize()
    const start = new THREE.Vector3(1, 0, 0)
    if (Math.abs(start.dot(axis)) > 0.9) start.set(0, 1, 0)
    start
      .sub(axis.clone().multiplyScalar(start.dot(axis)))
      .normalize()
      .multiplyScalar(entity.radius)
    for (let i = 0; i <= 64; i++)
      points.push(
        start
          .clone()
          .applyAxisAngle(axis, (i / 64) * Math.PI * 2)
          .add(entity.center),
      )
    return points
  }
  return undefined
}

function largestSpan(model: ModelData) {
  const box = new THREE.Box3()
  for (const { bounds } of model.parts) {
    box.expandByPoint(new THREE.Vector3(bounds[0], bounds[1], bounds[2]))
    box.expandByPoint(new THREE.Vector3(bounds[3], bounds[4], bounds[5]))
  }
  const size = box.getSize(new THREE.Vector3())
  return Math.max(size.x, size.y, size.z)
}

function summarize(model: ModelData, selected: Set<number>, unit: ModelUnit) {
  if (selected.size === 0) return model.info?.length ? { title: null as string | null, readings: model.info } : null
  const ids = [...selected]
  const box = new THREE.Box3()
  let area = 0
  let volume = 0
  let triangles = 0
  for (const id of ids) {
    const part = model.parts[id]
    box.expandByPoint(new THREE.Vector3(part.bounds[0], part.bounds[1], part.bounds[2]))
    box.expandByPoint(new THREE.Vector3(part.bounds[3], part.bounds[4], part.bounds[5]))
    area += part.area
    volume += part.volume
    triangles += part.triangles
  }
  const size = box.getSize(new THREE.Vector3())
  const readings = [
    {
      label: 'Size',
      value: `${formatLength(size.x, unit)} × ${formatLength(size.y, unit)} × ${formatLength(size.z, unit)}`,
    },
    { label: 'Surface', value: formatArea(area, unit) },
  ]
  if (ids.length === 1 && volume > 0) readings.push({ label: 'Volume', value: formatVolume(volume, unit) })
  readings.push({ label: 'Triangles', value: triangles.toLocaleString() })
  return { title: ids.length === 1 ? model.parts[ids[0]].name : `${ids.length} parts selected`, readings }
}
