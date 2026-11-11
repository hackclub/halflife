const KICAD_MARKER = /var pcbdata = (JSON\.parse\(LZString\.decompressFromBase64\(|\{)/

export const EASYEDA_MARKER = 'window.files = '
export const SNIFF_BYTES = 256 * 1024

export function sniffBomHtml(head: string): 'kicad' | 'easyeda' | null {
  if (KICAD_MARKER.test(head)) return 'kicad'
  if (head.includes(EASYEDA_MARKER) && head.includes('bom_merge')) return 'easyeda'
  return null
}

export function isBomHtml(bytes: Uint8Array) {
  return sniffBomHtml(new TextDecoder('latin1').decode(bytes.subarray(0, SNIFF_BYTES))) !== null
}
