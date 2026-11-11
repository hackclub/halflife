import { serveWorker } from '../../core/workers'
import { renderElement, renderProject } from './render'

serveWorker({
  project: async ({ files, root }, progress) => {
    progress('Reading the LibrePCB project')
    const decoder = new TextDecoder()
    const texts: Record<string, string> = {}
    for (const [path, bytes] of Object.entries(files as Record<string, ArrayBuffer>))
      texts[path] = decoder.decode(bytes)
    progress('Drawing')
    return { result: renderProject(texts, root as string) }
  },
  element: async ({ bytes }, progress) => {
    progress('Drawing')
    return { result: renderElement(new TextDecoder().decode(bytes as ArrayBuffer)) }
  },
})
