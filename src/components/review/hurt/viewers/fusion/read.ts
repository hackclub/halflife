import { isZip, openZip, type Archive, type ArchiveEntry } from '../../core/archive'
import { Acis } from '../acis/acis'
import { Sab, SabError } from '../acis/sab'
import type { Body } from '../brep/types'
import { StepWriter } from '../brep/step'
import {
  contextKey,
  readDesign,
  type Design,
  type DesignBody,
  type DesignComponent,
  type DesignGroup,
  type DesignMesh,
} from './design'
import { LzmaError } from './lzma'
import { ParaMeshError, readParaMesh, type MeshData } from './paramesh'
import { readProtein } from './protein'

const BLOB = /(^|\/)Breps\.BlobParts\/[^/]+\.smbh?$/i
const MESH = /(^|\/)ParaMeshGeometry\.BlobParts\/[^/]+\.paramesh$/i
const PREVIEW = /(^|\/)Previews\/[^/]+\.png$/i
const XREF = 'XREF'
const ASSET_MANIFEST = /^FusionAssetName\[Active\]\/Manifest\.dat$/
const ASSET_GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const ACTIVE = /^FusionAssetName\[Active\]\//
const PROTEIN = /(^|\/)ProteinAssets\.BlobParts\/[^/]+\.protein$/i
const SEGMENT = /(^|\/)(FusionDesignSegmentType\d*|Design\d*)\/MetaStream\.dat$/i
const FUSION_MILLIMETRES = 10
const MAX_DEPTH = 32
const MAX_INSTANCES = 20_000
const SKIP_COST = 0.6
const MAX_ALIGNMENT = 4_000_000
const MAX_REORDER = 400
const ORDER_TOLERANCE = 0.5
const ORDER_WEIGHT = 0.01
const NO_APPEARANCE = { appearance: null, inherited: false }
const HISTORY_MS = { budget: 15_000, tools: 6_000, shape: 3, face: 0.8, spline: 4 }
const REMOVED_BODY = 'Removed body'
const TOOL_COLOUR = [0.3, 0.55, 0.95]
const PROFILE_COLOUR = [0.95, 0.6, 0.2]
const TOOL_SHARE = 0.8
const MIN_TOOL_FACES = 2
const TOOL_BLOB = /\.smb$/i

export interface FusionShape {
  step: string
  faces: number
  splines: number
  spans: number
  mesh: MeshData | null
  colour: number[] | null
  faceColours: (number[] | null)[]
}

export interface FusionInstance {
  shape: string
  name: string
  path: string[]
  matrix: number[] | null
  visible: boolean
  appear: number | null
  until: number | null
  changed: number[]
  ghost: boolean
}

export interface FusionModel {
  shapes: Map<string, FusionShape>
  instances: FusionInstance[]
  preview: Uint8Array | null
  up: 'y' | 'z'
  warnings: string[]
  timeline: string[]
  kinds: string[]
  times: (number | null)[]
  groups: DesignGroup[]
  history: boolean
}

export interface FusionHistory {
  shapes: Map<string, FusionShape>
  instances: FusionInstance[]
  finals: Map<string, number>
  warnings: string[]
}

interface Version {
  from: number
  until: number | null
  state: number
  cost: number
}

interface OpStart {
  op: number
  step: number
}

interface Entity {
  entity: number
  body: Body
}

interface Placement {
  path: string[]
  matrix: number[] | null
  visible: boolean
  tint: number[] | null
  appear: number | null
}

interface DesignObject {
  id?: number
  references?: { type?: string; ids?: number[] }[]
  relativePath?: string
  displayName?: string
  version?: number
  lineage?: string
  metadata?: { DesignModelRevisionID?: string }
}

interface LoadedDesign {
  name: string
  item: string | null
  version: number | null
  references: LoadedDesign[]
  archive: Archive
  design: Design | null
  blobs: Map<string, ArchiveEntry>
  meshes: Map<string, ArchiveEntry>
  colours: Map<string, number[]>
}

interface Scope {
  design: LoadedDesign
  base: number[] | null
  local: number[]
  groups: Map<string, number[]>
}

async function readJson(archive: Archive, name: string) {
  const entry = archive.entries.find((e) => e.name === name)
  if (!entry) return null
  try {
    return JSON.parse(new TextDecoder().decode(await archive.read(entry)))
  } catch {
    return null
  }
}

