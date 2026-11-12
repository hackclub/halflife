export interface MeasurePoint {
  x: number
  y: number
}

export function addMeasurePoint(current: MeasurePoint[], point: MeasurePoint) {
  return current.length >= 2 ? [point] : [...current, point]
}

export function MeasureMarks({ points, width, height }: { points: MeasurePoint[]; width: number; height: number }) {
  if (points.length === 0) return null
  return (
    <svg className="hurt-gerber__measure" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {points.length === 2 && (
        <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} vectorEffect="non-scaling-stroke" />
      )}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}

export function MeasureReadout({
  points,
  pxPerMm,
  subject,
}: {
  points: MeasurePoint[]
  pxPerMm: number
  subject: string
}) {
  const mm = (px: number) => (px / pxPerMm).toFixed(2)
  return (
    <div className="hurt-gerber__readout">
      {points.length === 2
        ? `${mm(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y))} mm · Δx ${mm(Math.abs(points[1].x - points[0].x))} · Δy ${mm(Math.abs(points[1].y - points[0].y))}`
        : points.length === 0
          ? `Click two points on the ${subject}`
          : 'Click a second point'}
    </div>
  )
}
