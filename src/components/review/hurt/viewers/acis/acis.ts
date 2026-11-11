import { helixCircleSurface, helixCurve, helixLineSurface, type Helix } from './helix'
import { CLOSE, END, ENUM, LONG, OPEN, REF, Sab, SabError, type Cursor, type Records } from './sab'
import type { Body, BSplineCurve, BSplineSurface, Coedge, Curve, Edge, Face, Surface, Vec, Vertex } from '../brep/types'

const CHAIN_LIMIT = 1_000_000
const CLOSURES = ['open', 'closed', 'periodic']
const CUSTOM_ATTRIBUTE = 'ATTRIB_CUSTOM-attrib'
const MATERIAL_ATTRIBUTE = 'NEUTRON_Material_attrib_def'
const TAG_ATTRIBUTE = 'generic_tag_attrib_def'

export class Acis {
  readonly missing = { curves: 0, surfaces: 0 }
  private readonly cache = new Map<number, unknown>()
  private appearances: Map<number, string> | null = null
  private visited: Set<number> | null = null

  constructor(
    readonly sab: Sab,
    private readonly records: Records = sab,
  ) {
    if (!sab.asm) throw new SabError('Only Autodesk ShapeManager geometry is supported.')
  }

  bodies() {
    return this.entities().map(({ body }) => body)
  }

  bodyAt(index: number, visited: Set<number>) {
    this.visited = visited
    try {
      return this.body(index)
    } finally {
      this.visited = null
    }
  }

  tags(owners?: Set<number>) {
    const tags = new Map<number, number[]>()
    this.records.types.forEach((type, i) => {
      if (type !== CUSTOM_ATTRIBUTE) return
      const cursor = this.sab.cursor(this.records.starts[i])
      try {
        cursor.ref()
        cursor.long()
        cursor.ref()
        cursor.ref()
        const owner = cursor.ref()
        if ((owners && !owners.has(owner)) || cursor.text() !== TAG_ATTRIBUTE) return
        const values: (number | null)[] = []
        while (!cursor.is(END))
          if (cursor.isNumber()) values.push(cursor.long())
          else if (cursor.peekText() !== null) values.push((cursor.text(), null))
          else cursor.skip()
        const [count = 0, ...ops] = values.slice(values.lastIndexOf(null) + 2)
        tags.set(
          owner,
          ops.slice(0, count ?? 0).map((op) => Math.abs(op ?? 0)),
        )
      } catch (error) {
        if (!(error instanceof SabError)) throw error
      }
    })
    return tags
  }

  entities() {
    const bodies: { entity: number; body: Body }[] = []
    this.records.types.forEach((type, index) => {
      if (type === 'body') bodies.push({ entity: index, body: this.body(index) })
    })
    return bodies
  }

  private appearance(index: number) {
    if (!this.appearances) {
      this.appearances = new Map()
      this.records.types.forEach((type, i) => {
        if (type !== CUSTOM_ATTRIBUTE) return
        const cursor = this.sab.cursor(this.records.starts[i])
        try {
          cursor.ref()
          cursor.long()
          cursor.ref()
          cursor.ref()
          const owner = cursor.ref()
          if (cursor.text() !== MATERIAL_ATTRIBUTE) return
          cursor.long()
          this.appearances!.set(owner, cursor.text())
        } catch (error) {
          if (!(error instanceof SabError)) throw error
        }
      })
    }
    return this.appearances.get(index)
  }

  private record(index: number, base: string) {
    const type = this.records.types[index]
    this.visited?.add(index)
    if (type === undefined || !(type === base || type.endsWith(`-${base}`)))
      throw new SabError(`Expected a ${base} at record ${index} but found ${type ?? 'nothing'}.`)
    const cursor = this.sab.cursor(this.records.starts[index])
    cursor.ref()
    cursor.long()
    cursor.ref()
    return cursor
  }

  private memo<T>(index: number, decode: (index: number) => T): T {
    if (this.cache.has(index)) return this.cache.get(index) as T
    const value = decode(index)
    this.cache.set(index, value)
    return value
  }