async function assetId(archive: Archive) {
  const entry = archive.entries.find((e) => ASSET_MANIFEST.test(e.name))
  if (!entry) return null
  const text = new TextDecoder('utf-16le').decode(await archive.read(entry))
  return text.match(ASSET_GUID)?.[0].toLowerCase() ?? null
}

async function preview(archive: Archive) {
  const images = archive.entries.filter((e) => PREVIEW.test(e.name))
  const best = images.find((e) => /big\.png$/i.test(e.name)) ?? images.sort((a, b) => b.size - a.size)[0]
  return best ? archive.read(best) : null
}

function multiply(a: number[] | null, b: number[] | null) {
  if (!a) return b
  if (!b) return a
  const out = new Array<number>(16)
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 4; column++)
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3]
  return out
}

function columnMajor(rows: number[]) {
  const scale = FUSION_MILLIMETRES
  return [
    ...[rows[0], rows[4], rows[8], 0],
    ...[rows[1], rows[5], rows[9], 0],
    ...[rows[2], rows[6], rows[10], 0],
    ...[rows[3] * scale, rows[7] * scale, rows[11] * scale, 1],
  ]
}

function faceCounts(body: Body) {
  let faces = 0
  let splines = 0
  let spans = 0
  for (const lump of body.lumps)
    for (const shell of lump.shells)
      for (const face of shell) {
        faces++
        if (face.surface?.type !== 'spline') continue
        splines++
        spans = Math.max(spans, face.surface.spline.uKnots.length - 1, face.surface.spline.vKnots.length - 1)
      }
  return { faces, splines, spans }
}

function overlaps(a: Set<number>, b: Set<number>) {
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  for (const value of small) if (large.has(value)) return true
  return false
}

function thin(versions: Map<number, Version[]>) {
  const earlier = [...versions.values()].flatMap((list) => list.filter((version) => version.until !== null))
  const cost = earlier.reduce((sum, version) => sum + version.cost, 0)
  const every = Math.ceil(cost / HISTORY_MS.budget)
  if (every <= 1) return earlier
  const kept: Version[] = []
  for (const list of versions.values())
    list.forEach((version, i) => {
      if (version.until === null) return
      if (i % every === 0) kept.push(version)
      else kept[kept.length - 1].until = version.until
    })
  return kept
}

function extent(body: Body) {
  const m = body.transform
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  let sheet = false
  for (const lump of body.lumps)
    for (const shell of lump.shells)
      for (const face of shell) {
        if (face.sheet) sheet = true
        for (const loop of face.loops)
          for (const coedge of loop.coedges) {
            if (coedge.open) sheet = true
            for (const { point: p } of [coedge.edge.start, coedge.edge.end])
              for (let k = 0; k < 3; k++) {
                const value = m ? m[k] * p[0] + m[3 + k] * p[1] + m[6 + k] * p[2] + m[9 + k] : p[k]
                min[k] = Math.min(min[k], value)
                max[k] = Math.max(max[k], value)
              }
          }
      }
  return { min, max, sheet }
}

function mismatch(record: DesignBody, body: ReturnType<typeof extent>) {
  let cost = record.sheet === null || record.sheet === body.sheet ? 0 : 1
  if (record.centre && body.min[0] <= body.max[0]) {
    const diagonal = Math.hypot(...body.max.map((v, k) => v - body.min[k])) || 1
    const outside = Math.hypot(...record.centre.map((v, k) => Math.max(body.min[k] - v, 0, v - body.max[k])))
    cost += Math.min(1, outside / diagonal)
  }
  return cost
}

function reorder(bodies: Body[], records: DesignBody[]) {
  if (records.length > MAX_REORDER || records.every((record) => !record.centre)) return records
  const extents = bodies.map(extent)
  const inOrder = records.reduce((sum, record, i) => sum + mismatch(record, extents[i]), 0)
  if (inOrder < ORDER_TOLERANCE) return records
  const pairs: { i: number; j: number; cost: number }[] = []
  records.forEach((record, i) =>
    extents.forEach((body, j) =>
      pairs.push({ i, j, cost: mismatch(record, body) + (ORDER_WEIGHT * Math.abs(i - j)) / records.length }),
    ),
  )
  pairs.sort((a, b) => a.cost - b.cost)
  const matched: (DesignBody | null)[] = bodies.map(() => null)
  const used = new Set<number>()
  let total = 0
  for (const { i, j, cost } of pairs) {
    if (used.has(i) || matched[j]) continue
    matched[j] = records[i]
    used.add(i)
    total += cost
  }
  return total < inOrder ? matched : records
}

