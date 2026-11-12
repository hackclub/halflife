export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be'
export type DecodedEncoding = TextEncoding | 'windows-1252' | 'gbk'

const UTF16_SAMPLE = 512

export function textEncoding(bytes: Uint8Array): TextEncoding {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  return utf16WithoutBom(bytes) ?? 'utf-8'
}

function utf16WithoutBom(bytes: Uint8Array): TextEncoding | null {
  const pairs = Math.min(bytes.length, UTF16_SAMPLE) >> 1
  if (pairs < 2) return null
  let le = 0
  let be = 0
  for (let i = 0; i < pairs; i++) {
    const a = bytes[i * 2]
    const b = bytes[i * 2 + 1]
    if (b === 0 && !isControl(a)) le++
    if (a === 0 && !isControl(b)) be++
  }
  if (le >= pairs * 0.9) return 'utf-16le'
  if (be >= pairs * 0.9) return 'utf-16be'
  return null
}

function isControl(c: number) {
  return c < 9 || (c > 13 && c < 32) || c === 127 || c === 0xfffd
}

export function decodeText(input: ArrayBuffer | Uint8Array): { encoding: DecodedEncoding; text: string } {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const encoding = textEncoding(bytes)
  if (encoding !== 'utf-8')
    return { encoding, text: new TextDecoder(encoding).decode(bytes.subarray(0, bytes.length & ~1)) }
  try {
    return { encoding, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true }) }
  } catch {
    const legacy = gbPairs(bytes) ? 'gbk' : 'windows-1252'
    return { encoding: legacy, text: new TextDecoder(legacy).decode(bytes) }
  }
}

function gbPairs(bytes: Uint8Array) {
  const inRange = (b: number | undefined) => b !== undefined && b >= 0xa1 && b <= 0xfe
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] < 0x80) continue
    if (!inRange(bytes[i]) || !inRange(bytes[i + 1])) return false
    i++
  }
  return true
}

const TEXT_SAMPLE = 8192
const CONTROL_RATIO = 0.02

function mostlyPrintable(length: number, code: (i: number) => number) {
  if (length === 0) return true
  let control = 0
  for (let i = 0; i < length; i++) {
    if (isControl(code(i))) control++
  }
  return control / length < CONTROL_RATIO
}

export function looksLikeText(bytes: Uint8Array) {
  const encoding = textEncoding(bytes)
  if (encoding === 'utf-8') {
    const sample = bytes.subarray(0, TEXT_SAMPLE)
    return mostlyPrintable(sample.length, (i) => sample[i])
  }
  const sample = new TextDecoder(encoding).decode(bytes.subarray(0, Math.min(bytes.length, TEXT_SAMPLE) & ~1))
  return mostlyPrintable(sample.length, (i) => sample.charCodeAt(i))
}
