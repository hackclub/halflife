import { serveWorker, transferablesOf } from '../../core/workers'
import { extractCadInfo } from './extract'

serveWorker({
  extract: async (payload) => {
    const info = await extractCadInfo(new Uint8Array(payload.bytes as ArrayBuffer), payload.name as string)
    return { result: info, transfer: transferablesOf(info.previews) }
  },
})
