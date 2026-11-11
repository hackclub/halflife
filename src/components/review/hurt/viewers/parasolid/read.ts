import { StepWriter } from '../brep/step'
import { isSwContainer, solidworksSections } from '../cadsource/solidworks'
import { inflateTo } from '../office/inflate'
import { XtBrep } from './brep'
import { readXt, XtError, type XtModel } from './xt'

const PARASOLID_MILLIMETRES = 1000
const MAGIC = [0x23, 0x1d, 0xd5, 0x71, 0xda, 0x81, 0x48, 0xa2, 0xa8, 0x58, 0x98, 0xb2, 0x1b, 0x89, 0xef, 0x99]
const BODY_SECTION = /(-Partition|\/LocalBodies)$/
const SKIPPED_SECTION = /Ghost/
const MAX_TRANSMIT = 512 * 1024 * 1024
const MAX_RECORDS = 1_000_000
const TRANSMIT = 'TRANSMIT FILE'
const DELTAS = '(deltas)'

export interface ParasolidShape {
  name: string
  step: string
  faces: number
  splines: number
  colour: number[] | null
  faceColours: (number[] | null)[]
}

export interface ParasolidModel {
  shapes: ParasolidShape[]
  preview: Uint8Array | null
  up: 'y' | 'z'
  warnings: string[]
}

function findMagic(bytes: Uint8Array, from: number) {
  outer: for (let i = from; i + MAGIC.length + 8 <= bytes.length; i++) {
    for (let k = 0; k < MAGIC.length; k++) if (bytes[i + k] !== MAGIC[k]) continue outer
    return i
  }
  return -1
}

async function transmits(section: Uint8Array) {
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength)
  const out: Uint8Array[] = []
  for (let at = findMagic(section, 0); at >= 0; at = findMagic(section, at + MAGIC.length)) {
    const usize = view.getUint32(at + 16, true)
    const csize = view.getUint32(at + 20, true)
    if (usize > MAX_TRANSMIT || at + 24 + csize > section.length) continue
    const parts = [await inflateTo(section.subarray(at + 24, at + 24 + csize), usize)]
    let next = at + 24 + csize
    for (let k = 0; k < MAX_RECORDS && next + 8 <= section.length; k++) {
      const [size, compressed] = [view.getUint32(next, true), view.getUint32(next + 4, true)]
      if (size === 0 || size > MAX_TRANSMIT || next + 8 + compressed > section.length) break
      parts.push(await inflateTo(section.subarray(next + 8, next + 8 + compressed), size))
      next += 8 + compressed
    }
    const data = parts.length === 1 ? parts[0] : concat(parts)
    const head = new TextDecoder('latin1').decode(data.subarray(0, 80))
    if (head.includes(TRANSMIT) && !head.includes(DELTAS)) out.push(data)
  }
  return out
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function shapes(model: XtModel, name: string, warnings: Set<string>) {
  const brep = new XtBrep(model)
  const out: ParasolidShape[] = []
  for (const [i, { body, colour, faceColours }] of brep.bodies().entries()) {
    const writer = new StepWriter(PARASOLID_MILLIMETRES)
    const items = writer.body(body)
    if (items.length === 0) continue
    const all = body.lumps.flatMap((lump) => lump.shells.flat())
    const written = new Set(writer.written)
    let splines = 0
    for (const face of all) if (face.surface?.type === 'spline') splines++
    out.push({
      name: `Body${i + 1}`,
      step: writer.write(name, items),
      faces: all.length,
      splines,
      colour,
      faceColours: all.flatMap((face, k) => (written.has(face) ? [faceColours[k]] : [])),
    })
  }
  const missing = brep.missing.curves + brep.missing.surfaces
  if (missing > 0)
    warnings.add(`${missing} curves or surfaces use geometry this viewer can't rebuild, so some faces are missing.`)
  return out
}

export async function readParasolid(bytes: Uint8Array, name: string): Promise<ParasolidModel> {
  const warnings = new Set<string>()
  if (!isSwContainer(bytes)) {
    const model = readXt(bytes)
    return { shapes: shapes(model, name, warnings), preview: null, up: 'z', warnings: [...warnings] }
  }
  const container = solidworksSections(bytes)
  const found: ParasolidShape[] = []
  for (const section of container.names.filter((n) => BODY_SECTION.test(n) && !SKIPPED_SECTION.test(n))) {
    const data = await container.read(section)
    if (!data) continue
    for (const transmit of await transmits(data))
      try {
        found.push(...shapes(readXt(transmit), name, warnings))
      } catch (error) {
        if (!(error instanceof XtError)) throw error
        warnings.add(`Some geometry in this part could not be read: ${error.message}`)
      }
  }
  found.forEach((shape, i) => (shape.name = `Body${i + 1}`))
  return { shapes: found, preview: await container.read('PreviewPNG'), up: 'y', warnings: [...warnings] }
}