  private chain<T>(first: number, decode: (index: number) => { value: T; next: number }) {
    const values: T[] = []
    const seen = new Set<number>()
    for (let index = first; index >= 0 && !seen.has(index) && seen.size < CHAIN_LIMIT; ) {
      seen.add(index)
      const { value, next } = decode(index)
      values.push(value)
      index = next
    }
    return values
  }

  private body(index: number): Body {
    const cursor = this.record(index, 'body')
    const lump = cursor.ref()
    cursor.ref()
    const transform = cursor.ref()
    return {
      lumps: this.chain(lump, (i) => this.lump(i)),
      transform: transform >= 0 ? this.transform(transform) : null,
      attributed: this.sab.cursor(this.records.starts[index]).ref() >= 0,
    }
  }

  private transform(index: number) {
    this.visited?.add(index)
    if (this.records.types[index] !== 'transform') throw new SabError(`Expected a transform at record ${index}.`)
    const cursor = this.sab.cursor(this.records.starts[index])
    cursor.ref()
    cursor.long()
    const [x, y, z, t] = [cursor.vec(), cursor.vec(), cursor.vec(), cursor.vec()]
    const scale = cursor.num()
    return [...x.map((v) => v * scale), ...y.map((v) => v * scale), ...z.map((v) => v * scale), ...t]
  }

  private lump(index: number) {
    const cursor = this.record(index, 'lump')
    const next = cursor.ref()
    const shell = cursor.ref()
    return { value: { shells: this.chain(shell, (i) => this.shell(i)) }, next }
  }

  private shell(index: number) {
    const cursor = this.record(index, 'shell')
    const next = cursor.ref()
    const subshell = cursor.ref()
    const face = cursor.ref()
    const faces = this.chain(face, (i) => this.face(i))
    if (subshell >= 0) faces.push(...this.subshell(subshell))
    return { value: faces, next }
  }

  private subshell(first: number): Face[] {
    return this.chain(first, (index) => {
      const cursor = this.record(index, 'subshell')
      cursor.ref()
      const next = cursor.ref()
      const child = cursor.ref()
      const face = cursor.ref()
      const faces = this.chain(face, (i) => this.face(i))
      if (child >= 0) faces.push(...this.subshell(child))
      return { value: faces, next }
    }).flat()
  }

  private face(index: number): { value: Face; next: number } {
    const cursor = this.record(index, 'face')
    const next = cursor.ref()
    const loop = cursor.ref()
    cursor.ref()
    cursor.ref()
    const surface = cursor.ref()
    const reversed = cursor.bool()
    const sheet = cursor.bool()
    return {
      value: {
        surface: surface >= 0 ? this.memo(surface, (i) => this.surface(i)) : null,
        forward: !reversed,
        sheet,
        loops: this.chain(loop, (i) => this.loop(i)),
        appearance: this.appearance(index),
      },
      next,
    }
  }

  private loop(index: number) {
    const cursor = this.record(index, 'loop')
    const next = cursor.ref()
    const coedge = cursor.ref()
    return { value: { coedges: this.chain(coedge, (i) => this.coedge(i)) }, next }
  }

  private coedge(index: number) {
    const cursor = this.record(index, 'coedge')
    const next = cursor.ref()
    cursor.ref()
    const partner = cursor.ref()
    const edge = cursor.ref()
    const reversed = cursor.bool()
    return {
      value: { edge: this.memo(edge, (i) => this.edge(i)), forward: !reversed, open: partner < 0 },
      next,
    }
  }

  private edge(index: number): Edge {
    const cursor = this.record(index, 'edge')
    const start = cursor.ref()
    cursor.num()
    const end = cursor.ref()
    cursor.num()
    cursor.ref()
    const curve = cursor.ref()
    const reversed = cursor.bool()
    return {
      start: this.memo(start, (i) => this.vertex(i)),
      end: this.memo(end, (i) => this.vertex(i)),
      curve: curve >= 0 ? this.memo(curve, (i) => this.curve(i)) : null,
      forward: !reversed,
    }
  }

  private vertex(index: number): Vertex {
    const cursor = this.record(index, 'vertex')
    cursor.ref()
    if (!cursor.is(REF)) cursor.long()
    const point = this.record(cursor.ref(), 'point')
    return { point: point.vec() }
  }

