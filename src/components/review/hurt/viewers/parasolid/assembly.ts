import { Matrix4 } from 'three'
import { attr, basename, xmlText } from '../cadsource/shared'
import { solidworksSections } from '../cadsource/solidworks'

const TREE = 'swXmlContents/COMPINSTANCETREE'
const PARASOLID_MILLIMETRES = 1000
const MAX_DEPTH = 16
const MAX_COMPONENTS = 5000
const MODEL = /<swModel\s([^<>]*?)(?:\/>|>([\s\S]*?)<\/swModel>)/g
const REFERENCE = /<swReference\s[^<>]*>/g
const ACTIVE_CONFIG = /<swConfiguration\s[^<>]*swMostRecentConfiguration="YES"[^<>]*>/

export interface SwComponent {
  name: string
  file: string
  config: number | null
  matrix: Matrix4
  hidden: boolean
  path: string[]
  virtual: boolean
}

interface SwModel {
  file: string
  config: number | null
  body: string
}

function transformOf(value: string | undefined) {
  const numbers = (value ?? '').trim().split(/\s+/).map(Number)
  const matrix = new Matrix4()
  if (numbers.length !== 16 || numbers.some((n) => !Number.isFinite(n))) return matrix
  matrix.fromArray(numbers)
  for (const i of [12, 13, 14]) matrix.elements[i] *= PARASOLID_MILLIMETRES
  return matrix
}

function configOf(value: string | undefined) {
  const id = Number(value)
  return value && Number.isInteger(id) ? id : null
}

export async function assemblyComponents(bytes: Uint8Array): Promise<SwComponent[]> {
  const section = await solidworksSections(bytes).read(TREE)
  if (!section) return []
  const xml = xmlText(section)
  const files = new Map<string, string>()
  for (const [tag] of xml.matchAll(/<swFile\s[^<>]*>/g)) files.set(attr(tag, 'id') ?? '', attr(tag, 'swPath') ?? '')
  const models = new Map<string, SwModel>()
  for (const [, head, body] of xml.matchAll(MODEL)) {
    const tag = ` ${head}`
    models.set(attr(tag, 'id') ?? '', {
      file: files.get(attr(tag, 'swFileRef') ?? '') ?? '',
      config: configOf(attr(tag, 'swConfigurationId')),
      body: body ?? '',
    })
  }
  const active = ACTIVE_CONFIG.exec(xml)?.[0]
  const rootId =
    (active && attr(active, 'swModelRef')) ?? [...models].find(([, model]) => REFERENCE.test(model.body))?.[0]
  const root = rootId ? models.get(rootId) : undefined
  if (!root) return []

  const out: SwComponent[] = []
  const walk = (model: SwModel, parent: Matrix4, path: string[], hidden: boolean, depth: number) => {
    for (const [tag] of model.body.matchAll(REFERENCE)) {
      if (out.length >= MAX_COMPONENTS) return
      if (attr(tag, 'swSuppressed') === 'YES') continue
      const child = models.get(attr(tag, 'swModelRef') ?? '')
      if (!child) continue
      const name = `${attr(tag, 'swName') ?? basename(child.file)}-${attr(tag, 'swReferenceNumber') ?? 1}`
      const matrix = parent.clone().multiply(transformOf(attr(tag, 'swTransform')))
      const isHidden = hidden || attr(tag, 'swHidden') === 'YES'
      if (child.body.includes('<swReference') && depth < MAX_DEPTH)
        walk(child, matrix, [...path, name], isHidden, depth + 1)
      else
        out.push({
          name,
          file: basename(child.file),
          config: child.config ?? configOf(attr(tag, 'swConfigurationId')),
          matrix,
          hidden: isHidden,
          path,
          virtual: attr(tag, 'swIsVirtualComponent') === 'YES',
        })
    }
  }
  walk(root, new Matrix4(), [], false, 0)
  return out
}
