const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
const VALUES = new Map([...ALPHABET].map((char, i) => [char.charCodeAt(0), i]))
const OUTPUT_LIMIT = 64 * 1024 * 1024

export function decompressFromBase64(input: string): string | null {
  if (!input) return null
  const length = input.length
  let value = VALUES.get(input.charCodeAt(0)) ?? 0
  let position = 32
  let index = 1

  const read = (bits: number) => {
    let result = 0
    for (let power = 1; power !== 1 << bits; power <<= 1) {
      const bit = value & position
      position >>= 1
      if (position === 0) {
        position = 32
        value = index < length ? (VALUES.get(input.charCodeAt(index)) ?? 0) : 0
        index++
      }
      if (bit) result |= power
    }
    return result
  }

  const dictionary: string[] = ['', '', '']
  let enlargeIn = 4
  let numBits = 3
  let total = 0

  const first = read(2)
  if (first === 2) return ''
  if (first > 2) return null
  let w = String.fromCharCode(read(first === 0 ? 8 : 16))
  dictionary.push(w)
  const result = [w]

  for (;;) {
    if (index > length) return null
    let code = read(numBits)
    if (code === 2) return result.join('')
    if (code < 2) {
      dictionary.push(String.fromCharCode(read(code === 0 ? 8 : 16)))
      code = dictionary.length - 1
      if (--enlargeIn === 0) enlargeIn = 1 << numBits++
    }
    let entry: string
    if (code < dictionary.length && code > 2) entry = dictionary[code]
    else if (code === dictionary.length) entry = w + w.charAt(0)
    else return null
    total += entry.length
    if (total > OUTPUT_LIMIT) throw new Error('The BOM data is too large to unpack.')
    result.push(entry)
    dictionary.push(w + entry.charAt(0))
    w = entry
    if (--enlargeIn === 0) enlargeIn = 1 << numBits++
  }
}