  private curve(index: number): Curve | null {
    const type = this.records.types[index]
    const cursor = this.record(index, 'curve')
    if (type === 'straight-curve') return { type: 'line', root: cursor.vec(), direction: cursor.vec() }
    if (type === 'ellipse-curve')
      return { type: 'ellipse', center: cursor.vec(), normal: cursor.vec(), major: cursor.vec(), ratio: cursor.num() }
    if (type === 'intcurve-curve') {
      const reversed = cursor.bool()
      const spline = this.subtype(cursor, (inner, name) =>
        name === 'helix_int_cur' ? this.helixCurve(inner) : (this.findSpline(inner, false) as BSplineCurve | null),
      )
      if (spline) return { type: 'spline', spline, forward: !reversed }
    }
    this.missing.curves++
    return null
  }

  private surface(index: number): Surface | null {
    const type = this.records.types[index]
    const cursor = this.record(index, 'surface')
    switch (type) {
      case 'plane-surface':
        return { type: 'plane', root: cursor.vec(), normal: cursor.vec(), u: cursor.vec() }
      case 'cone-surface': {
        const [center, axis, major, ratio] = [cursor.vec(), cursor.vec(), cursor.vec(), cursor.num()]
        this.range(cursor)
        this.range(cursor)
        return { type: 'cone', center, axis, major, ratio, sin: cursor.num(), cos: cursor.num() }
      }
      case 'sphere-surface':
        return { type: 'sphere', center: cursor.vec(), radius: cursor.num(), u: cursor.vec(), pole: cursor.vec() }
      case 'torus-surface':
        return {
          type: 'torus',
          center: cursor.vec(),
          normal: cursor.vec(),
          major: cursor.num(),
          minor: cursor.num(),
          u: cursor.vec(),
        }
      case 'spline-surface': {
        const reversed = cursor.bool()
        const spline = this.subtype(cursor, (inner, name) =>
          name === 'helix_spl_line'
            ? this.helixSurface(inner)
            : name === 'helix_spl_circ'
              ? this.helixTube(inner)
              : (this.findSpline(inner, true) as BSplineSurface | null),
        )
        if (spline) return { type: 'spline', spline, forward: !reversed }
      }
    }
    this.missing.surfaces++
    return null
  }

  private range(cursor: Cursor) {
    if (cursor.bool()) cursor.num()
  }

  private subtype<T>(cursor: Cursor, decode: (inner: Cursor, name: string) => T): T {
    cursor.open()
    const name = cursor.text()
    if (name !== 'ref') return decode(cursor, name)
    const at = this.sab.subtypes[cursor.long()]
    if (at === undefined) throw new SabError('This ACIS file refers to a missing subtype.')
    const inner = this.sab.cursor(at)
    return decode(inner, inner.text())
  }

  private finiteRange(cursor: Cursor): [number, number] | null {
    const low = cursor.bool() ? cursor.num() : null
    const high = cursor.bool() ? cursor.num() : null
    return low === null || high === null ? null : [low, high]
  }

  private helix(cursor: Cursor): (Helix & { axis: Vec }) | null {
    const [root, major, minor, pitch] = [cursor.vec(), cursor.vec(), cursor.vec(), cursor.vec()]
    const taper = cursor.num()
    const axis = cursor.vec()
    return Math.abs(taper) > 1e-12 ? null : { root, major, minor, pitch, axis }
  }

  private helixCurve(cursor: Cursor) {
    if (cursor.is(LONG)) cursor.long()
    const range = this.finiteRange(cursor)
    const helix = this.helix(cursor)
    return range && helix ? helixCurve(helix, range[0], range[1]) : null
  }

  private helixSurface(cursor: Cursor) {
    if (cursor.is(LONG)) cursor.long()
    const u = this.finiteRange(cursor)
    const v = this.finiteRange(cursor)
    this.finiteRange(cursor)
    const helix = this.helix(cursor)
    let line: Vec | null = null
    while (!cursor.is(CLOSE)) {
      if (cursor.isVector()) line = cursor.vec()
      else if (cursor.is(OPEN)) {
        cursor.skip()
        cursor.close()
      } else cursor.skip()
    }
    return u && v && helix && line ? helixLineSurface(helix, helix.axis, line, u, v) : null
  }