function align(bodies: Body[], records: DesignBody[]): (DesignBody | null)[] {
  if (bodies.length === records.length) return reorder(bodies, records)
  const [n, m] = [records.length, bodies.length]
  if ((n + 1) * (m + 1) > MAX_ALIGNMENT) return bodies.map(() => null)
  const extents = bodies.map(extent)
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity))
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1))
  cost[0][0] = 0
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      const options = [
        i > 0 ? cost[i - 1][j] + SKIP_COST : Infinity,
        j > 0 ? cost[i][j - 1] + SKIP_COST : Infinity,
        i > 0 && j > 0 ? cost[i - 1][j - 1] + mismatch(records[i - 1], extents[j - 1]) : Infinity,
      ]
      for (let k = 0; k < 3; k++)
        if (options[k] < cost[i][j]) {
          cost[i][j] = options[k]
          move[i][j] = k + 1
        }
    }
  const matched: (DesignBody | null)[] = bodies.map(() => null)
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const step = move[i][j]
    if (step === 3) matched[--j] = records[--i]
    else if (step === 1) i--
    else j--
  }
  return matched
}

function orphanShown(records: DesignBody[], body: Body) {
  if (records.length === 0) return true
  return records.some((record) => record.visible) && !extent(body).sheet
}

function placeMesh(data: MeshData, matrix: number[] | null): MeshData {
  if (!matrix) return data
  const m = matrix
  const positions = new Float32Array(data.positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y, z] = [data.positions[i], data.positions[i + 1], data.positions[i + 2]]
    for (let k = 0; k < 3; k++)
      positions[i + k] = (m[k * 4] * x + m[k * 4 + 1] * y + m[k * 4 + 2] * z + m[k * 4 + 3]) * FUSION_MILLIMETRES
  }
  return { positions, indices: data.indices }
}

function chooseList(component: DesignComponent) {
  const listed = component.lists.filter((list) => list.bodies.length > 0)
  return listed.find((list) => /\.smbh$/i.test(list.blob)) ?? listed[0] ?? null
}

function byName(archive: Archive, pattern: RegExp) {
  return new Map(
    archive.entries
      .filter((e) => !e.dir && pattern.test(e.name))
      .map((e) => [e.name.slice(e.name.lastIndexOf('/') + 1), e]),
  )
}

function activeAsset(archive: Archive): Archive {
  const entries = archive.entries.filter((e) => ACTIVE.test(e.name))
  return entries.length ? { ...archive, entries } : archive
}

async function loadDesign(
  source: Archive,
  name: string,
  item: string | null = null,
  version: number | null = null,
): Promise<LoadedDesign> {
  const archive = activeAsset(source)
  const blobs = byName(archive, BLOB)
  const meshes = byName(archive, MESH)
  const meta = archive.entries.find((e) => SEGMENT.test(e.name))
  const bulk = meta && archive.entries.find((e) => e.name === meta.name.replace(/MetaStream\.dat$/i, 'BulkStream.dat'))
  let design: Design | null = null
  if (meta && bulk)
    try {
      design = readDesign(await archive.read(meta), await archive.read(bulk), [...blobs.keys(), ...meshes.keys()])
    } catch {
      design = null
    }
  const colours = new Map<string, number[]>()
  for (const entry of archive.entries.filter((e) => !e.dir && PROTEIN.test(e.name))) {
    const found = await archive
      .read(entry)
      .then(readProtein)
      .catch(() => new Map<string, number[]>())
    for (const [id, rgb] of found) if (!colours.has(id)) colours.set(id, rgb)
  }
  return { name, item, version, references: [], archive, design, blobs, meshes, colours }
}

function extend(groups: Map<string, number[]>, item: string | null, id: number) {
  if (!item) return groups
  return new Map(groups).set(item, [...(groups.get(item) ?? []), id])
}

function shade(tint: number[] | null) {
  return tint ? `|${tint.join(',')}` : ''
}

