export type UpAxis = 'y' | 'z'

export interface StepOrigin {
  system: string
  version: string | null
  up: UpAxis | null
  fixed: boolean
}

type Version = (signature: string) => string | null

const HEADER_BYTES = 16384

const version =
  (pattern: RegExp, format = (m: RegExpMatchArray) => m[1]): Version =>
  (signature) => {
    const match = signature.match(pattern)
    return match ? format(match) : null
  }

const SYSTEMS: [RegExp, string, UpAxis | null, boolean, Version?][] = [
  [/KiCad|Pcbnew/i, 'KiCad', 'z', true],
  [/ONSHAPE/i, 'Onshape', null, false, version(/ONSHAPE BY PTC INC,\s*(\d+\.\d+)/i)],
  [/Shapr3D/i, 'Shapr3D', 'z', true],
  [/build123d/i, 'build123d', 'z', true],
  [/CadQuery/i, 'CadQuery', 'z', true],
  [/FreeCAD/i, 'FreeCAD', 'z', true],
  [/Rhino/i, 'Rhino', 'z', true, version(/Rhino (\d+\.\d+)/i)],
  [/CATIA/i, 'CATIA', 'z', true, version(/CATIA Version (\d+(?:-\d+)?) Release (\w+)/i, (m) => `V${m[1]} R${m[2]}`)],
  [/CREO|Pro\/ENGINEER/i, 'Creo', 'z', true],
  [/Solid ?Edge/i, 'Solid Edge', 'z', true],
  [/SolidWorks|SwSTEP/i, 'SolidWorks', null, false, version(/SolidWorks (\d{4})/i)],
  [/Inventor/i, 'Inventor', 'y', false, version(/Inventor (\d{4})/i)],
  [/Autodesk Translation Framework|Fusion/i, 'Fusion', 'z', false],
  [/Open CASCADE/i, 'Open CASCADE', 'z', true, version(/Open CASCADE STEP processor (\d+\.\d+)/i)],
]

export function stepOrigin(text: string): StepOrigin | null {
  const head = text.slice(0, HEADER_BYTES).replace(/\/\*[\s\S]*?\*\//g, '')
  const end = head.search(/ENDSEC\s*;/)
  const header = end > 0 ? head.slice(0, end) : head
  const fields = headerFields(header, 'FILE_NAME')
  const description = headerFields(header, 'FILE_DESCRIPTION')
  const signature = [...fields.slice(2), ...description].join(' ')
  for (const [pattern, system, up, fixed, read] of SYSTEMS)
    if (pattern.test(signature)) return { system, version: read?.(signature) ?? null, up, fixed }
  return null
}

function headerFields(header: string, entity: string) {
  const start = header.search(new RegExp(`${entity}\\s*\\(`))
  if (start < 0) return []
  const fields: string[] = []
  let depth = 0
  let current = ''
  let quoted = false
  for (let i = header.indexOf('(', start); i < header.length; i++) {
    const c = header[i]
    if (quoted) {
      if (c === "'" && header[i + 1] === "'") current += header[i++]
      else if (c === "'") quoted = false
      else current += c
    } else if (c === "'") quoted = true
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) break
    else if (c === ',' && depth === 1) {
      fields.push(current.trim())
      current = ''
    } else if (depth > 1) current += c === ',' ? ' ' : c
  }
  fields.push(current.trim())
  return fields
}
