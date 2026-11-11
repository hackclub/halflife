import type { HurtFile } from '../../types'

export const OCCT_LIMIT = 100e6
const SERVER_LIMIT = 300 * 1024 * 1024
const OCCT_EXTS = new Set(['step', 'stp', 'iges', 'igs', 'brep', 'brp'])

export function convertsOnServer(file: HurtFile) {
  return OCCT_EXTS.has(file.ext) && file.size > OCCT_LIMIT && file.size <= SERVER_LIMIT
}
