import { serveWorker } from '../../core/workers'
import { decodeBomHtml } from './decode'
import { renderView } from './render'

async function read(payload: Record<string, unknown>, progress: (message: string) => void) {
  progress('Unpacking BOM data')
  const doc = decodeBomHtml(new TextDecoder().decode(payload.bytes as ArrayBuffer))
  progress('Drawing the board')
  return { result: renderView(doc) }
}

serveWorker({ read })
