import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh'
// Half Life: Next bundles a worker only when it sees `new Worker(new URL(...))` written out, so this is a factory rather than Vite's `?worker&url` import.
const modelWorker = (name: string) => new Worker(new URL('./model.worker.ts', import.meta.url), { name, type: 'module' })
import { WorkerClient } from '../../core/workers'
import { DEFAULT_COLOR, EDGE_ARC, EDGE_CIRCLE, type ModelData, type ModelPart } from './analyze'
import { faceOfTriangle } from './measure'

export interface PartView {
  id: number
  part: ModelPart
  mesh: THREE.Mesh
  edges: THREE.LineSegments | null
  wire: THREE.LineSegments | null
  base: THREE.Material
  center: THREE.Vector3
  tool?: boolean
}

export interface Hit {
  view: PartView
  point: THREE.Vector3
  triangle: number
}

export interface Snap {
  type: 'vertex' | 'center' | 'edge' | 'face'
  view: PartView
  point: THREE.Vector3
  chain: number
  face: number
}

export interface SectionState {
  enabled: boolean
  axis: 0 | 1 | 2
  position: number
  flip: boolean
}

export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'

type SharedGeometry = Map<Float32Array, { geometry: THREE.BufferGeometry; edges: THREE.BufferGeometry | null }>

interface Label {
  element: HTMLElement
  point: THREE.Vector3
}

const BACKGROUND = 0x071d1a
const EDGE_COLOR = 0x0a2b26
const SELECT_EMISSIVE = 0x33d6a6
const TOOL_OPACITY = 0.35
const HOVER_EMISSIVE = 0x2a6158
const CAP_COLOR = 0xcf8a94
const SNAP_PX = 12
const SOLID_HIDDEN_LAYER = 1