function paint(
  design: LoadedDesign,
  record: Pick<DesignBody, 'appearance' | 'inherited'> & { overrides?: DesignBody['overrides'] },
  tint: number[] | null,
) {
  const of = (asset: string | null | undefined) => (asset && design.colours.get(asset)) || null
  const colour = (record.inherited ? null : of(record.appearance)) ?? tint ?? of(record.appearance)
  const face = (appearance: string | undefined) => {
    const override = appearance === undefined ? undefined : record.overrides?.get(appearance)
    return override ? (override.colour ?? of(override.asset) ?? colour) : colour
  }
  return { colour, face }
}

class Builder {
  readonly shapes = new Map<string, FusionShape>()
  readonly instances: FusionInstance[] = []
  readonly warnings = new Set<string>()
  readonly finals = new Map<string, number>()
  private readonly parsed = new Map<string, Entity[]>()
  private readonly sabs = new Map<string, Sab>()
  private toolCost = 0
  private readonly decoded = new Map<string, MeshData | null>()
  private missing = 0

  constructor(
    private readonly linked: Map<string, LoadedDesign>,
    private readonly top: LoadedDesign,
    private readonly history = false,
  ) {}

  private async bodies(design: LoadedDesign, blob: string) {
    const key = `${design.name}|${blob}`
    let bodies = this.parsed.get(key)
    if (!bodies) {
      bodies = []
      const entry = design.blobs.get(blob)
      if (entry)
        try {
          const sab = new Sab(await design.archive.read(entry))
          const acis = new Acis(sab)
          bodies = acis.entities()
          if (this.history) this.sabs.set(key, sab)
          this.missing += acis.missing.curves + acis.missing.surfaces
        } catch (error) {
          if (!(error instanceof SabError)) throw error
          this.warnings.add(`Some geometry in ${design.name} could not be read: ${error.message}`)
        }
      this.parsed.set(key, bodies)
    }
    return bodies
  }

  private add(
    key: string,
    body: Body,
    name: string,
    at: Placement,
    colours: ReturnType<typeof paint>,
    changed: number[],
  ) {
    if (!this.shapes.has(key)) {
      const writer = new StepWriter(FUSION_MILLIMETRES)
      const items = writer.body(body)
      this.shapes.set(
        key,
        items.length
          ? {
              step: writer.write(name, items),
              ...faceCounts(body),
              mesh: null,
              colour: colours.colour,
              faceColours: writer.written.map((face) => colours.face(face.appearance)),
            }
          : { step: '', faces: 0, splines: 0, spans: 0, mesh: null, colour: null, faceColours: [] },
      )
    }
    if (this.shapes.get(key)!.step) this.place(key, name, at, changed)
  }

  private versions(sab: Sab, graph: Design, component: number, attributed: boolean, arrival: number | null) {
    const known = new Set(sab.states())
    const versions = new Map<number, Version[]>()
    let visited = new Map<number, Set<number>>()
    let previous: number | null = null
    const starts: OpStart[] = []
    const ops = new Set<number>()
    const steps = graph.states.flatMap((entry, step) =>
      entry?.component === component && known.has(entry.state) ? [{ step, state: entry.state }] : [],
    )
    const before = steps.length ? Math.max(...[...known].filter((state) => state < steps[0].state)) : -Infinity
    if (arrival !== null && arrival < (steps[0]?.step ?? -1) && before >= 0)
      steps.unshift({ step: arrival, state: before })
    steps.forEach(({ step, state }) => {
      if (state === previous) return
      const records = sab.rollBack(state)
      if (!records) return
      const touched = previous === null ? null : sab.touched(previous, state)
      const acis = new Acis(sab, records)
      const fresh = [...acis.tags(touched ?? undefined).values()].flat().filter((op) => !ops.has(op))
      if (fresh.length) starts.push({ op: Math.min(...fresh), step })
      for (const op of fresh) ops.add(op)
      const next = new Map<number, Set<number>>()
      records.types.forEach((type, entity) => {
        if (type !== 'body') return
        const seen = visited.get(entity)
        if (seen && touched && !overlaps(touched, seen)) return void next.set(entity, seen)
        const used = new Set<number>()
        let body: Body
        try {
          body = acis.bodyAt(entity, used)
        } catch (error) {
          if (!(error instanceof SabError)) throw error
          return
        }
        if (attributed && !body.attributed) return
        const list = versions.get(entity) ?? []
        const last = list[list.length - 1]
        if (last && last.until === null) last.until = step
        const { faces, splines } = faceCounts(body)
        const cost = HISTORY_MS.shape + HISTORY_MS.face * faces + HISTORY_MS.spline * splines
        list.push({ from: step, until: null, state, cost })
        versions.set(entity, list)
        next.set(entity, used)
      })
      for (const [entity, list] of versions) {
        const last = list[list.length - 1]
        if (last.until === null && !next.has(entity)) last.until = step
      }
      visited = next
      previous = state
    })
    return { versions, starts }
  }

