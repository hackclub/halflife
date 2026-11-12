export async function wireIndices({ indices, counts }: Record<string, unknown>) {
  const result = (indices as (Uint32Array | null)[]).map((index, i) => uniqueEdges(index, (counts as number[])[i]))
  return { result, transfer: result.map((lines) => lines.buffer as ArrayBuffer) }
}

function uniqueEdges(index: Uint32Array | null, vertices: number) {
  const corners = index ? index.length - (index.length % 3) : vertices - (vertices % 3)
  const at = (i: number) => (index ? index[i] : i)
  const start = new Uint32Array(vertices + 1)
  for (let i = 0; i < corners; i++) {
    const a = at(i)
    const b = at(i % 3 === 2 ? i - 2 : i + 1)
    start[Math.min(a, b) + 1]++
  }
  for (let v = 0; v < vertices; v++) start[v + 1] += start[v]
  const filled = start.slice(0, vertices)
  const others = new Uint32Array(corners)
  const lines = new (vertices < 65535 ? Uint16Array : Uint32Array)(corners * 2)
  let count = 0
  for (let i = 0; i < corners; i++) {
    const a = at(i)
    const b = at(i % 3 === 2 ? i - 2 : i + 1)
    const low = Math.min(a, b)
    const high = Math.max(a, b)
    let seen = false
    for (let j = start[low]; j < filled[low]; j++)
      if (others[j] === high) {
        seen = true
        break
      }
    if (seen) continue
    others[filled[low]++] = high
    lines[count++] = a
    lines[count++] = b
  }
  return lines.slice(0, count)
}
