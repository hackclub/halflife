const CHAR = 2
const SHORT = 3
export const LONG = 4
const FLOAT = 5
const DOUBLE = 6
const STR8 = 7
const STR16 = 8
const STR32 = 9
export const TRUE = 10
export const FALSE = 11
export const REF = 12
const IDENT = 13
const SUBIDENT = 14
export const OPEN = 15
export const CLOSE = 16
export const END = 17
const STR32B = 18
const POSITION = 19
const VECTOR = 20
export const ENUM = 21
const VECTOR2 = 22
const INT64 = 23

const MAGIC = /^(ACIS|ASM) BinaryFile([48]?)/
const DATA_END = /^(End-of-|Begin-of-)/
const HISTORY_START = /^Begin-of-.*History/
const HISTORY_END = /^End-of-.*History/
const DELTA_STATE = 'delta_state'
const DELTA_LINKS = 5
const latin1 = new TextDecoder('latin1')

import type { Vec } from '../brep/types'

export type { Vec }

export class SabError extends Error {}

export interface Records {
  types: string[]
  starts: number[]
}

interface History extends Records {
  states: { id: number; bulletins: number[] }[]
}

export class Sab {
  readonly types: string[] = []
  readonly starts: number[] = []
  readonly subtypes: number[] = []
  readonly version: number
  readonly product: string
  readonly kernel: string
  readonly millimetres: number
  readonly asm: boolean
  readonly wide: boolean
  readonly view: DataView
  private historyAt = -1
  private past: History | null | undefined

  constructor(readonly bytes: Uint8Array) {
    const magic = latin1.decode(bytes.subarray(0, 15)).match(MAGIC)
    if (!magic) throw new SabError('This is not an ACIS binary file.')
    this.asm = magic[1] === 'ASM'
    this.wide = magic[2] === '8'
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const start = 15 + 4 * (this.wide ? 8 : 4)
    if (bytes.length < start) throw new SabError('This ACIS file ends early.')
    this.version = this.view.getInt32(15, true)
    const header = new Cursor(this, start)
    this.product = header.text()
    this.kernel = header.text()
    header.text()
    this.millimetres = header.num()
    header.num()
    header.num()
    this.index(header.at)
  }

  cursor(at: number) {
    return new Cursor(this, at)
  }

  states() {
    return this.history()?.states.map((state) => state.id) ?? []
  }

  touched(after: number, upTo: number) {
    const touched = new Set<number>()
    for (const { id, bulletins } of this.history()?.states ?? [])
      if (id > after && id <= upTo) for (const entity of bulletins) if (entity >= 0) touched.add(entity)
    return touched
  }

  rollBack(state: number): Records | null {
    const history = this.history()
    if (!history) return null
    const all = { types: [...this.types, ...history.types], starts: [...this.starts, ...history.starts] }
    const types = all.types.map((type, i) => (i < this.types.length ? type : ''))
    const starts = [...all.starts]
    for (const { id, bulletins } of history.states) {
      if (id <= state) break
      for (let i = 0; i + 1 < bulletins.length; i += 2) {
        const [old, now] = [bulletins[i], bulletins[i + 1]]
        const target = now < 0 ? old : now
        if (target < 0 || target >= types.length) continue
        types[target] = old < 0 ? '' : (all.types[old] ?? '')
        if (old >= 0 && old < starts.length) starts[target] = all.starts[old]
      }
    }
    return { types, starts }
  }

  private history() {
    if (this.past === undefined)
      try {
        this.past = this.historyAt < 0 ? null : this.readHistory(this.historyAt)
      } catch (error) {
        if (!(error instanceof SabError)) throw error
        this.past = null
      }
    return this.past
  }

  private readHistory(start: number): History {
    const history: History = { types: [], starts: [], states: [] }
    const cursor = new Cursor(this, start)
    let section = true
    while (cursor.at < this.bytes.length) {
      let type = ''
      while (cursor.tag() === SUBIDENT) type += `${cursor.text()}-`
      if (cursor.tag() !== IDENT) throw new SabError('This ACIS history is damaged.')
      type += cursor.text()
      if (HISTORY_END.test(type)) {
        section = false
        continue
      }
      if (DATA_END.test(type)) break
      const at = cursor.at
      if (type === DELTA_STATE) history.states.push(this.deltaState(cursor))
      else if (!section) {
        history.types.push(type)
        history.starts.push(at)
      }
      for (let tag = cursor.tag(); tag !== END; tag = cursor.tag()) {
        cursor.skip()
        if (tag === OPEN && cursor.peekText() !== 'ref') this.subtypes.push(cursor.at)
      }
      cursor.skip()
    }
    history.states.sort((a, b) => b.id - a.id)
    return history
  }

  private deltaState(cursor: Cursor) {
    const id = cursor.long()
    cursor.long()
    cursor.long()
    for (let i = 0; i < DELTA_LINKS; i++) cursor.ref()
    cursor.bool()
    const bulletins: number[] = []
    while (cursor.tag() !== END && cursor.long() === 1) {
      cursor.ref()
      cursor.long()
      while (cursor.tag() !== END && cursor.long() === 1) bulletins.push(cursor.ref(), cursor.ref())
    }
    return { id, bulletins }
  }

  private index(start: number) {
    const cursor = new Cursor(this, start)
    while (cursor.at < this.bytes.length) {
      let type = ''
      while (cursor.tag() === SUBIDENT) type += `${cursor.text()}-`
      if (cursor.tag() !== IDENT) throw new SabError('This ACIS file is damaged.')
      type += cursor.text()
      if (DATA_END.test(type)) {
        if (HISTORY_START.test(type)) this.historyAt = cursor.at
        return
      }
      this.types.push(type)
      this.starts.push(cursor.at)
      for (let tag = cursor.tag(); tag !== END; tag = cursor.tag()) {
        if (tag === OPEN) {
          cursor.skip()
          if (cursor.peekText() !== 'ref') this.subtypes.push(cursor.at)
        } else cursor.skip()
      }
      cursor.skip()
    }
  }
}

