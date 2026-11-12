import { isCfb, openCfb } from '../../core/cfb'
import { inventorInfo, isInventor } from './inventor'
import { DAMAGED, placeholderNote } from './shared'
import { isSwContainer, solidworksContainer, solidworksOle } from './solidworks'
import type { CadInfo } from './types'

async function extract(bytes: Uint8Array, ext: string) {
  if (isSwContainer(bytes)) return solidworksContainer(bytes, ext)
  if (isCfb(bytes)) {
    const cfb = openCfb(bytes)
    if (cfb.has('PreviewPNG') || cfb.has('Header2') || cfb.has('ISolidWorksInformation')) return solidworksOle(cfb, ext)
    if (isInventor(cfb)) return inventorInfo(cfb, ext)
    if (cfb.truncated || cfb.paths.length === 0) throw new Error(DAMAGED)
    throw new Error('This compound file is not a SolidWorks or Inventor document.')
  }
  throw new Error('This file is not a SolidWorks or Inventor document the browser can read.')
}

export async function extractCadInfo(bytes: Uint8Array, fileName: string): Promise<CadInfo> {
  const note = placeholderNote(fileName, bytes.length, bytes)
  if (note) throw new Error(note)
  try {
    return await extract(bytes, fileName.split('.').pop()?.toLowerCase() ?? '')
  } catch (error) {
    if (error instanceof RangeError) throw new Error(DAMAGED)
    throw error
  }
}
