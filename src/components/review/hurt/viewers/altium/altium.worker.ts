import { serveWorker } from '../../core/workers'
import { readPcbDoc } from './pcb'
import { buildSchematic } from './schematic'

serveWorker({
  parse: async (payload, progress) => {
    const bytes = new Uint8Array(payload.bytes as ArrayBuffer)
    const name = String(payload.name)
    progress(payload.schematic ? 'Drawing the schematic' : 'Reading the board')
    try {
      return { result: payload.schematic ? buildSchematic(bytes, name) : readPcbDoc(bytes) }
    } catch (error) {
      if (error instanceof Error && error.constructor === Error) throw error
      throw new Error('This Altium file is damaged or uses a layout the viewer does not know.')
    }
  },
})