  private async addTools(design: LoadedDesign, id: number, starts: OpStart[], at: Placement) {
    const graph = design.design!
    const list = graph.components.get(id)?.lists.find((candidate) => TOOL_BLOB.test(candidate.blob))
    const entry = list && design.blobs.get(list.blob)
    if (!list || !entry || !starts.length || !at.visible) return
    let sab: Sab
    try {
      sab = new Sab(await design.archive.read(entry))
    } catch (error) {
      if (!(error instanceof SabError)) throw error
      return
    }
    const acis = new Acis(sab)
    const tags = acis.tags()
    const stepOf = (op: number) => starts.findLast((start) => start.op <= op)?.step ?? null
    let current: number | null = null
    sab.types.forEach((type, entity) => {
      if (type !== 'body') return
      const used = new Set<number>()
      let body: Body
      try {
        body = acis.bodyAt(entity, used)
      } catch (error) {
        if (!(error instanceof SabError)) throw error
        return
      }
      if (body.attributed) return
      const faces = [...used].filter((i) => sab.types[i] === 'face')
      const sketch = current === null ? undefined : graph.sketches.get(current)
      if (body.lumps.some((lump) => lump.shells.some((shell) => shell.some((face) => face.sheet)))) {
        if (current === null) return
        const from = sketch === current - 1 ? sketch : current
        this.addTool(
          design,
          `${list.blob}#${entity}`,
          body,
          PROFILE_COLOUR,
          `${graph.timeline[current]} profile`,
          at,
          from,
          current + 1,
        )
        if (sketch !== undefined && from !== sketch)
          this.addTool(
            design,
            `${list.blob}#${entity}`,
            body,
            PROFILE_COLOUR,
            `${graph.timeline[current]} profile`,
            at,
            sketch,
            sketch + 1,
          )
        return
      }
      const votes = new Map<number | null, number>()
      let tagged = 0
      for (const face of faces) {
        const ops = tags.get(face)
        if (!ops?.length) continue
        tagged++
        const steps = new Set(ops.map(stepOf))
        const step = steps.size === 1 ? [...steps][0] : null
        votes.set(step, (votes.get(step) ?? 0) + 1)
      }
      const [step, count] = [...votes].filter(([step]) => step !== null).sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
      if (step === null || faces.length < MIN_TOOL_FACES || tagged * 2 < faces.length || count < TOOL_SHARE * tagged) {
        current = null
        return
      }
      current = graph.copies.has(step) ? null : step
      if (current === null) return
      this.addTool(
        design,
        `${list.blob}#${entity}`,
        body,
        TOOL_COLOUR,
        `${graph.timeline[step]} tool`,
        at,
        step,
        step + 1,
      )
    })
  }

  private addTool(
    design: LoadedDesign,
    id: string,
    body: Body,
    colour: number[],
    name: string,
    at: Placement,
    from: number,
    until: number,
  ) {
    const key = `${design.name}|${id}@${from}${shade(at.tint)}`
    if (!this.shapes.has(key)) {
      const { faces, splines } = faceCounts(body)
      this.toolCost += HISTORY_MS.shape + HISTORY_MS.face * faces + HISTORY_MS.spline * splines
      if (this.toolCost > HISTORY_MS.tools) return
      const writer = new StepWriter(FUSION_MILLIMETRES)
      const items = writer.body(body)
      if (!items.length) return
      this.shapes.set(key, {
        step: writer.write(name, items),
        ...faceCounts(body),
        mesh: null,
        colour,
        faceColours: writer.written.map(() => colour),
      })
    }
    this.place(key, name, { ...at, appear: from }, [], until, true)
  }

