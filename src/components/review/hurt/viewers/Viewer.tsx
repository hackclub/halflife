import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react'
import type { FileKind, FileSource, HurtFile, ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { looksLikeText } from '../core/text'
import { isZip } from '../core/archive'
import { readHead } from '../core/source'
import { formatBytes } from '../core/format'
import { delegatedFile, detectEda, EDA_EXTENSIONS } from '../core/eda'
import { isBomHtml, SNIFF_BYTES } from './ibom/sniff'
import { noteSniffedPage } from '../core/prefetch'
import { isPsd, isXcf, libarchiveFormat } from './office/magic'
import { Gate, Loading, LoadingSize } from '../ui/parts'
import ErrorBoundary from '../ui/ErrorBoundary'

const VIEWERS: Record<Exclude<FileKind, 'submodule'>, ComponentType<ViewerProps>> = {
  model: lazy(() => import('./model/ModelViewer')),
  kicad: lazy(() => import('./KiCadViewer')),
  easyeda: lazy(() => import('./easyeda/EasyEdaViewer')),
  eagle: lazy(() => import('./eagle/EagleViewer')),
  altium: lazy(() => import('./altium/AltiumViewer')),
  fritzing: lazy(() => import('./fritzing/FritzingViewer')),
  librepcb: lazy(() => import('./librepcb/LibrePcbViewer')),
  gerber: lazy(() => import('./gerber/GerberViewer')),
  dxf: lazy(() => import('./DxfViewer')),
  pdf: lazy(() => import('./PdfViewer')),
  document: lazy(() => import('./office/DocumentViewer')),
  image: lazy(() => import('./ImageViewer')),
  video: lazy(() => import('./MediaViewer')),
  audio: lazy(() => import('./MediaViewer')),
  markdown: lazy(() => import('./MarkdownViewer')),
  table: lazy(() => import('./TableViewer')),
  archive: lazy(() => import('./ArchiveViewer')),
  fusion: lazy(() => import('./FusionViewer')),
  cadsource: lazy(() => import('./cadsource/CadSourceViewer')),
  html: lazy(() => import('./ibom/HtmlViewer')),
  ibom: lazy(() => import('./ibom/IbomViewer')),
  text: lazy(() => import('./TextViewer')),
  binary: lazy(() => import('./BinaryViewer')),
}

const SNIFF_LIMIT = 8 * 1024 * 1024
const LFS_CONFIRM_BYTES = 50 * 1024 * 1024
const SNIFF_EXTENSIONS = new Set(['json', 'ai', 'obj', 'cmp'])
const CLOSED_FORMATS = new Set(['shapr', 'skp'])
const UNGATED_LFS = new Set(['step', 'stp'])

function needsSniff(file: HurtFile) {
  return (
    file.size > 0 &&
    (file.kind === 'text' ||
      file.kind === 'html' ||
      file.kind === 'eagle' ||
      SNIFF_EXTENSIONS.has(file.ext) ||
      (EDA_EXTENSIONS.has(file.ext) && file.size <= SNIFF_LIMIT) ||
      (file.kind === 'binary' && file.size <= SNIFF_LIMIT))
  )
}

function sniff(file: HurtFile, bytes: Uint8Array): HurtFile {
  if (file.kind === 'html') {
    const bom = isBomHtml(bytes)
    noteSniffedPage(file, bom)
    return bom ? { ...file, kind: 'ibom' } : file
  }
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 512))
  const as = (kind: FileKind, ext = file.ext) => ({ ...file, kind, ext })
  const text = looksLikeText(bytes) && !head.startsWith('!<arch>\n')
  if (EDA_EXTENSIONS.has(file.ext)) {
    const format = detectEda(bytes, file.ext)
    const moved = delegatedFile(file, format)
    if (moved) return moved
    if (format) return as('eagle')
    return text ? as('text') : as('binary')
  }
  if (file.ext === 'ai') return head.startsWith('%PDF') ? as('pdf') : as('binary')
  if (file.ext === 'cmp' && head.startsWith('Cmp-Mod')) return as('text')
  if (file.ext === 'json' && /"editorVersion"\s*:/.test(head) && /"docType"\s*:/.test(head)) return as('easyeda')
  if (text && file.kind !== 'binary') return file
  if (head.startsWith('ISO-10303-21')) return as('model', 'step')
  if (head.startsWith('BLENDER')) return as('model', 'blend')
  if (head.startsWith('%PDF')) return as('pdf')
  if (text && !CLOSED_FORMATS.has(file.ext)) return as('text')
  if (head.startsWith('MZ')) return { ...as('binary'), risky: true }
  const packed = libarchiveFormat(bytes)
  if (packed === 'rar' || packed === '7z') return as('archive', packed)
  if (isPsd(bytes)) return as('image', 'psd')
  if (isXcf(bytes)) return as('image', 'xcf')
  if (isZip(bytes) && !CLOSED_FORMATS.has(file.ext)) return as('archive', 'zip')
  if (bytes[0] === 0x89 && head.startsWith('PNG', 1)) return as('image', 'png')
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return as('image', 'jpg')
  return as('binary')
}

