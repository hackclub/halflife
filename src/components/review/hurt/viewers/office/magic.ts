export type LibarchiveFormat = 'rar' | '7z' | 'xz' | 'bzip2' | 'gzip'

function startsWith(bytes: Uint8Array, magic: number[]) {
  return bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b)
}

export function libarchiveFormat(bytes: Uint8Array): LibarchiveFormat | null {
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'rar'
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z'
  if (startsWith(bytes, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz'
  if (startsWith(bytes, [0x42, 0x5a, 0x68]) && bytes[3] >= 0x31 && bytes[3] <= 0x39) return 'bzip2'
  return null
}

export function isPsd(bytes: Uint8Array) {
  return startsWith(bytes, [0x38, 0x42, 0x50, 0x53])
}

export function isXcf(bytes: Uint8Array) {
  return startsWith(bytes, [0x67, 0x69, 0x6d, 0x70, 0x20, 0x78, 0x63, 0x66, 0x20])
}
