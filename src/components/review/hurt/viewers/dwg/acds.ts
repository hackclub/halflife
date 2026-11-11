const SEGMENT_HEADER = 48
const ENTRY_HEADER = 20
const BLOB_HEADER = 32
const BLOB_REFERENCE = 0xbb106bb1
const BLOB_PAGES = 32
const MAX_BLOB = 512 * 1024 * 1024
const SAB_MAGIC = /^(ASM|ACIS) BinaryFile/
const latin1 = new TextDecoder('latin1')

export interface AsmRecord {
  handle: number
  sab: Uint8Array
}

export function asmRecords(store: Uint8Array): AsmRecord[] {
  const view = new DataView(store.buffer, store.byteOffset, store.byteLength)
  const u32 = (at: number) => view.getUint32(at, true)
  const u64 = (at: number) => Number(view.getBigUint64(at, true))
  const fits = (at: number, size: number) => at >= 0 && size >= 0 && at + size <= store.length
  if (!fits(0, 48)) return []
  const [index, count, dataIndex] = [u32(24), u32(32), u32(40)]
  const segment = (id: number) =>
    id < count && fits(index + SEGMENT_HEADER + id * 12, 12) ? u64(index + SEGMENT_HEADER + id * 12) : 0
  const blob = (at: number) => {
    if (!fits(at, BLOB_PAGES)) return null
    const [total, pages] = [u64(at), u32(at + 8)]
    if (total > MAX_BLOB || !fits(at + BLOB_PAGES, pages * 8)) return null
    const out = new Uint8Array(total)
    let filled = 0
    for (let p = 0, page = at + BLOB_PAGES; p < pages; p++, page += 8) {
      const start = segment(u32(page)) + SEGMENT_HEADER + BLOB_HEADER
      const size = Math.min(u32(page + 4), total - filled)
      if (!fits(start, size)) return null
      out.set(store.subarray(start, start + size), filled)
      filled += size
    }
    return out
  }
  const records: AsmRecord[] = []
  const table = segment(dataIndex)
  if (!table || !fits(table + SEGMENT_HEADER, 8)) return records
  const entries = u32(table + SEGMENT_HEADER)
  for (let i = 0, at = table + SEGMENT_HEADER + 8; i < entries && fits(at, 12); i++, at += 12) {
    const start = segment(u32(at))
    const header = start + SEGMENT_HEADER + u32(at + 4)
    if (!start || !fits(header, ENTRY_HEADER) || !fits(start, SEGMENT_HEADER)) continue
    const position = start + 16 * u32(start + 36) + u32(header + 16)
    if (!fits(position, 4)) continue
    const size = u32(position)
    const sab =
      size === BLOB_REFERENCE
        ? blob(position + 4)
        : fits(position + 4, size)
          ? store.subarray(position + 4, position + 4 + size)
          : null
    if (sab && SAB_MAGIC.test(latin1.decode(sab.subarray(0, 16)))) records.push({ handle: u64(header + 8), sab })
  }
  return records
}
