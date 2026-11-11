import type { HurtFile } from '../types'

export type EdaFormat =
  | 'eagle'
  | 'eagle-binary'
  | 'kicad-legacy-schematic'
  | 'kicad-legacy-board'
  | 'kicad-legacy-footprints'
  | 'kicad-legacy-symbols'
  | 'kicad-legacy-docs'
  | 'kicad-schematic'
  | 'kicad-board'
  | 'easyeda'
  | 'zip'

export type LegacyEdaFormat = Exclude<EdaFormat, 'eagle' | 'kicad-schematic' | 'kicad-board' | 'easyeda' | 'zip'>

export const EDA_EXTENSIONS = new Set(['brd', 'sch', 'lbr', 'mod', 'lib', 'pcb', 'dcm'])

const EAGLE_EXTENSIONS = new Set(['brd', 'sch', 'lbr'])
const SPACE = /\s/

function after(text: string, token: string, from: number) {
  const end = text.indexOf(token, from)
  return end < 0 ? text.length : end + token.length
}

function isEagleXml(head: string) {
  let at = 0
  while (at < head.length) {
    while (at < head.length && SPACE.test(head[at])) at++
    if (head.startsWith('<?', at)) at = after(head, '?>', at + 2)
    else if (head.startsWith('<!--', at)) at = after(head, '-->', at + 4)
    else if (head.startsWith('<!DOCTYPE', at)) {
      if (/^<!DOCTYPE\s+eagle\b/.test(head.slice(at, at + 32))) return true
      at = after(head, '>', at)
    } else return /^<eagle[\s>]/.test(head.slice(at, at + 7))
  }
  return false
}

export function detectEda(bytes: Uint8Array, ext: string): EdaFormat | null {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip'
  if (EAGLE_EXTENSIONS.has(ext) && bytes[0] === 0x10 && (bytes[1] === 0x00 || bytes[1] === 0x80)) return 'eagle-binary'
  const head = new TextDecoder().decode(bytes.subarray(0, 4096))
  if (isEagleXml(head)) return 'eagle'
  const start = head.trimStart()
  if (start.startsWith('EESchema Schematic File Version')) return 'kicad-legacy-schematic'
  if (start.startsWith('PCBNEW-BOARD')) return 'kicad-legacy-board'
  if (start.startsWith('PCBNEW-LibModule-V1')) return 'kicad-legacy-footprints'
  if (start.startsWith('EESchema-LIBRARY')) return 'kicad-legacy-symbols'
  if (start.startsWith('EESchema-DOCLIB')) return 'kicad-legacy-docs'
  if (start.startsWith('(kicad_sch')) return 'kicad-schematic'
  if (start.startsWith('(kicad_pcb')) return 'kicad-board'
  if (start.startsWith('{') && /"docType"\s*:/.test(start) && /"editorVersion"\s*:/.test(start)) return 'easyeda'
  return null
}

export function delegatedFile(file: HurtFile, format: EdaFormat | null): HurtFile | null {
  const base = file.name.replace(/(\.kicad)?\.[^.]+$/i, '')
  if (format === 'kicad-schematic') return { ...file, kind: 'kicad', ext: 'kicad_sch', name: `${base}.kicad_sch` }
  if (format === 'kicad-board') return { ...file, kind: 'kicad', ext: 'kicad_pcb', name: `${base}.kicad_pcb` }
  if (format === 'easyeda') return { ...file, kind: 'easyeda', ext: 'json' }
  if (format === 'zip') return { ...file, kind: 'archive', ext: 'zip' }
  return null
}
