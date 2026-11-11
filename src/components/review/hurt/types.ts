export type FileKind =
  | 'model'
  | 'kicad'
  | 'easyeda'
  | 'eagle'
  | 'altium'
  | 'fritzing'
  | 'librepcb'
  | 'gerber'
  | 'dxf'
  | 'pdf'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'markdown'
  | 'table'
  | 'archive'
  | 'fusion'
  | 'cadsource'
  | 'html'
  | 'ibom'
  | 'text'
  | 'binary'
  | 'submodule'

export interface HurtFile {
  path: string
  name: string
  dir: string
  ext: string
  size: number
  kind: FileKind
  risky: boolean
}

export interface ReadOptions {
  signal?: AbortSignal
  onProgress?: (loaded: number, total: number) => void
}

export interface ConvertOptions {
  signal?: AbortSignal
  onStatus?: (message: string) => void
}

export interface FileSource {
  id: string
  label: string
  files: HurtFile[]
  byPath: Map<string, HurtFile>
  read(path: string, options?: ReadOptions): Promise<ArrayBuffer>
  head?(path: string, length: number, options?: ReadOptions): Promise<Uint8Array>
  rawUrl?(path: string): string
  resolveSizes?(): Promise<void>
  lfsSize?(path: string, signal?: AbortSignal): Promise<number | null>
  convert?(path: string, options?: ConvertOptions): Promise<ArrayBuffer>
  attachmentUrl?(path: string, id: string): string
  webUrl?(path: string): string
}

export interface SnapshotData {
  repo: string
  branch: string | null
  sha: string
  truncated: boolean
  files: { path: string; size: number; submodule?: boolean }[]
}

export interface ShipMark {
  id: string
  kind: string
  status: string
  submitted_at: string
  reviewed_at: string | null
}

export interface CommitData {
  sha: string
  message: string
  author: string | null
  date: string | null
}

export interface CompareFile {
  filename: string
  previous_filename: string | null
  status: string
  additions: number
  deletions: number
  patch: string | null
  patch_truncated: boolean
}

export interface CompareData {
  total_commits: number
  truncated: boolean
  files: CompareFile[]
}

export interface ViewerProps {
  file: HurtFile
  source: FileSource
  onOpen: (path: string, source?: FileSource) => void
}
