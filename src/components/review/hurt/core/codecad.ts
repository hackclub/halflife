import type { HurtFile } from '../types'
import { isLibraryPath } from './classify'

export interface CodeCadNote {
  label: string
  facts: string[]
  note: string | null
  outputs: HurtFile[]
}

const PYTHON_TOOLS: [string, RegExp][] = [
  ['CadQuery', /^[ \t]*(?:import[ \t]+cadquery\b|from[ \t]+cadquery\b)/m],
  ['build123d', /^[ \t]*(?:import[ \t]+build123d\b|from[ \t]+build123d\b)/m],
  ['SolidPython', /^[ \t]*(?:import[ \t]+solid2?\b|from[ \t]+solid2?\b)/m],
  ['FreeCAD', /^[ \t]*(?:import[ \t]+(?:FreeCAD|FreeCADGui|Part)\b|from[ \t]+FreeCAD\b)/m],
]
const MODEL_EXTENSIONS = 'step|stp|stl|3mf|obj|glb|gltf|amf|ply|dxf|svg|iges|igs'
const MODEL_EXT = new RegExp(`\\.(${MODEL_EXTENSIONS})$`, 'i')
const QUOTED_MODEL = new RegExp(`["'\`]([^"'\`\\n]{1,200}\\.(?:${MODEL_EXTENSIONS}))["'\`]`, 'gi')
const SOLID_EXT = /\.(step|stp|iges|igs)$/i
const PARASOLID_EXT = new Set(['x_t', 'xt', 'xmt_txt'])
const OUTPUT_LIMIT = 8
const MATCH_LIMIT = 2000
const ACIS_UNITS: Record<number, string> = { 1: 'millimetres', 10: 'centimetres', 1000: 'metres', 25.4: 'inches' }

function distance(a: string, b: string) {
  const x = a ? a.split('/') : []
  const y = b ? b.split('/') : []
  let common = 0
  while (common < x.length && common < y.length && x[common] === y[common]) common++
  return x.length + y.length - 2 * common
}

function stemOf(name: string) {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase()
}

function closest(file: HurtFile, candidates: HurtFile[]) {
  return candidates.reduce<HurtFile | null>(
    (best, f) => (!best || distance(file.dir, f.dir) < distance(file.dir, best.dir) ? f : best),
    null,
  )
}

function libraryScope(file: HurtFile) {
  const parts = file.path.split('/')
  for (let i = 1; i < parts.length; i++) {
    if (isLibraryPath(parts.slice(0, i).join('/')))
      return `${parts.slice(0, Math.min(i + 1, parts.length - 1)).join('/')}/`
  }
  return null
}

function relatedModels(file: HurtFile, text: string | null, files: HurtFile[], test: RegExp) {
  const scope = libraryScope(file)
  const usable = files.filter(
    (f) =>
      f.path !== file.path && test.test(f.name) && (!isLibraryPath(f.path) || (!!scope && f.path.startsWith(scope))),
  )
  const found = new Set<HurtFile>()
  if (text) {
    const byName = new Map<string, HurtFile[]>()
    for (const f of usable) {
      const key = f.name.toLowerCase()
      const list = byName.get(key)
      if (list) list.push(f)
      else byName.set(key, [f])
    }
    let count = 0
    for (const match of text.matchAll(QUOTED_MODEL)) {
      if (count++ > MATCH_LIMIT || found.size >= OUTPUT_LIMIT) break
      const name = match[1].split(/[\\/]/).pop()!.toLowerCase()
      const best = closest(file, byName.get(name) ?? [])
      if (best) found.add(best)
    }
  }
  const stem = stemOf(file.name)
  usable
    .filter((f) => stemOf(f.name) === stem && distance(file.dir, f.dir) <= 2)
    .sort((a, b) => distance(file.dir, a.dir) - distance(file.dir, b.dir))
    .forEach((f) => found.add(f))
  return [...found].slice(0, OUTPUT_LIMIT)
}

function lengthPrefixed(line: string) {
  const values: string[] = []
  let rest = line
  for (let i = 0; i < 4; i++) {
    const match = rest.match(/^\s*(\d+) /)
    if (!match) break
    const length = Number(match[1])
    const start = match[0].length
    if (start + length > rest.length) break
    values.push(rest.slice(start, start + length).trim())
    rest = rest.slice(start + length)
  }
  return values
}

function parasolid(text: string) {
  if (!text.startsWith('**ABCDEFGHIJ')) return null
  const header = text.slice(0, 4000)
  const field = (key: string) => {
    const value = header
      .match(new RegExp(`^${key}=((?:\\^.|[^;\\n^])*);`, 'm'))?.[1]
      ?.replace(/\^(.)/g, (_, c: string) => (c === '_' ? ' ' : c))
      .trim()
    return value && value !== 'unknown' ? value : null
  }
  const fru = field('FRU')
  const kernel = fru && /^parasolid\b/i.test(fru) ? fru : null
  const application = field('APPL') ?? (kernel || /^sdl_/i.test(fru ?? '') ? null : fru)
  return [application && `Saved by ${application}`, kernel, field('DATE')?.replace(/T\d.*$/, '')].filter(
    (fact): fact is string => !!fact,
  )
}

function acis(text: string, complete: boolean) {
  const lines = text.slice(0, 2000).split('\n', 3)
  const counts = lines[0]?.match(/^\s*(\d+)\s+\d+\s+(\d+)\s+\d+/)
  if (!counts || Number(counts[1]) < 100) return null
  const [application, kernel, date] = lengthPrefixed(lines[1] ?? '')
  const scale = Number(lines[2]?.trim().split(/\s+/)[0])
  const bodies = complete ? (text.match(/^body /gm) ?? []).length : Number(counts[2])
  return [
    application && `Saved by ${application}`,
    kernel,
    date,
    ACIS_UNITS[scale] && `Units: ${ACIS_UNITS[scale]}`,
    bodies > 0 && `${bodies.toLocaleString()} ${bodies === 1 ? 'body' : 'bodies'}`,
  ].filter((fact): fact is string => !!fact)
}

export function codeCadOf(file: HurtFile, text: string, files: HurtFile[], complete: boolean): CodeCadNote | null {
  if (PARASOLID_EXT.has(file.ext) || file.ext === 'sat') {
    const facts = file.ext === 'sat' ? acis(text, complete) : parasolid(text)
    if (!facts) return null
    return {
      label: file.ext === 'sat' ? 'ACIS model' : 'Parasolid model',
      facts,
      note: 'The browser has no kernel for this format. A STEP export of the same part opens in the 3D viewer.',
      outputs: relatedModels(file, null, files, SOLID_EXT),
    }
  }
  const code = (tool: string, label: string, read: boolean): CodeCadNote => {
    const outputs = relatedModels(file, read ? text : null, files, MODEL_EXT)
    return {
      label,
      facts: [],
      note: outputs.length > 0 ? `This viewer shows ${tool} code without running it. Related models:` : null,
      outputs,
    }
  }
  if (file.ext === 'scad') return code('OpenSCAD', 'OpenSCAD source', false)
  if (file.ext === 'jscad') return code('JSCAD', 'JSCAD script', true)
  if (file.ext !== 'py') return null
  const tool = PYTHON_TOOLS.find(([, test]) => test.test(text))?.[0]
  return tool ? code(tool, `${tool} script`, true) : null
}
