export type Side = 'F' | 'B'
export type Point = [number, number]

export interface Box {
  pos: Point
  relpos: Point
  size: Point
  angle: number
}

export function partAt(parts: { side: Side; bbox: Box }[], side: Side | null, x: number, y: number) {
  let best = -1
  let bestArea = Infinity
  parts.forEach((part, id) => {
    if (side && part.side !== side) return
    const { pos, relpos, size, angle } = part.bbox
    const a = (angle * Math.PI) / 180
    const dx = x - pos[0]
    const dy = y - pos[1]
    const lx = dx * Math.cos(a) - dy * Math.sin(a)
    const ly = dx * Math.sin(a) + dy * Math.cos(a)
    const area = size[0] * size[1]
    if (lx < relpos[0] || lx > relpos[0] + size[0] || ly < relpos[1] || ly > relpos[1] + size[1] || area >= bestArea)
      return
    bestArea = area
    best = id
  })
  return best
}

export interface Bounds {
  minx: number
  miny: number
  maxx: number
  maxy: number
}

export const f = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : 0)

export function circlePath(cx: number, cy: number, r: number) {
  const radius = Math.abs(r)
  return `M${f(cx - radius)} ${f(cy)}a${f(radius)} ${f(radius)} 0 1 0 ${f(2 * radius)} 0a${f(radius)} ${f(radius)} 0 1 0 ${f(-2 * radius)} 0Z`
}

export function emptyBounds(): Bounds {
  return { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity }
}

export function grow(into: Bounds, minx: number, miny: number, maxx = minx, maxy = miny) {
  into.minx = Math.min(into.minx, minx)
  into.miny = Math.min(into.miny, miny)
  into.maxx = Math.max(into.maxx, maxx)
  into.maxy = Math.max(into.maxy, maxy)
}