  private async addHistory(design: LoadedDesign, id: number, list: DesignComponent['lists'][number], at: Placement) {
    const entries = await this.bodies(design, list.blob)
    const sab = this.sabs.get(`${design.name}|${list.blob}`)
    const attributed = entries.some(({ body }) => body.attributed)
    const live = attributed ? entries.filter(({ body }) => body.attributed) : entries
    const found = sab && this.versions(sab, design.design!, id, attributed, at.appear)
    if (!sab || !found) return
    await this.addTools(design, id, found.starts, at)
    const { versions } = found
    if (!versions.size) return
    const records = align(
      live.map(({ body }) => body),
      list.bodies,
    )
    const index = new Map(live.map(({ entity }, i) => [entity, i]))
    const owners = new Map<Version, { key: string; name: string; colours: ReturnType<typeof paint> }>()
    for (const [entity, history] of versions) {
      const i = index.get(entity)
      const info = i === undefined ? null : records[i]
      const moved = info ? design.design!.moved.get(info.id) : undefined
      if (moved !== undefined) {
        const kept = history.filter((version) => version.from < moved)
        for (const version of kept) if (version.until === null || version.until > moved) version.until = moved
        history.splice(0, history.length, ...kept)
        if (!history.length) continue
      } else if (i !== undefined && !(info?.visible ?? orphanShown(list.bodies, live[i].body))) continue
      const key = `${design.name}|${list.blob}#${i ?? `~${entity}`}${shade(at.tint)}`
      const final = history[history.length - 1]
      if (i !== undefined && final.until === null) this.finals.set(key, final.from)
      const owner = {
        key,
        name: info?.name ?? (i === undefined ? REMOVED_BODY : `Body${i + 1}`),
        colours: paint(design, info ?? NO_APPEARANCE, at.tint),
      }
      for (const version of history) owners.set(version, owner)
    }
    const kept = thin(versions).filter((version) => owners.has(version))
    const entityOf = new Map([...versions].flatMap(([entity, history]) => history.map((v) => [v, entity] as const)))
    const states = [...new Set(kept.map((version) => version.state))].sort((a, b) => a - b)
    const last = new Map<string, { text: string; instance: FusionInstance }>()
    for (const state of states) {
      const acis = new Acis(sab, sab.rollBack(state)!)
      for (const version of kept) {
        if (version.state !== state) continue
        const owner = owners.get(version)!
        let body: Body
        try {
          body = acis.bodyAt(entityOf.get(version)!, new Set())
        } catch (error) {
          if (!(error instanceof SabError)) throw error
          continue
        }
        const writer = new StepWriter(FUSION_MILLIMETRES)
        const items = writer.body(body)
        if (!items.length) continue
        const text = writer.write(owner.name, items)
        const previous = last.get(owner.key)
        if (previous?.text === text && previous.instance.until === version.from) {
          previous.instance.until = version.until
          continue
        }
        const key = `${owner.key}@${version.from}`
        this.shapes.set(key, {
          step: text,
          ...faceCounts(body),
          mesh: null,
          colour: owner.colours.colour,
          faceColours: writer.written.map((face) => owner.colours.face(face.appearance)),
        })
        this.place(key, owner.name, { ...at, appear: version.from }, [version.from], version.until)
        last.set(owner.key, { text, instance: this.instances[this.instances.length - 1] })
      }
    }
  }

  private async addMesh(design: LoadedDesign, id: string, mesh: DesignMesh, at: Placement) {
    const key = `${design.name}|${id}`
    if (!this.shapes.has(key)) {
      const data = await this.meshData(design, mesh.blob)
      this.shapes.set(key, {
        step: '',
        faces: 0,
        splines: 0,
        spans: 0,
        mesh: data && placeMesh(data, mesh.matrix),
        colour: paint(design, mesh, at.tint).colour,
        faceColours: [],
      })
    }
    const appear = (design === this.top ? design.design?.meshSteps.get(mesh.blob) : undefined) ?? at.appear
    if (this.shapes.get(key)!.mesh)
      this.place(key, mesh.name, { ...at, visible: at.visible && mesh.visible, appear }, [])
  }

  private async meshData(design: LoadedDesign, blob: string) {
    const key = `${design.name}|${blob}`
    if (!this.decoded.has(key)) {
      const entry = design.meshes.get(blob)
      let data: MeshData | null = null
      if (entry)
        try {
          data = readParaMesh(await design.archive.read(entry))
        } catch (error) {
          if (!(error instanceof ParaMeshError || error instanceof LzmaError)) throw error
          this.warnings.add(`Some mesh bodies in ${design.name} could not be read.`)
        }
      this.decoded.set(key, data)
    }
    return this.decoded.get(key) ?? null
  }