export class Cursor {
  constructor(
    readonly sab: Sab,
    public at: number,
  ) {}

  private lengthSize(tag: number) {
    return tag === STR32 && this.sab.wide ? 8 : 4
  }

  tag() {
    if (this.at >= this.sab.bytes.length) throw new SabError('This ACIS file ends early.')
    return this.sab.bytes[this.at]
  }

  skip() {
    const { view } = this.sab
    const tag = this.tag()
    const at = this.at + 1
    switch (tag) {
      case CHAR:
        this.at = at + 1
        break
      case SHORT:
        this.at = at + 2
        break
      case LONG:
      case REF:
      case ENUM:
        this.at = at + (this.sab.wide ? 8 : 4)
        break
      case FLOAT:
        this.at = at + 4
        break
      case DOUBLE:
      case INT64:
        this.at = at + 8
        break
      case STR8:
      case IDENT:
      case SUBIDENT:
        this.at = at + 1 + view.getUint8(at)
        break
      case STR16:
        this.at = at + 2 + view.getUint16(at, true)
        break
      case STR32:
      case STR32B:
        this.at = at + this.lengthSize(tag) + view.getUint32(at, true)
        break
      case TRUE:
      case FALSE:
      case OPEN:
      case CLOSE:
      case END:
        this.at = at
        break
      case POSITION:
      case VECTOR:
        this.at = at + 24
        break
      case VECTOR2:
        this.at = at + 16
        break
      default:
        throw new SabError(`This ACIS file has an unknown value type ${tag}.`)
    }
  }

  long(): number {
    const tag = this.tag()
    const { view } = this.sab
    const at = this.at + 1
    if (tag === LONG || tag === REF || tag === ENUM) {
      if (!this.sab.wide) return ((this.at = at + 4), view.getInt32(at, true))
      this.at = at + 8
      return Number(view.getBigInt64(at, true))
    }
    if (tag === CHAR) return ((this.at = at + 1), view.getUint8(at))
    if (tag === SHORT) return ((this.at = at + 2), view.getInt16(at, true))
    if (tag === INT64) return ((this.at = at + 8), Number(view.getBigInt64(at, true)))
    if (tag === DOUBLE || tag === FLOAT) return Math.round(this.num())
    throw this.unexpected('a whole number')
  }

  num(): number {
    const tag = this.tag()
    const { view } = this.sab
    const at = this.at + 1
    if (tag === DOUBLE) return ((this.at = at + 8), view.getFloat64(at, true))
    if (tag === FLOAT) return ((this.at = at + 4), view.getFloat32(at, true))
    if (tag === LONG || tag === SHORT || tag === CHAR || tag === INT64) return this.long()
    throw this.unexpected('a number')
  }

  ref() {
    if (this.tag() !== REF) throw this.unexpected('an entity reference')
    return this.long()
  }

  bool() {
    const tag = this.tag()
    if (tag === TRUE || tag === FALSE) {
      this.at++
      return tag === TRUE
    }
    if (tag === ENUM || tag === LONG) return this.long() !== 0
    throw this.unexpected('a flag')
  }

  text() {
    const tag = this.tag()
    const { view, bytes } = this.sab
    const at = this.at + 1
    let start: number
    let length: number
    if (tag === STR8 || tag === IDENT || tag === SUBIDENT) [start, length] = [at + 1, view.getUint8(at)]
    else if (tag === STR16) [start, length] = [at + 2, view.getUint16(at, true)]
    else if (tag === STR32 || tag === STR32B) [start, length] = [at + this.lengthSize(tag), view.getUint32(at, true)]
    else throw this.unexpected('a name')
    this.at = start + length
    return latin1.decode(bytes.subarray(start, start + length))
  }

  peekText() {
    const tag = this.tag()
    if (tag !== STR8 && tag !== IDENT && tag !== SUBIDENT && tag !== STR16 && tag !== STR32 && tag !== STR32B)
      return null
    const at = this.at
    const value = this.text()
    this.at = at
    return value
  }

  vec(): Vec {
    const tag = this.tag()
    if (tag === POSITION || tag === VECTOR) {
      const { view } = this.sab
      const at = this.at + 1
      this.at = at + 24
      return [view.getFloat64(at, true), view.getFloat64(at + 8, true), view.getFloat64(at + 16, true)]
    }
    return [this.num(), this.num(), this.num()]
  }

  is(...tags: number[]) {
    return tags.includes(this.tag())
  }

  isVector() {
    const tag = this.tag()
    return tag === POSITION || tag === VECTOR
  }

  isNumber() {
    const tag = this.tag()
    return tag === DOUBLE || tag === FLOAT || tag === LONG || tag === SHORT || tag === CHAR || tag === INT64
  }

  open() {
    if (this.tag() !== OPEN) throw this.unexpected('a subtype')
    this.at++
  }

  close() {
    let depth = 0
    for (;;) {
      const tag = this.tag()
      if (tag === END) throw new SabError('This ACIS file has an unclosed subtype.')
      this.skip()
      if (tag === OPEN) depth++
      else if (tag === CLOSE) {
        if (depth === 0) return
        depth--
      }
    }
  }

  private unexpected(what: string) {
    return new SabError(`Expected ${what} at byte ${this.at} of the ACIS data but found type ${this.tag()}.`)
  }
}
