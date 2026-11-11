import type { FileKind, HurtFile } from '../types'
import type { HurtIconName } from '../ui/HurtIcon'
import { isBomPage } from '../core/classify'

const ICONS: Record<FileKind, HurtIconName> = {
  model: 'cube',
  fusion: 'cube',
  cadsource: 'cube',
  html: 'code',
  ibom: 'table',
  kicad: 'chip',
  easyeda: 'chip',
  eagle: 'chip',
  altium: 'chip',
  fritzing: 'chip',
  librepcb: 'chip',
  gerber: 'layers',
  dxf: 'ruler',
  pdf: 'document',
  document: 'document',
  image: 'image',
  video: 'film',
  audio: 'music',
  markdown: 'book',
  table: 'table',
  archive: 'archive',
  text: 'code',
  binary: 'file',
  submodule: 'link',
}

export function kindIcon(file: HurtFile): HurtIconName {
  return file.risky ? 'warning' : ICONS[isBomPage(file) ? 'ibom' : file.kind]
}

const LABELS: Record<FileKind, string> = {
  model: '3D model',
  fusion: 'Fusion',
  cadsource: 'CAD source',
  html: 'Web page',
  ibom: 'Interactive BOM',
  kicad: 'KiCad',
  easyeda: 'EasyEDA',
  eagle: 'Eagle',
  altium: 'Altium',
  fritzing: 'Fritzing',
  librepcb: 'LibrePCB',
  gerber: 'Gerber',
  dxf: 'DXF drawing',
  pdf: 'PDF',
  document: 'Document',
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  markdown: 'Markdown',
  table: 'Table',
  archive: 'Archive',
  text: 'Text',
  binary: 'Binary',
  submodule: 'Submodule',
}

export function kindLabel(file: HurtFile) {
  return LABELS[isBomPage(file) ? 'ibom' : file.kind]
}
