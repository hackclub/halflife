import { BASE_SCHEMA } from './schema'

const TERMINATOR = 1
const SAME_AS_BASE = 255
const NULL_INT = -32764
const NULL_REAL = -3.14158e13
const MAX_NODES = 5_000_000
const MAX_FIELDS = 255
const VARIABLE = -1

export class XtError extends Error {}

export interface XtField {
  name: string
  type: string
  transmitted: boolean
  count: number
}

export type XtValue = number | string | boolean | null | number[] | (number | null)[]

export interface XtNode {
  type: number
  name: string
  index: number
  values: Record<string, XtValue>
}

export interface XtModel {
  nodes: Map<number, XtNode>
  modeller: string
  schema: string
}

let baseSchema: Map<number, { name: string; fields: XtField[] }> | null = null

function base() {
  if (baseSchema) return baseSchema
  baseSchema = new Map()
  for (const line of BASE_SCHEMA.split('\n')) {
    const [code, name, ...fields] = line.trim().split(' ')
    if (!name) continue
    baseSchema.set(Number(code), {
      name,
      fields: fields.map((spec) => {
        const [fieldName, rest] = spec.split(':')
        const transmitted = !rest.includes('!')
        const tail = rest.slice(1).replace('!', '')
        return { name: fieldName, type: rest[0], transmitted, count: tail === '*' ? VARIABLE : Number(tail || 0) }
      }),
    })
  }
  return baseSchema
}

interface Input {
  byte(): number
  char(): string
  logical(): boolean
  short(): number
  int(): number
  pointer(): number
  real(): number | null
  vector(): number[] | null
  string(): string
  count(): number
  done(): boolean
}

class BinaryInput implements Input {
  private at: number
  private readonly view: DataView

  constructor(
    private readonly bytes: Uint8Array,
    start: number,
  ) {
    this.at = start
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private need(size: number) {
    if (this.at + size > this.bytes.length) throw new XtError('This Parasolid file ends early.')
    const at = this.at
    this.at += size
    return at
  }

  done() {
    return this.at >= this.bytes.length
  }

  byte() {
    return this.bytes[this.need(1)]
  }

  char() {
    return String.fromCharCode(this.byte())
  }

  logical() {
    return this.byte() !== 0
  }

  short() {
    return this.view.getInt16(this.need(2))
  }

  int() {
    const value = this.view.getInt32(this.need(4))
    return value
  }

  pointer() {
    let remainder = this.short()
    let quotient = 0
    if (remainder < 0) {
      quotient = this.short()
      remainder = -remainder
    }
    return quotient * 32767 + remainder - 1
  }

  count() {
    return this.pointer()
  }

  real() {
    const value = this.view.getFloat64(this.need(8))
    return value === NULL_REAL ? null : value
  }

  vector() {
    const values = [this.real(), this.real(), this.real()]
    return values.some((v) => v === null) ? null : (values as number[])
  }

  string() {
    const length = this.byte()
    const at = this.need(length)
    let text = ''
    for (let i = 0; i < length; i++) text += String.fromCharCode(this.bytes[at + i])
    return text
  }
}

class TextInput implements Input {
  private at = 0

  constructor(private readonly text: string) {}

  done() {
    return this.at >= this.text.length
  }

  private token() {
    if (this.text[this.at] === '?') {
      this.at++
      return null
    }
    const end = this.text.indexOf(' ', this.at)
    if (end < 0) throw new XtError('This Parasolid file ends early.')
    const token = this.text.slice(this.at, end)
    this.at = end + 1
    return token
  }

  private number() {
    const token = this.token()
    if (token === null) return null
    const value = Number(token)
    if (!Number.isFinite(value))
      throw new XtError(`This Parasolid file has an unreadable number "${token.slice(0, 20)}".`)
    return value
  }

  byte() {
    return this.number() ?? NULL_INT
  }

  char() {
    if (this.at >= this.text.length) throw new XtError('This Parasolid file ends early.')
    return this.text[this.at++]
  }

  logical() {
    return this.char() === 'T'
  }

  short() {
    return this.number() ?? NULL_INT
  }

  int() {
    return this.number() ?? NULL_INT
  }

  pointer() {
    return this.number() ?? 0
  }

  count() {
    return this.number() ?? 0
  }

  real() {
    return this.number()
  }

  vector() {
    if (this.text[this.at] === '?') {
      this.at++
      return null
    }
    return [this.number() ?? 0, this.number() ?? 0, this.number() ?? 0]
  }

