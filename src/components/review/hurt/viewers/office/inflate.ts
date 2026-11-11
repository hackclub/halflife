export async function inflateTo(data: Uint8Array, expected: number, format: CompressionFormat = 'deflate') {
  const out = new Uint8Array(expected)
  const stream = new DecompressionStream(format)
  const writer = stream.writable.getWriter()
  writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined)
  writer.close().catch(() => undefined)
  const reader = stream.readable.getReader()
  let filled = 0
  try {
    while (filled < expected) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, expected - filled)
      out.set(value.subarray(0, take), filled)
      filled += take
    }
  } catch (error) {
    if (filled === 0) throw error
  }
  reader.cancel().catch(() => undefined)
  return out
}