  private place(
    key: string,
    name: string,
    at: Placement,
    changed: number[],
    until: number | null = null,
    ghost = false,
  ) {
    if (this.instances.length >= MAX_INSTANCES) {
      this.warnings.add(`Only the first ${MAX_INSTANCES} bodies are shown.`)
      return
    }
    const { path, matrix, visible, appear } = at
    this.instances.push({ shape: key, name, path, matrix, visible, appear, until, changed, ghost })
  }

  private async component(design: LoadedDesign, id: number, at: Placement, depth: number, scopes: Scope[]) {
    const graph = design.design!
    const component = graph.components.get(id)
    if (!component || depth > MAX_DEPTH) return
    const tint = this.tint(design, graph.componentAppearances.get(id)) ?? at.tint
    const history = design === this.top ? graph : null
    const list = chooseList(component)
    if (list && this.history) {
      if (history) await this.addHistory(design, id, list, { ...at, tint })
    } else if (list) {
      const parsed = await this.bodies(design, list.blob)
      const bodies = (
        parsed.some(({ body }) => body.attributed) ? parsed.filter(({ body }) => body.attributed) : parsed
      ).map(({ body }) => body)
      const records = align(bodies, list.bodies)
      let unnamed = Math.max(0, ...list.bodies.map((record) => record.number))
      bodies.forEach((body, i) => {
        const info = records[i]
        const key = `${design.name}|${list.blob}#${i}${shade(tint)}`
        const name = info?.name ?? `Body${++unnamed}`
        const changed = (info && history?.bodySteps.get(info.id)) || []
        const appear = changed.length ? Math.min(...changed) : at.appear
        const shown = at.visible && (info?.visible ?? orphanShown(list.bodies, body))
        const colours = paint(design, info ?? NO_APPEARANCE, tint)
        this.add(key, body, name, { ...at, visible: shown, tint, appear }, colours, changed)
      })
    }
    if (!this.history)
      for (const [i, mesh] of component.meshes.entries())
        await this.addMesh(design, `${id}|${mesh.blob}#${i}${shade(tint)}`, mesh, { ...at, tint })
    const used = new Set<string>()
    const label = (name: string, index: number | null) => {
      let count = index === null ? 1 : index + 1
      while (used.has(`${name}:${count}`)) count++
      used.add(`${name}:${count}`)
      return `${name}:${count}`
    }
    for (const occurrence of graph.occurrences) {
      if (occurrence.parent !== id) continue
      const next = scopes.map((scope, i) =>
        i === scopes.length - 1
          ? { ...scope, local: [...scope.local, occurrence.id] }
          : { ...scope, groups: extend(scope.groups, design.item, occurrence.id) },
      )
      const found = next.map((scope) => {
        const target = scope.design.design!
        const key = contextKey(scope.local, scope.groups)
        return {
          scope,
          placed: target.placed.get(key),
          hidden: target.hidden.has(key),
          colour: this.tint(scope.design, target.appearances.get(key)),
        }
      })
      const placement = found.find((entry) => entry.placed)
      const placed = placement
        ? multiply(placement.scope.base, columnMajor(placement.placed!))
        : multiply(at.matrix, occurrence.matrix && columnMajor(occurrence.matrix))
      const child = {
        path: at.path,
        matrix: placed,
        visible: at.visible && !found.some((entry) => entry.hidden),
        tint: found.find((entry) => entry.colour)?.colour ?? tint,
        appear: history?.occurrenceSteps.get(occurrence.id) ?? at.appear,
      }
      if (occurrence.component !== null) {
        const name = graph.components.get(occurrence.component)?.name || 'Component'
        const path = [...at.path, label(name, occurrence.index)]
        await this.component(design, occurrence.component, { ...child, path }, depth + 1, next)
        continue
      }
      const linked =
        (occurrence.link && this.linked.get(occurrence.link)) ||
        (occurrence.revision && this.linked.get(occurrence.revision)) ||
        (design.references.length === 1 ? design.references[0] : undefined)
      if (!linked) {
        this.warnings.add('This design uses components from other Fusion files that are not included in it.')
        continue
      }
      const title = linked.version ? `${linked.name} v${linked.version}` : linked.name
      await this.design(linked, { ...child, path: [...at.path, label(title, occurrence.index)] }, depth + 1, next)
    }
  }

