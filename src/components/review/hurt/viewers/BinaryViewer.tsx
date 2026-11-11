import { useEffect } from 'react'
import type { ViewerProps } from '../types'
import { useLoad } from '../core/useLoad'
import { formatBytes } from '../core/format'
import { readHead } from '../core/source'
import { Gate, Toolbar } from '../ui/parts'
import HurtIcon from '../ui/HurtIcon'
import { closedCadInfo, PREVIEW_BYTES } from './cadinfo'

const UF2_FAMILIES: Record<number, string> = {
  0xe48bff56: 'RP2040',
  0xe48bff59: 'RP2350',
  0xe48bff5a: 'RP2350 (RISC-V)',
  0xada52840: 'nRF52840',
  0x68ed2b88: 'SAMD21',
  0x55114460: 'SAMD51',
  0xbfdd4eee: 'ESP32-S2',
  0xc47e5767: 'ESP32-S3',
  0xd42ba06c: 'ESP32-C3',
  0x57755a57: 'STM32F4',
}

const EXTENSION_NAMES: Record<string, string> = {
  catpart: 'CATIA part',
  x_b: 'Parasolid binary',
  shapr: 'Shapr3D design (Parasolid inside)',
  plasticity: 'Plasticity design',
  skp: 'SketchUp model',
  eprj: 'EasyEDA Pro project database',
  pcbdoc: 'Altium PCB',
  schdoc: 'Altium schematic',
  xls: 'Excel 97 spreadsheet',
  rar: 'RAR archive',
  '7z': '7-Zip archive',
  uf2: 'UF2 firmware image',
  hex: 'Intel HEX firmware',
  bin: 'Raw binary',
  elf: 'ELF executable',
}

const COFF_MACHINES = new Set([0x14c, 0x8664, 0x1c0, 0x1c4, 0xaa64])
const XILINX_BIT = [0x00, 0x09, 0x0f, 0xf0, 0x0f, 0xf0, 0x0f, 0xf0, 0x0f, 0xf0, 0x00, 0x00, 0x01]

function bitstreamPart(head: Uint8Array, header: string) {
  if (XILINX_BIT.every((b, i) => head[i] === b)) {
    let offset = XILINX_BIT.length
    for (let field = 0; field < 4 && offset + 3 <= head.length; field++) {
      const key = String.fromCharCode(head[offset])
      const length = (head[offset + 1] << 8) | head[offset + 2]
      const value = header.slice(offset + 3, offset + 2 + length)
      if (key === 'b') return value.replace(/\0/g, '')
      offset += 3 + length
    }
    return ''
  }
  if (head[0] === 0xff && head[1] === 0x00) return header.match(/Part:\s*([\w-]+)/)?.[1] ?? null
  return null
}