const confirmedLfs = new Set<string>()

function LargeLfsGate({ file, source, children }: { file: HurtFile; source: FileSource; children: ReactNode }) {
  const key = `${source.id}|${file.path}`
  const [, setConfirmed] = useState(0)
  const size = useLoad(
    async ({ signal }) =>
      confirmedLfs.has(key) || UNGATED_LFS.has(file.ext) ? null : ((await source.lfsSize?.(file.path, signal)) ?? null),
    [key],
  )
  return (
    <Gate state={size}>
      {(bytes) =>
        bytes === null || bytes <= LFS_CONFIRM_BYTES || confirmedLfs.has(key) ? (
          children
        ) : (
          <div className="hurt-state">
            <p>
              {file.name} is {formatBytes(bytes)}, stored in Git LFS. Opening it downloads the whole file, which can
              take a while and counts against the repository's LFS bandwidth.
            </p>
            <div className="hurt-state__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  confirmedLfs.add(key)
                  setConfirmed((n) => n + 1)
                }}
              >
                Download and open
              </button>
              {source.webUrl && (
                <a
                  className="btn btn--ghost btn--sm"
                  href={source.webUrl(file.path)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open on GitHub
                </a>
              )}
            </div>
          </div>
        )
      }
    </Gate>
  )
}

function Opened(props: ViewerProps) {
  const { file, source } = props
  const sniffed = useLoad(
    async ({ signal, progress }) =>
      needsSniff(file)
        ? sniff(
            file,
            await readHead(source, file.path, SNIFF_BYTES, {
              signal,
              onProgress: (loaded, total) => progress(total ? loaded / total : null, 'Downloading'),
            }),
          )
        : file,
    [source.id, file.path],
  )
  return (
    <LoadingSize.Provider value={file.size}>
      <Gate state={sniffed}>
        {(resolved) => {
          const View = VIEWERS[resolved.kind === 'submodule' ? 'binary' : resolved.kind]
          return (
            <Suspense fallback={<Loading message="Loading viewer" />}>
              <View {...props} file={resolved} />
            </Suspense>
          )
        }}
      </Gate>
    </LoadingSize.Provider>
  )
}

export default function Viewer(props: ViewerProps) {
  const { file, source } = props
  if (file.kind === 'submodule') {
    return (
      <div className="hurt-state">
        <p>
          {file.path} is a Git submodule: a link to another repository at a fixed commit. Its files aren't part of this
          repository.
        </p>
        {source.webUrl && (
          <a
            className="btn btn--ghost btn--sm"
            href={source.webUrl(file.path).replace('/blob/', '/tree/')}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on GitHub
          </a>
        )}
      </div>
    )
  }

  if (file.size === 0) {
    return (
      <div className="hurt-state">
        <p>This file is empty (0 bytes).</p>
      </div>
    )
  }

  return (
    <ErrorBoundary resetKey={`${source.id}|${file.path}`}>
      <LargeLfsGate file={file} source={source}>
        <Opened {...props} />
      </LargeLfsGate>
    </ErrorBoundary>
  )
}