export class ModelScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly root = new THREE.Group()
  readonly views: PartView[] = []
  readonly bounds = new THREE.Box3()
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  controls: OrbitControls
  upAxis: 'y' | 'z' = 'z'
  hidden = new Set<number>()
  selected = new Set<number>()
  hovered: number | null = null
  xray = false
  wireframe = false
  edgesVisible = true
  onClick: ((hit: Hit | null, event: PointerEvent) => void) | null = null
  onDoubleClick: ((hit: Hit | null) => void) | null = null
  onHover: ((hit: Hit | null, event: PointerEvent) => void) | null = null

  readonly #container: HTMLElement
  readonly #overlay: HTMLElement
  readonly #raycaster = new THREE.Raycaster()
  readonly #perspective: THREE.PerspectiveCamera
  readonly #orthographic: THREE.OrthographicCamera
  readonly #light = new THREE.DirectionalLight(0xffffff, 1.6)
  readonly #clipping: THREE.Plane[] = []
  readonly #plane = new THREE.Plane()
  readonly #capUniform = { value: 0 }
  readonly #capColor = { value: new THREE.Color(CAP_COLOR) }
  readonly #derived = new Map<THREE.Material, Partial<Record<'select' | 'hover' | 'ghost' | 'tool', THREE.Material>>>()
  readonly #materials = new Map<string, THREE.Material>()
  readonly #edgeMaterial: THREE.LineBasicMaterial
  readonly #measureMaterial = new THREE.LineBasicMaterial({ color: 0xf1c40f, depthTest: false, transparent: true })
  readonly #overlayGroup = new THREE.Group()
  readonly #labels: Label[] = []
  readonly #resize: ResizeObserver
  readonly #wireWorker = new WorkerClient(modelWorker, 'wireframe builder')
  #wires: Promise<void> | null = null
  #wireFallback = false
  #generation = 0
  #grid: THREE.Object3D | null = null
  #sectionOutline: THREE.LineLoop | null = null
  #snapMarker: THREE.Mesh
  #frame = 0
  #explode = 0
  #pointerDown: { x: number; y: number } | null = null
  #hoverFrame = 0
  #disposed = false

  constructor(container: HTMLElement, overlay: HTMLElement) {
    this.#container = container
    this.#overlay = overlay
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.localClippingEnabled = true
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.#raycaster.layers.enableAll()
    container.appendChild(this.renderer.domElement)

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.55
    pmrem.dispose()
    this.scene.background = new THREE.Color(BACKGROUND)
    this.scene.add(this.root, this.#overlayGroup)

    this.#perspective = new THREE.PerspectiveCamera(35, 1, 0.01, 1000)
    this.#orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000)
    this.camera = this.#perspective
    this.camera.add(this.#light)
    this.#light.position.set(0.3, 0.6, 1)
    this.scene.add(this.#perspective, this.#orthographic)

    this.controls = this.#makeControls(this.camera)
    this.#edgeMaterial = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: 0.7,
      clippingPlanes: this.#clipping,
    })
    this.#snapMarker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xedf7f6, depthTest: false, transparent: true }),
    )
    this.#snapMarker.renderOrder = 10
    this.#snapMarker.visible = false
    this.#overlayGroup.add(this.#snapMarker)

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', this.#handleDown)
    canvas.addEventListener('pointerup', this.#handleUp)
    canvas.addEventListener('pointermove', this.#handleMove)
    canvas.addEventListener('pointerleave', this.#handleLeave)
    canvas.addEventListener('dblclick', this.#handleDoubleClick)
    this.#resize = new ResizeObserver(() => this.resize())
    this.#resize.observe(container)
    this.resize()
  }

  load(model: ModelData, materials?: (THREE.Material | null)[]) {
    this.clear()
    this.upAxis = model.upAxis
    const shared: SharedGeometry = new Map()
    model.parts.forEach((part, id) =>
      this.#addView(
        part,
        id,
        materials?.[id] ? this.#adopt(materials[id]!) : this.#material(part.color, !!part.colors),
        shared,
      ),
    )
    this.bounds.setFromObject(this.root)
    this.setUp(model.upAxis)
    if (this.wireframe) this.setWireframe(true)
  }

  append(parts: ModelPart[], tools: number[] = []) {
    const first = this.views.length
    const shared: SharedGeometry = new Map()
    parts.forEach((part, i) => this.#addView(part, first + i, this.#material(part.color, !!part.colors), shared))
    for (const i of tools) {
      const view = this.views[first + i]
      view.tool = true
      view.mesh.raycast = () => {}
    }
    this.hidden = new Set([...this.hidden, ...parts.map((_, i) => first + i)])
    if (this.#wires) this.#wires = this.#wires.then(() => this.#buildWires())
    this.setExplode(this.#explode)
    this.#restyle()
    return first
  }

  #addView(part: ModelPart, id: number, base: THREE.Material, shared: SharedGeometry) {
    let geometries = shared.get(part.position)
    if (!geometries) {
      geometries = { geometry: partGeometry(part), edges: part.edges.points.length > 0 ? edgeGeometry(part) : null }
      shared.set(part.position, geometries)
    }
    const mesh = new THREE.Mesh(geometries.geometry, base)
    mesh.name = part.name
    mesh.raycast = acceleratedRaycast
    mesh.userData.part = id
    if (part.matrix) {
      mesh.matrixAutoUpdate = false
      mesh.matrix.fromArray(part.matrix)
      mesh.matrixWorldNeedsUpdate = true
    }
    const edges = geometries.edges ? this.#edgeLines(geometries.edges) : null
    if (edges) mesh.add(edges)
    this.root.add(mesh)
    const center = new THREE.Vector3(
      (part.bounds[0] + part.bounds[3]) / 2,
      (part.bounds[1] + part.bounds[4]) / 2,
      (part.bounds[2] + part.bounds[5]) / 2,
    )
    this.views.push({ id, part, mesh, edges, wire: null, base, center })
  }

  clear() {
    for (const view of this.views) {
      view.mesh.geometry.dispose()
      view.edges?.geometry.dispose()
      view.wire?.geometry.dispose()
      const tree = view.mesh.geometry.boundsTree as MeshBVH | undefined
      if (tree) view.mesh.geometry.boundsTree = undefined
    }
    this.root.clear()
    this.views.length = 0
    this.#wires = null
    this.#generation++
    this.hidden.clear()
    this.selected.clear()
    this.hovered = null
    this.setMeasurements([])
  }

  dispose() {
    this.#disposed = true
    cancelAnimationFrame(this.#frame)
    cancelAnimationFrame(this.#hoverFrame)
    this.#resize.disconnect()
    this.#wireWorker.restart()
    this.clear()
    this.#releaseSharedTextures()
    for (const material of this.#materials.values()) material.dispose()
    for (const set of this.#derived.values()) Object.values(set).forEach((m) => m?.dispose())
    this.#edgeMaterial.dispose()
    this.#measureMaterial.dispose()
    ;(this.#grid as THREE.GridHelper | null)?.dispose()
    this.scene.environment?.dispose()
    this.controls.dispose()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointerdown', this.#handleDown)
    canvas.removeEventListener('pointerup', this.#handleUp)
    canvas.removeEventListener('pointermove', this.#handleMove)
    canvas.removeEventListener('pointerleave', this.#handleLeave)
    canvas.removeEventListener('dblclick', this.#handleDoubleClick)
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    canvas.remove()
  }

  render = () => {
    if (this.#frame || this.#disposed) return
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0
      this.renderer.render(this.scene, this.camera)
      this.#placeLabels()
    })
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.#container
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.#perspective.aspect = width / height
    this.#perspective.updateProjectionMatrix()
    this.#syncOrthographic()
    this.render()
  }

  get modelSize() {
    return Math.max(this.bounds.getSize(new THREE.Vector3()).length(), 1e-6)
  }

  fit(ids?: number[]) {
    const box = new THREE.Box3()
    for (const view of this.views) {
      if (this.hidden.has(view.id) || (ids && !ids.includes(view.id))) continue
      box.expandByObject(view.mesh)
    }
    if (box.isEmpty()) box.copy(this.bounds)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-6)
    const direction = this.camera.position.clone().sub(this.controls.target).normalize()
    if (direction.lengthSq() < 0.5) direction.copy(this.#viewDirection('iso'))
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.#perspective.fov / 2))
    this.#place(center, direction, distance, radius)
  }

  setView(view: ViewName) {
    const center = this.controls.target.clone()
    const distance = Math.max(this.camera.position.distanceTo(center), this.modelSize)
    this.#place(center, this.#viewDirection(view), distance, this.modelSize / 2)
    this.fit()
  }

  setUp(axis: 'y' | 'z') {
    this.upAxis = axis
    const up = axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
    this.#perspective.up.copy(up)
    this.#orthographic.up.copy(up)
    this.controls.dispose()
    this.controls = this.#makeControls(this.camera, this.controls.target)
    this.#updateGrid()
    this.setView('iso')
  }

  setOrthographic(orthographic: boolean) {
    const next = orthographic ? this.#orthographic : this.#perspective
    if (next === this.camera) return
    next.position.copy(this.camera.position)
    next.quaternion.copy(this.camera.quaternion)
    const target = this.controls.target.clone()
    this.camera.remove(this.#light)
    this.camera = next
    this.camera.add(this.#light)
    this.controls.dispose()
    this.controls = this.#makeControls(next, target)
    this.#syncOrthographic()
    this.render()
  }

  setHidden(hidden: Set<number>) {
    this.hidden = hidden
    this.#restyle()
  }

  setSelected(selected: Set<number>) {
    this.selected = selected
    this.#restyle()
  }

  setHovered(id: number | null) {
    if (this.hovered === id) return
    this.hovered = id
    this.#restyle()
  }

  setXray(on: boolean) {
    this.xray = on
    this.#restyle()
  }

  setWireframe(on: boolean) {
    this.wireframe = on
    if (on && !this.#wireFallback) this.#wires ??= this.#buildWires()
    this.#applyWireframe()
  }

  setEdges(on: boolean) {
    this.edgesVisible = on
    for (const view of this.views) if (view.edges) view.edges.visible = on
    this.render()
  }

  setGrid(on: boolean) {
    if (this.#grid) this.#grid.visible = on
    this.render()
  }

  setExplode(amount: number) {
    const changed = amount !== this.#explode
    this.#explode = amount
    const center = this.bounds.getCenter(new THREE.Vector3())
    for (const view of this.views) {
      const { mesh, part } = view
      mesh.position
        .copy(view.center)
        .sub(center)
        .multiplyScalar(amount * 1.5)
      if (part.matrix) mesh.matrix.makeTranslation(mesh.position).multiply(new THREE.Matrix4().fromArray(part.matrix))
      mesh.updateMatrixWorld(true)
    }
    if (changed) this.fit()
    else this.render()
  }

  get explode() {
    return this.#explode
  }

  setSection(section: SectionState) {
    const wasOn = this.#clipping.length > 0
    if (section.enabled) {
      const min = this.bounds.min.getComponent(section.axis)
      const max = this.bounds.max.getComponent(section.axis)
      const normal = new THREE.Vector3().setComponent(section.axis, section.flip ? 1 : -1)
      const at = min + (max - min) * section.position
      this.#plane.set(normal, section.flip ? -at : at)
      if (!wasOn) this.#clipping.push(this.#plane)
    } else {
      this.#clipping.length = 0
    }
    this.#capUniform.value = section.enabled ? 1 : 0
    if (wasOn !== section.enabled) for (const material of this.#allMaterials()) material.needsUpdate = true
    this.#edgeMaterial.needsUpdate = true
    this.#updateSectionOutline(section)
    this.render()
  }

  pick(clientX: number, clientY: number): Hit | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.#raycaster.setFromCamera(ndc, this.camera)
    const clipped = this.#clipping.length > 0
    let best: Hit | null = null
    let bestDistance = Infinity
    const sphere = new THREE.Sphere()
    for (const view of this.views) {
      if (this.hidden.has(view.id)) continue
      const geometry = view.mesh.geometry
      sphere.copy(geometry.boundingSphere!).applyMatrix4(view.mesh.matrixWorld)
      if (!this.#raycaster.ray.intersectsSphere(sphere)) continue
      geometry.boundsTree ??= new MeshBVH(geometry, { indirect: true })
      ;(this.#raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = !clipped
      const hits = this.#raycaster.intersectObject(view.mesh, false)
      for (const hit of hits) {
        if (clipped && this.#plane.distanceToPoint(hit.point) < 0) continue
        if (hit.distance < bestDistance) {
          bestDistance = hit.distance
          best = { view, point: hit.point.clone(), triangle: hit.faceIndex ?? -1 }
        }
        break
      }
    }
    return best
  }

  snap(hit: Hit, clientX: number, clientY: number): Snap {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const cursor = new THREE.Vector2(clientX - rect.left, clientY - rect.top)
    const { part, mesh } = hit.view
    const matrix = mesh.matrixWorld
    const world = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(matrix)
    const screen = (x: number, y: number, z: number) => {
      const p = world(x, y, z).project(this.camera)
      return new THREE.Vector2(((p.x + 1) / 2) * rect.width, ((1 - p.y) / 2) * rect.height)
    }
    const face = faceOfTriangle(part, hit.triangle)
    let best: Snap = { type: 'face', view: hit.view, point: hit.point, chain: -1, face }
    let bestDistance = SNAP_PX

    const { corners, circles, kinds, points, offsets } = part.edges
    for (let i = 0; i < corners.length; i += 3) {
      const d = screen(corners[i], corners[i + 1], corners[i + 2]).distanceTo(cursor)
      if (d < bestDistance) {
        bestDistance = d
        best = {
          type: 'vertex',
          view: hit.view,
          point: world(corners[i], corners[i + 1], corners[i + 2]),
          chain: -1,
          face,
        }
      }
    }
    for (let c = 0; c < kinds.length; c++) {
      if (kinds[c] !== EDGE_CIRCLE && kinds[c] !== EDGE_ARC) continue
      const d = screen(circles[c * 7], circles[c * 7 + 1], circles[c * 7 + 2]).distanceTo(cursor)
      if (d < bestDistance) {
        bestDistance = d
        best = {
          type: 'center',
          view: hit.view,
          point: world(circles[c * 7], circles[c * 7 + 1], circles[c * 7 + 2]),
          chain: c,
          face,
        }
      }
    }
    if (best.type !== 'face') return best

    const worldPerPixel = this.#worldPerPixel(hit.point, rect.height)
    const reach = (worldPerPixel * SNAP_PX) / matrix.getMaxScaleOnAxis()
    const local = hit.point.clone().applyMatrix4(matrix.clone().invert())
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const closest = new THREE.Vector3()
    const segment = new THREE.Line3()
    let edgeDistance = reach
    for (let c = 0; c < kinds.length; c++) {
      for (let i = offsets[c]; i < offsets[c + 1] - 1; i++) {
        a.fromArray(points, i * 3)
        b.fromArray(points, i * 3 + 3)
        segment.set(a, b).closestPointToPoint(local, true, closest)
        const d = closest.distanceTo(local)
        if (d < edgeDistance) {
          edgeDistance = d
          best = { type: 'edge', view: hit.view, point: closest.clone().applyMatrix4(matrix), chain: c, face }
        }
      }
    }
    return best
  }

  showSnap(snap: Snap | null) {
    if (!snap) {
      if (this.#snapMarker.visible) {
        this.#snapMarker.visible = false
        this.render()
      }
      return
    }
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.#snapMarker.visible = true
    this.#snapMarker.position.copy(snap.point)
    this.#snapMarker.scale.setScalar(this.#worldPerPixel(snap.point, rect.height) * (snap.type === 'face' ? 3 : 5))
    ;(this.#snapMarker.material as THREE.MeshBasicMaterial).color.set(
      snap.type === 'face' ? 0x949e9d : snap.type === 'edge' ? 0xf1c40f : 0x33d6a6,
    )
    this.render()
  }

  setMeasurements(items: { anchors: THREE.Vector3[]; label: string; path?: THREE.Vector3[] }[]) {
    for (const child of [...this.#overlayGroup.children]) {
      if (child === this.#snapMarker) continue
      this.#overlayGroup.remove(child)
      ;(child as THREE.Line).geometry?.dispose()
    }
    for (const label of this.#labels) label.element.remove()
    this.#labels.length = 0
    for (const item of items) {
      const path = item.path ?? item.anchors
      if (path.length > 1) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), this.#measureMaterial)
        line.renderOrder = 9
        this.#overlayGroup.add(line)
      }
      const element = document.createElement('div')
      element.className = 'hurt-measure__label'
      element.textContent = item.label
      this.#overlay.appendChild(element)
      const point =
        item.anchors.length > 1 ? item.anchors[0].clone().add(item.anchors[1]).multiplyScalar(0.5) : item.anchors[0]
      this.#labels.push({ element, point })
    }
    this.render()
  }

  #releaseSharedTextures() {
    for (const material of this.#allMaterials()) {
      const uniforms = (this.renderer.properties.get(material) as { uniforms?: Record<string, { value: unknown }> })
        .uniforms
      const lut = uniforms?.dfgLUT?.value
      if (lut instanceof THREE.Texture) return lut.dispose()
    }
  }

  #makeControls(camera: THREE.Camera, target?: THREE.Vector3) {
    const controls = new OrbitControls(camera, this.renderer.domElement)
    controls.enableDamping = false
    controls.zoomToCursor = true
    controls.screenSpacePanning = true
    if (target) controls.target.copy(target)
    controls.addEventListener('change', this.render)
    controls.update()
    return controls
  }

  #place(center: THREE.Vector3, direction: THREE.Vector3, distance: number, radius: number) {
    this.controls.target.copy(center)
    for (const camera of [this.#perspective, this.#orthographic]) {
      camera.position.copy(center).addScaledVector(direction, distance)
      camera.near = Math.max(distance / 1000, 1e-4)
      camera.far = distance + radius * 50
      camera.lookAt(center)
      camera.updateProjectionMatrix()
    }
    this.#orthographic.zoom = 1
    this.#syncOrthographic(radius)
    this.controls.update()
    this.render()
  }

  #syncOrthographic(radius?: number) {
    const camera = this.#orthographic
    const aspect = this.#perspective.aspect || 1
    const half = radius ?? (camera.top - camera.bottom) / 2
    camera.left = -half * aspect
    camera.right = half * aspect
    camera.top = half
    camera.bottom = -half
    camera.near = -this.modelSize * 50
    camera.far = this.modelSize * 50
    camera.updateProjectionMatrix()
  }

  #viewDirection(view: ViewName) {
    const z = this.upAxis === 'z'
    const v = (x: number, y: number, depth: number) =>
      z ? new THREE.Vector3(x, -depth, y) : new THREE.Vector3(x, y, depth)
    const directions: Record<ViewName, THREE.Vector3> = {
      front: v(0, 0, 1),
      back: v(0, 0, -1),
      left: v(-1, 0, 0),
      right: v(1, 0, 0),
      top: v(0, 1, 0.0001),
      bottom: v(0, -1, 0.0001),
      iso: v(1, 0.8, 1),
    }
    return directions[view].normalize()
  }

  #worldPerPixel(point: THREE.Vector3, height: number) {
    if (this.camera instanceof THREE.OrthographicCamera)
      return (this.camera.top - this.camera.bottom) / this.camera.zoom / height
    const distance = this.camera.position.distanceTo(point)
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.#perspective.fov / 2))) / height
  }

  #material(color: number | null, vertexColors: boolean) {
    const key = `${vertexColors ? 'v' : (color ?? 'd')}`
    let material = this.#materials.get(key)
    if (!material) {
      material = this.#patch(
        new THREE.MeshStandardMaterial({
          color: vertexColors ? 0xffffff : (color ?? DEFAULT_COLOR),
          vertexColors,
          metalness: 0.05,
          roughness: 0.62,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
          clippingPlanes: this.#clipping,
        }),
      )
      this.#materials.set(key, material)
    }
    return material
  }

  #adopt(material: THREE.Material) {
    const adopted = material.clone()
    adopted.side = THREE.DoubleSide
    adopted.clippingPlanes = this.#clipping
    adopted.polygonOffset = true
    adopted.polygonOffsetFactor = 1
    adopted.polygonOffsetUnits = 1
    this.#materials.set(adopted.uuid, adopted)
    return this.#patch(adopted)
  }

  #patch(material: THREE.Material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uCap = this.#capUniform
      shader.uniforms.uCapColor = this.#capColor
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uCap;\nuniform vec3 uCapColor;')
        .replace(/}\s*$/, '  if (uCap > 0.5 && !gl_FrontFacing) gl_FragColor = vec4(uCapColor, 1.0);\n}')
    }
    material.customProgramCacheKey = () => 'hurt-cap'
    return material
  }

  #derivedMaterial(base: THREE.Material, kind: 'select' | 'hover' | 'ghost' | 'tool') {
    let set = this.#derived.get(base)
    if (!set) this.#derived.set(base, (set = {}))
    if (!set[kind]) {
      const material = kind === 'ghost' || kind === 'tool' ? base.clone() : this.#patch(base.clone())
      material.clippingPlanes = this.#clipping
      if (kind === 'ghost' || kind === 'tool') {
        material.transparent = true
        material.opacity = kind === 'tool' ? TOOL_OPACITY : 0.12
        if (kind === 'tool') material.polygonOffsetFactor = material.polygonOffsetUnits = -1
        material.depthWrite = false
        material.forceSinglePass = true
      } else if ('emissive' in material) {
        ;(material as THREE.MeshStandardMaterial).emissive.set(kind === 'select' ? SELECT_EMISSIVE : HOVER_EMISSIVE)
        ;(material as THREE.MeshStandardMaterial).emissiveIntensity = kind === 'select' ? 0.45 : 0.6
      }
      showWireframe(material, kind === 'ghost' ? this.wireframe : this.wireframe && this.#wireFallback)
      set[kind] = material
    }
    return set[kind]!
  }

  *#allMaterials() {
    yield* this.#materials.values()
    for (const set of this.#derived.values()) for (const material of Object.values(set)) if (material) yield material
  }

  #restyle() {
    for (const view of this.views) {
      const hidden = this.hidden.has(view.id)
      view.mesh.visible = !hidden
      if (hidden) continue
      const selected = this.selected.has(view.id)
      const kind = view.tool
        ? 'tool'
        : selected
          ? 'select'
          : this.hovered === view.id
            ? 'hover'
            : this.xray
              ? 'ghost'
              : null
      view.mesh.material = kind ? this.#derivedMaterial(view.base, kind) : view.base
      view.mesh.renderOrder = kind === 'ghost' || kind === 'tool' ? 1 : 0
      const wire = this.wireframe && !!view.wire && kind !== 'ghost'
      view.mesh.layers.set(wire ? SOLID_HIDDEN_LAYER : 0)
      if (view.wire) {
        view.wire.visible = wire
        view.wire.material = view.mesh.material
        view.wire.renderOrder = view.mesh.renderOrder
      }
      if (view.edges) view.edges.visible = this.edgesVisible && kind !== 'ghost'
    }
    this.render()
  }

  async #buildWires() {
    const generation = this.#generation
    const views = this.views.filter((view) => !view.wire)
    const geometries = [...new Set(views.map((view) => view.mesh.geometry))]
    try {
      const indices = await this.#wireWorker.call<(Uint16Array | Uint32Array)[]>('wire', {
        indices: geometries.map((geometry) => geometry.index?.array ?? null),
        counts: geometries.map((geometry) => geometry.attributes.position.count),
      })
      if (generation !== this.#generation) return
      const lines = new Map(geometries.map((geometry, i) => [geometry, wireGeometry(geometry, indices[i])]))
      for (const view of views) {
        const wire = new THREE.LineSegments(lines.get(view.mesh.geometry), view.mesh.material)
        wire.raycast = () => {}
        wire.renderOrder = view.mesh.renderOrder
        view.mesh.add(wire)
        view.wire = wire
      }
    } catch {
      if (generation !== this.#generation) return
      this.#wireFallback = true
    }
    this.#applyWireframe()
  }

  #applyWireframe() {
    const fallback = this.wireframe && this.#wireFallback
    for (const material of this.#materials.values()) showWireframe(material, fallback)
    for (const set of this.#derived.values()) {
      showWireframe(set.select, fallback)
      showWireframe(set.hover, fallback)
      showWireframe(set.ghost, this.wireframe)
    }
    this.#restyle()
  }

  #edgeLines(geometry: THREE.BufferGeometry) {
    const lines = new THREE.LineSegments(geometry, this.#edgeMaterial)
    lines.raycast = () => {}
    return lines
  }

  #updateGrid() {
    if (this.#grid) {
      this.scene.remove(this.#grid)
      ;(this.#grid as THREE.GridHelper).dispose()
    }
    if (this.bounds.isEmpty()) return
    const size = this.bounds.getSize(new THREE.Vector3())
    const span = Math.max(size.x, this.upAxis === 'z' ? size.y : size.z) * 1.6
    const step = niceStep(span / 20)
    const divisions = Math.max(2, Math.ceil(span / step))
    const grid = new THREE.GridHelper(divisions * step, divisions, 0x1e5c52, 0x135349)
    const center = this.bounds.getCenter(new THREE.Vector3())
    if (this.upAxis === 'z') {
      grid.rotation.x = Math.PI / 2
      grid.position.set(center.x, center.y, this.bounds.min.z)
    } else {
      grid.position.set(center.x, this.bounds.min.y, center.z)
    }
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.6
    grid.raycast = () => {}
    this.#grid = grid
    this.scene.add(grid)
  }

  #updateSectionOutline(section: SectionState) {
    if (this.#sectionOutline) {
      this.#overlayGroup.remove(this.#sectionOutline)
      this.#sectionOutline.geometry.dispose()
      ;(this.#sectionOutline.material as THREE.Material).dispose()
      this.#sectionOutline = null
    }
    if (!section.enabled || this.bounds.isEmpty()) return
    const { min, max } = this.bounds
    const at =
      min.getComponent(section.axis) +
      (max.getComponent(section.axis) - min.getComponent(section.axis)) * section.position
    const others = [0, 1, 2].filter((a) => a !== section.axis)
    const corner = (u: number, v: number) => {
      const p = new THREE.Vector3()
      p.setComponent(section.axis, at)
      p.setComponent(others[0], u ? max.getComponent(others[0]) : min.getComponent(others[0]))
      p.setComponent(others[1], v ? max.getComponent(others[1]) : min.getComponent(others[1]))
      return p
    }
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)]),
      new THREE.LineBasicMaterial({ color: CAP_COLOR, transparent: true, opacity: 0.8 }),
    )
    this.#sectionOutline = outline
    this.#overlayGroup.add(outline)
  }

  #placeLabels() {
    if (this.#labels.length === 0) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    for (const label of this.#labels) {
      const p = label.point.clone().project(this.camera)
      const visible = p.z < 1 && Math.abs(p.x) <= 1.1 && Math.abs(p.y) <= 1.1
      label.element.style.display = visible ? '' : 'none'
      label.element.style.transform = `translate(${((p.x + 1) / 2) * rect.width}px, ${((1 - p.y) / 2) * rect.height}px) translate(-50%, -140%)`
    }
  }

  #handleDown = (event: PointerEvent) => {
    this.#pointerDown = { x: event.clientX, y: event.clientY }
  }

  #handleUp = (event: PointerEvent) => {
    const down = this.#pointerDown
    this.#pointerDown = null
    if (!down || event.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return
    this.onClick?.(this.pick(event.clientX, event.clientY), event)
  }

  #handleMove = (event: PointerEvent) => {
    if (event.buttons !== 0 || !this.onHover) return
    cancelAnimationFrame(this.#hoverFrame)
    this.#hoverFrame = requestAnimationFrame(() => this.onHover?.(this.pick(event.clientX, event.clientY), event))
  }

  #handleLeave = (event: PointerEvent) => {
    cancelAnimationFrame(this.#hoverFrame)
    this.onHover?.(null, event)
  }

  #handleDoubleClick = (event: MouseEvent) => {
    this.onDoubleClick?.(this.pick(event.clientX, event.clientY))
  }
}

function partGeometry(part: ModelPart) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(part.position, 3))
  if (part.index) geometry.setIndex(new THREE.BufferAttribute(part.index, 1))
  if (part.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3))
  else geometry.computeVertexNormals()
  if (part.colors) geometry.setAttribute('color', new THREE.BufferAttribute(part.colors, 3, true))
  if (part.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

function showWireframe(material: THREE.Material | undefined, on: boolean) {
  if (material && 'wireframe' in material) (material as THREE.MeshStandardMaterial).wireframe = on
}

function wireGeometry(geometry: THREE.BufferGeometry, index: Uint16Array | Uint32Array) {
  const wire = new THREE.BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) wire.setAttribute(name, attribute)
  wire.setIndex(new THREE.BufferAttribute(index, 1))
  wire.boundingBox = geometry.boundingBox
  wire.boundingSphere = geometry.boundingSphere
  return wire
}

function edgeGeometry(part: ModelPart) {
  const { points, offsets } = part.edges
  const indices: number[] = []
  for (let c = 0; c < offsets.length - 1; c++)
    for (let i = offsets[c]; i < offsets[c + 1] - 1; i++) indices.push(i, i + 1)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
  geometry.setIndex(indices)
  return geometry
}

function niceStep(raw: number) {
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)))
  const scaled = raw / power
  return (scaled < 1.5 ? 1 : scaled < 3.5 ? 2 : scaled < 7.5 ? 5 : 10) * power
}
