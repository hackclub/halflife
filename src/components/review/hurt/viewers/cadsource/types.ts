export interface CadPreview {
  label: string
  mime: string
  bytes: Uint8Array
}

export interface CadReference {
  name: string
  embedded: boolean
  library?: boolean
  importedFrom?: string
}

export interface CadProperty {
  name: string
  value: string
  config?: string
}

export interface CadFeature {
  name: string
  dimensions: string[]
}

export interface CadInfo {
  family: 'SolidWorks' | 'Inventor'
  docType: string
  container: string
  savedWith: string | null
  title: string | null
  author: string | null
  lastSavedBy: string | null
  created: string | null
  modified: string | null
  partNumber: string | null
  description: string | null
  material: string | null
  configurations: string[]
  properties: CadProperty[]
  mass: { kg: number | null; m3: number | null; m2: number | null } | null
  lengthUnit: string | null
  features: CadFeature[]
  references: CadReference[] | null
  instances: number | null
  previews: CadPreview[]
}

export function emptyInfo(family: CadInfo['family'], docType: string, container: string): CadInfo {
  return {
    family,
    docType,
    container,
    savedWith: null,
    title: null,
    author: null,
    lastSavedBy: null,
    created: null,
    modified: null,
    partNumber: null,
    description: null,
    material: null,
    configurations: [],
    properties: [],
    mass: null,
    lengthUnit: null,
    features: [],
    references: null,
    instances: null,
    previews: [],
  }
}