  private tint(design: LoadedDesign, asset: string | undefined) {
    return (asset && design.colours.get(asset)) || null
  }

  async design(design: LoadedDesign, at: Placement, depth = 0, outer: Scope[] = []) {
    if (design.design) {
      const scopes = [...outer, { design, base: at.matrix, local: [], groups: new Map() }]
      return this.component(design, design.design.root, at, depth, scopes)
    }
    if (this.history) return
    const blobs = [...design.blobs.keys()]
    const current = blobs.filter((blob) => /\.smbh$/i.test(blob))
    for (const blob of current.length ? current : blobs) {
      const bodies = await this.bodies(design, blob)
      bodies.forEach(({ body }, i) =>
        this.add(
          `${design.name}|${blob}#${i}${shade(at.tint)}`,
          body,
          `Body${i + 1}`,
          at,
          paint(design, NO_APPEARANCE, at.tint),
          [],
        ),
      )
    }
  }

  finish() {
    if (this.missing > 0)
      this.warnings.add(
        `${this.missing} curves or surfaces use geometry this viewer can't rebuild, so some faces are missing.`,
      )
    return [...this.warnings]
  }
}

async function openFusion(bytes: ArrayBuffer, name: string) {
  const archive = openZip(bytes)
  const inner = archive.entries.filter((e) => !e.dir && /\.f3d$/i.test(e.name))
  const linked = new Map<string, LoadedDesign>()
  let top: LoadedDesign | undefined
  if (inner.length === 0) top = await loadDesign(archive, name)
  else {
    const description = await readJson(archive, 'DesignDescription.json')
    const objects: DesignObject[] = (description?.designDescription?.designGraphs ?? []).flatMap(
      (graph: { designObjects?: DesignObject[] }) => graph.designObjects ?? [],
    )
    const root: unknown = (await readJson(archive, 'Manifest.json'))?.root
    const byObject = new Map<number, LoadedDesign>()
    for (const entry of inner.sort((a, b) => Number(b.name === root) - Number(a.name === root))) {
      const data = await archive.read(entry)
      if (!isZip(data)) continue
      const object = objects.find((o) => o.relativePath === entry.name)
      const item = object?.lineage?.match(/lineage:([^?]+)/)?.[1]
      const design = await loadDesign(
        openZip(data.slice().buffer as ArrayBuffer),
        object?.displayName ?? entry.name,
        item ?? null,
        object?.version ?? null,
      )
      top ??= design
      const revision = object?.metadata?.DesignModelRevisionID
      const asset = await assetId(design.archive)
      if (item) linked.set(item, design)
      if (revision) linked.set(revision.toLowerCase(), design)
      if (asset && !linked.has(asset)) linked.set(asset, design)
      if (object?.id !== undefined) byObject.set(object.id, design)
    }
    for (const object of objects) {
      const design = object.id === undefined ? undefined : byObject.get(object.id)
      const ids = (object.references ?? []).filter((r) => r.type === XREF).flatMap((r) => r.ids ?? [])
      if (design) design.references = ids.flatMap((id) => byObject.get(id) ?? [])
    }
  }
  if (!top) throw new Error('This Fusion archive has no designs in it.')
  return { top, linked }
}

const ORIGIN: Placement = { path: [], matrix: null, visible: true, tint: null, appear: null }

export async function readFusion(bytes: ArrayBuffer, name: string): Promise<FusionModel> {
  const { top, linked } = await openFusion(bytes, name)
  const builder = new Builder(linked, top)
  await builder.design(top, ORIGIN)
  return {
    shapes: builder.shapes,
    instances: builder.instances,
    preview: await preview(top.archive),
    up: top.design?.up ?? 'z',
    warnings: builder.finish(),
    timeline: top.design?.timeline ?? [],
    kinds: top.design?.kinds ?? [],
    times: top.design?.times ?? [],
    groups: top.design?.groups ?? [],
    history: top.design?.states.some(Boolean) ?? false,
  }
}

export async function readFusionHistory(bytes: ArrayBuffer, name: string): Promise<FusionHistory> {
  const { top, linked } = await openFusion(bytes, name)
  const builder = new Builder(linked, top, true)
  await builder.design(top, ORIGIN)
  return { shapes: builder.shapes, instances: builder.instances, finals: builder.finals, warnings: builder.finish() }
}