  private helixTube(cursor: Cursor) {
    if (cursor.is(LONG)) cursor.long()
    this.finiteRange(cursor)
    const v = this.finiteRange(cursor)
    if (cursor.isNumber()) cursor.num()
    this.finiteRange(cursor)
    const helix = this.helix(cursor)
    let radius: number | null = null
    while (!cursor.is(CLOSE)) {
      if (cursor.isNumber()) radius = cursor.num()
      else if (cursor.is(OPEN)) {
        cursor.skip()
        cursor.close()
      } else cursor.skip()
    }
    if (!v || !helix || !radius) return null
    const size = Math.hypot(...helix.axis)
    const axis = helix.axis.map((value) => value / size) as Vec
    return size > 0 ? helixCircleSurface(helix, axis, Math.abs(radius), v) : null
  }

  private findSpline(cursor: Cursor, surface: boolean): BSplineCurve | BSplineSurface | null {
    for (;;) {
      if (cursor.is(CLOSE)) return null
      if (cursor.is(OPEN)) {
        cursor.skip()
        cursor.close()
        continue
      }
      const word = cursor.peekText()
      if (word === 'nubs' || word === 'nurbs') {
        const at = cursor.at
        cursor.text()
        const ahead = cursor.is(LONG) && (surface ? this.twoDegrees(cursor) : true)
        if (ahead)
          return surface ? this.splineSurface(cursor, word === 'nurbs') : this.splineCurve(cursor, word === 'nurbs')
        cursor.at = at
      } else if (word === 'nullbs' && !surface) return null
      cursor.skip()
    }
  }

  private twoDegrees(cursor: Cursor) {
    const at = cursor.at
    cursor.skip()
    const second = cursor.is(LONG)
    cursor.at = at
    return second
  }

  private closure(cursor: Cursor) {
    const word = cursor.peekText()
    if (word !== null) {
      cursor.text()
      return CLOSURES.indexOf(word)
    }
    return cursor.long()
  }

  private knots(cursor: Cursor, count: number) {
    const knots: number[] = []
    const mults: number[] = []
    for (let i = 0; i < count; i++) {
      knots.push(cursor.num())
      mults.push(cursor.long())
    }
    return { knots, mults, total: mults.reduce((sum, m) => sum + m, 0) }
  }

  private numbers(cursor: Cursor, count: number) {
    if (!(count > 0 && count < 1e8)) throw new SabError('This ACIS spline has an impossible size.')
    const values = new Float64Array(count)
    for (let i = 0; i < count; i++) values[i] = cursor.num()
    return values
  }

  private splineCurve(cursor: Cursor, rational: boolean): BSplineCurve {
    const degree = cursor.long()
    const closure = this.closure(cursor)
    const { knots, mults, total } = this.knots(cursor, cursor.long())
    const points = this.numbers(cursor, (total - degree + 1) * (rational ? 4 : 3))
    return { degree, rational, closed: closure > 0, knots, mults, points }
  }

  private splineSurface(cursor: Cursor, rational: boolean): BSplineSurface {
    const uDegree = cursor.long()
    const vDegree = cursor.long()
    if (rational && !cursor.is(ENUM)) cursor.skip()
    const uClosure = this.closure(cursor)
    const vClosure = this.closure(cursor)
    this.closure(cursor)
    this.closure(cursor)
    const uCount = cursor.long()
    const vCount = cursor.long()
    const u = this.knots(cursor, uCount)
    const v = this.knots(cursor, vCount)
    const columns = u.total - uDegree + 1
    const rows = v.total - vDegree + 1
    return {
      uDegree,
      vDegree,
      rational,
      uClosed: uClosure > 0,
      vClosed: vClosure > 0,
      uKnots: u.knots,
      uMults: u.mults,
      vKnots: v.knots,
      vMults: v.mults,
      uCount: columns,
      vCount: rows,
      points: this.numbers(cursor, columns * rows * (rational ? 4 : 3)),
    }
  }
}