function describeBytes(name: string, ext: string, head: Uint8Array) {
  const ascii = new TextDecoder('latin1').decode(head.subarray(0, 16))
  const u32 = (offset: number) => new DataView(head.buffer, head.byteOffset).getUint32(offset, true)
  if (head.length >= 32 && u32(0) === 0x0a324655 && u32(4) === 0x9e5d5157) {
    const family = u32(8) & 0x2000 ? u32(28) : 0
    return `UF2 firmware image${family ? ` for ${UF2_FAMILIES[family] ?? `family 0x${family.toString(16)}`}` : ''}`
  }
  if (ascii.startsWith('MZ')) return 'Windows program (EXE or DLL)'
  if (ascii.startsWith('!<arch>\n')) return 'Static library (ar archive)'
  if (ascii.startsWith('MThd')) return 'MIDI file'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'AVI ') return 'AVI video'
  const header = new TextDecoder('latin1').decode(head.subarray(0, 512))
  if (ascii.startsWith('\x93NUMPY')) {
    const shape = header
      .match(/'shape':\s*\(([^)]*)\)/)?.[1]
      .replace(/,\s*$/, '')
      .replace(/,\s*/g, ' × ')
    return `NumPy array${shape ? ` (${shape})` : ''}`
  }
  const creo = header.match(/^#UGC:2 (PART|ASSEMBLY|DRAWING)/)?.[1]
  if (creo) return `Creo ${creo.toLowerCase()}`
  const part = bitstreamPart(head, header)
  if (part !== null) return `FPGA bitstream${part ? ` for ${part}` : ''}`
  if (ext === 'obj' && COFF_MACHINES.has(head[0] | (head[1] << 8))) return 'Compiled object file (COFF)'
  if (ascii.startsWith('\x7fELF')) return 'Compiled ELF binary'
  if (ascii.startsWith('SQLite format 3'))
    return ext === 'eprj' ? 'EasyEDA Pro project database (SQLite)' : 'SQLite database'
  if (ascii.startsWith('Rar!')) return 'RAR archive'
  if (ascii.startsWith('7z\xbc\xaf')) return '7-Zip archive'
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0)
    return `${EXTENSION_NAMES[ext] ?? 'Microsoft compound document'} (OLE)`
  return EXTENSION_NAMES[ext] ?? `${ext ? `.${ext}` : name} file`
}

function hexDump(bytes: Uint8Array) {
  const lines: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.subarray(offset, offset + 16)
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0')).join(' ')
    const text = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${text}`)
  }
  return lines.join('\n')
}

const INSPECT_BYTES = 4096
const INSPECT_LIMIT = 8 * 1024 * 1024
const CLOSED_CAD = new Set(['skp'])

export default function BinaryViewer({ file, source }: ViewerProps) {
  const state = useLoad(
    async ({ signal }) => {
      if (!source.head && file.size > INSPECT_LIMIT)
        return {
          description: describeBytes(file.name, file.ext, new Uint8Array(0)),
          dump: null,
          size: file.size,
          preview: null,
          damaged: null,
        }
      const bytes = await readHead(source, file.path, CLOSED_CAD.has(file.ext) ? PREVIEW_BYTES : INSPECT_BYTES, {
        signal,
      })
      const cad = closedCadInfo(file.ext, bytes)
      return {
        description: cad?.description ?? describeBytes(file.name, file.ext, bytes),
        dump: cad?.preview ? null : hexDump(bytes.subarray(0, 1024)),
        size: Math.max(file.size, bytes.byteLength),
        preview: cad?.preview ? URL.createObjectURL(cad.preview) : null,
        damaged: cad?.damaged ?? null,
      }
    },
    [source.id, file.path],
  )

  useEffect(() => {
    if (state.status !== 'ready' || !state.value.preview) return
    const url = state.value.preview
    return () => URL.revokeObjectURL(url)
  }, [state])
  return (
    <div className="hurt-binary">
      <Toolbar title={file.name} meta={formatBytes(file.size)} />
      <Gate state={state}>
        {({ description, dump, size, preview, damaged }) => (
          <div className="hurt-binary__body">
            {file.risky && (
              <p className="hurt-warning">
                <HurtIcon name="warning" /> This is a program or script. Hardware projects rarely need one; don't run
                it.
              </p>
            )}
            {damaged && (
              <p className="hurt-warning">
                <HurtIcon name="warning" /> {damaged}
              </p>
            )}
            <p className="hurt-note">
              <strong>{description}</strong>.{' '}
              {preview
                ? "The browser can't open this format; this is the preview image saved inside the file."
                : `The browser can't preview this format${dump ? ', so here are its first bytes' : ''}.`}
            </p>
            {preview && <img className="hurt-binary__preview" src={preview} alt={`Preview of ${file.name}`} />}
            {dump && <pre className="hurt-binary__hex">{dump}</pre>}
            {dump && size > 1024 && <p className="hurt-text__note">First 1 KB of {formatBytes(size)}.</p>}
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
        )}
      </Gate>
    </div>
  )
}
