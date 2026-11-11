import { resolvePath } from '../../core/source'

export interface AltiumProject {
  documents: { name: string; path: string }[]
}

const MAX_LINES = 200_000

export function parseProject(text: string, dir: string): AltiumProject {
  const project: AltiumProject = { documents: [] }
  let section = ''
  let pending: Record<string, string> = {}
  const flush = () => {
    if (/^Document\d+$/i.test(section) && pending.DocumentPath)
      project.documents.push({ name: pending.DocumentPath, path: resolvePath(dir, pending.DocumentPath) })
    pending = {}
  }
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/, MAX_LINES)) {
    const line = raw.trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      flush()
      section = header[1]
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0) pending[line.slice(0, eq)] = line.slice(eq + 1)
  }
  flush()
  return project
}
