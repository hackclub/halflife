import { serveWorker } from '../../core/workers'
import { renderEagle } from './render'

serveWorker({
  render: async ({ bytes }, progress) => {
    progress('Reading the Eagle file')
    const text = new TextDecoder().decode(bytes as ArrayBuffer)
    progress('Drawing')
    return { result: renderEagle(text) }
  },
})
