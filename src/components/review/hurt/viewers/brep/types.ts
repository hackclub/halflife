export type Vec = [number, number, number]

export interface BSplineCurve {
  degree: number
  rational: boolean
  closed: boolean
  knots: number[]
  mults: number[]
  points: Float64Array
}

export interface BSplineSurface {
  uDegree: number
  vDegree: number
  rational: boolean
  uClosed: boolean
  vClosed: boolean
  uKnots: number[]
  uMults: number[]
  vKnots: number[]
  vMults: number[]
  uCount: number
  vCount: number
  points: Float64Array
}

export type Curve =
  | { type: 'line'; root: Vec; direction: Vec }
  | { type: 'ellipse'; center: Vec; normal: Vec; major: Vec; ratio: number }
  | { type: 'spline'; spline: BSplineCurve; forward: boolean }

export type Surface =
  | { type: 'plane'; root: Vec; normal: Vec; u: Vec }
  | { type: 'cone'; center: Vec; axis: Vec; major: Vec; ratio: number; sin: number; cos: number }
  | { type: 'sphere'; center: Vec; radius: number; u: Vec; pole: Vec }
  | { type: 'torus'; center: Vec; normal: Vec; major: number; minor: number; u: Vec }
  | { type: 'spline'; spline: BSplineSurface; forward: boolean }
  | { type: 'extrusion'; curve: Curve; direction: Vec }
  | { type: 'revolution'; curve: Curve; point: Vec; axis: Vec }

export interface Vertex {
  point: Vec
}

export interface Edge {
  start: Vertex
  end: Vertex
  curve: Curve | null
  forward: boolean
}

export interface Coedge {
  edge: Edge
  forward: boolean
  open: boolean
}

export interface Loop {
  coedges: Coedge[]
}

export interface Face {
  surface: Surface | null
  forward: boolean
  sheet: boolean
  loops: Loop[]
  appearance?: string
}

export interface Lump {
  shells: Face[][]
}

export interface Body {
  lumps: Lump[]
  transform: number[] | null
  attributed: boolean
}
