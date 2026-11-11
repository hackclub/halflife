import type { FileSource, HurtFile, ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { looksLikeText } from '../core/text'
import { detectEda, type LegacyEdaFormat } from '../core/eda'
import { plural } from '../core/format'
import { Gate } from '../ui/parts'
import TextViewer from './TextViewer'
import BinaryViewer from './BinaryViewer'

const MESSAGES: Record<LegacyEdaFormat, (count: number) => string> = {
  'eagle-binary': () =>
    "This file was saved by Eagle 5 or older in a binary format the viewer can't read. Eagle 6 and newer, and Fusion, can open it and save it as XML.",
  'kicad-legacy-schematic': (count) =>
    `This is a KiCad 4 or 5 schematic with ${plural(count, 'component')}. The viewer reads KiCad 6 and newer, so here is its source.`,
  'kicad-legacy-board': (count) =>
    `This is a KiCad 4 or 5 board with ${plural(count, 'footprint')}. The viewer reads KiCad 6 and newer, so here is its source.`,
  'kicad-legacy-footprints': (count) =>
    `This is a KiCad 4 or 5 footprint library with ${plural(count, 'footprint')}. The viewer can't draw it, so here is its source.`,
  'kicad-legacy-symbols': (count) =>
    `This is a KiCad 4 or 5 symbol library with ${plural(count, 'symbol')}. The viewer can't draw it, so here is its source.`,
  'kicad-legacy-docs': (count) =>
    `This is a KiCad 4 or 5 symbol documentation file with descriptions and keywords for ${plural(count, 'symbol')}. It has no drawings, so here is its source.`,
}

const COUNTED: Partial<Record<LegacyEdaFormat, RegExp>> = {
  'kicad-legacy-schematic': /^\$Comp\b/gm,
  'kicad-legacy-board': /^\$MODULE\b/gm,
  'kicad-legacy-footprints': /^\$MODULE\b/gm,
  'kicad-legacy-symbols': /^DEF\s/gm,
  'kicad-legacy-docs': /^\$CMP\s/gm,
}

const SIBLINGS: Partial<Record<LegacyEdaFormat, string[]>> = {
  'kicad-legacy-schematic': ['kicad_sch', 'kicad_pro', 'kicad_pcb'],
  'kicad-legacy-board': ['kicad_pcb', 'kicad_pro', 'kicad_sch'],
}

function isLegacy(format: string | null): format is LegacyEdaFormat {
  return format !== null && format in MESSAGES
}

function stem(name: string) {
  return name.replace(/\.[^.]+$/, '').toLowerCase()
}

function sibling(source: FileSource, file: HurtFile, format: LegacyEdaFormat) {
  const order = SIBLINGS[format] ?? []
  return source.files
    .filter((f) => f.dir === file.dir && order.includes(f.ext) && stem(f.name) === stem(file.name))
    .sort((a, b) => order.indexOf(a.ext) - order.indexOf(b.ext))[0]
}

export default function LegacyEdaViewer(props: ViewerProps) {
  const { file, source, onOpen } = props
  const state = useLoad(
    async ({ signal, progress }) => {
      const bytes = new Uint8Array(
        await source.read(file.path, { signal, onProgress: (l, t) => progress(t ? l / t : null, 'Downloading') }),
      )
      const format = detectEda(bytes, file.ext)
      if (!isLegacy(format)) return { format: null, count: 0, text: looksLikeText(bytes) }
      const pattern = COUNTED[format]
      const count = pattern
        ? (new TextDecoder().decode(bytes.subarray(0, 16 * 1024 * 1024)).match(pattern)?.length ?? 0)
        : 0
      return { format, count, text: format !== 'eagle-binary' }
    },
    [source.id, file.path],
  )

  return (
    <div className="hurt-legacy-eda">
      <Gate state={state}>
        {({ format, count, text }) => {
          const match = format && sibling(source, file, format)
          const Fallback = text ? TextViewer : BinaryViewer
          return (
            <>
              {format && (
                <p className="hurt-note hurt-legacy-eda__note">
                  <span>{MESSAGES[format](count)}</span>
                  {match && (
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => onOpen(match.path)}>
                      Open {match.name}
                    </button>
                  )}
                </p>
              )}
              <Fallback {...props} />
            </>
          )
        }}
      </Gate>
    </div>
  )
}