  string() {
    const length = this.number() ?? 0
    const value = this.text.slice(this.at, this.at + length)
    this.at += length
    return value
  }
}

function readField(input: Input): XtField {
  const name = input.string()
  const pointerClass = input.short()
  const elements = input.count()
  const type = pointerClass !== 0 ? 'p' : input.string()
  const transmitted = elements === 1 ? input.logical() : true
  return { name, type, transmitted, count: elements === 1 ? VARIABLE : elements }
}

function readDefinition(input: Input, type: number, embedded: boolean) {
  const known = base().get(type)
  if (!embedded) {
    if (!known) throw new XtError(`This Parasolid file uses an unknown node type ${type}.`)
    return known
  }
  if (!known) {
    const count = input.byte()
    const name = input.string()
    input.string()
    const fields: XtField[] = []
    for (let i = 0; i < count; i++) fields.push(readField(input))
    return { name, fields }
  }
  const flag = input.byte()
  if (flag === SAME_AS_BASE) return known
  const fields: XtField[] = []
  let at = 0
  for (let guard = 0; guard < MAX_FIELDS * 4; guard++) {
    const op = input.char()
    if (op === 'Z') return { name: known.name, fields }
    if (op === 'C') fields.push(known.fields[at++])
    else if (op === 'D') at++
    else if (op === 'I' || op === 'A') fields.push(readField(input))
    else throw new XtError(`This Parasolid file has an unknown schema edit "${op}".`)
  }
  throw new XtError('This Parasolid file has a runaway schema edit.')
}

function readValue(input: Input, type: string): XtValue {
  switch (type) {
    case 'u':
      return input.byte()
    case 'c':
      return input.char()
    case 'l':
      return input.logical()
    case 'n':
    case 'w':
      return input.short()
    case 'd':
    case 't':
      return input.int()
    case 'p':
      return input.pointer()
    case 'f':
      return input.real()
    case 'i':
      return [input.real() ?? 0, input.real() ?? 0]
    case 'v':
    case 'h':
      return input.vector()
    case 'b':
      return [0, 0, 0, 0, 0, 0].map(() => input.real() ?? 0)
  }
  throw new XtError(`This Parasolid file uses an unknown field type "${type}".`)
}

function readFields(input: Input, fields: XtField[], length: number) {
  const values: Record<string, XtValue> = {}
  for (const field of fields) {
    if (!field.transmitted) continue
    const count = field.count === VARIABLE ? length : field.count
    if (count === 0) {
      values[field.name] = readValue(input, field.type)
      continue
    }
    if (field.type === 'c') {
      let text = ''
      for (let i = 0; i < count; i++) text += input.char()
      values[field.name] = text
      continue
    }
    const list: XtValue[] = []
    for (let i = 0; i < count; i++) list.push(readValue(input, field.type))
    values[field.name] = list.flat() as XtValue
  }
  return values
}

function parse(input: Input, modeller: string, schema: string, embedded: boolean): XtModel {
  const nodes = new Map<number, XtNode>()
  const definitions = new Map<number, { name: string; fields: XtField[] }>()
  while (!input.done() && nodes.size < MAX_NODES) {
    const type = input.short()
    if (type === TERMINATOR) break
    let definition = definitions.get(type)
    if (!definition) {
      definition = readDefinition(input, type, embedded)
      definitions.set(type, definition)
    }
    const length = definition.fields.some((f) => f.count === VARIABLE) ? input.int() : 0
    const index = input.pointer()
    nodes.set(index, { type, name: definition.name, index, values: readFields(input, definition.fields, length) })
  }
  return { nodes, modeller, schema }
}

const HEADER_END = '**END_OF_HEADER'

export function isXtText(bytes: Uint8Array) {
  return (
    bytes[0] === 0x2a &&
    bytes[1] === 0x2a &&
    new TextDecoder('latin1').decode(bytes.subarray(0, 16)).startsWith('**ABCDEFGHIJ')
  )
}

function binaryStart(bytes: Uint8Array) {
  for (let i = 0; i + 4 <= Math.min(bytes.length, 64 * 1024); i++)
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x53 && bytes[i + 2] === 0 && bytes[i + 3] === 0) return i
  return -1
}

export function readXt(bytes: Uint8Array): XtModel {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 64 * 1024)))
  const end = head.indexOf(HEADER_END)
  const afterHeader = end >= 0 ? head.indexOf('\n', end) + 1 : 0
  if (bytes[afterHeader] === 0x54) {
    const text = new TextDecoder('latin1').decode(bytes.subarray(afterHeader + 1)).replace(/[\r\n]/g, '')
    const input = new TextInput(text)
    const modeller = input.string()
    const schema = input.string()
    const embedded = /^SCH_\d+_\d+_\d+$/.test(schema)
    if (embedded) input.short()
    input.int()
    return parse(input, modeller, schema, embedded)
  }
  const start = binaryStart(bytes)
  if (start < 0) throw new XtError('This is not a Parasolid file.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = start + 4
  const text = (length: number) => {
    const value = new TextDecoder('latin1').decode(bytes.subarray(at, at + length))
    at += length
    return value
  }
  at += 2
  const modeller = text(view.getUint16(at - 2))
  at += 4
  const schema = text(view.getUint32(at - 4))
  const input = new BinaryInput(bytes, at)
  const embedded = /^SCH_\d+_\d+_\d+$/.test(schema)
  if (embedded) input.short()
  input.int()
  return parse(input, modeller, schema, embedded)
}
