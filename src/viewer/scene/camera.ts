/**
 * Camera rig: orbit controls plus the three ways the viewer moves the camera —
 * fit the whole cast on screen, glide onto a tile, follow one agent.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TILE, type CityGrid } from './grid.js'
import type { AgentView } from './agents.js'

const MIN_DISTANCE = 8
const MAX_DISTANCE = 100
/**
 * Fixed viewing angle used whenever the camera reframes itself.
 */
const ISO_DIR = new THREE.Vector3(0.62, 0.55, 0.62).normalize()

/**
 * The camera and its orbit controls, kept together because they move as one.
 */
export type CameraRig = {
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
}

/**
 * Perspective camera plus damped orbit controls, framed on the city centre.
 */
export function createCamera(canvas: HTMLCanvasElement, center: THREE.Vector3, aspect: number): CameraRig {
  const camera = new THREE.PerspectiveCamera(35, aspect, 0.5, 200)
  camera.position.set(center.x + 35, 30, center.z + 35)
  camera.lookAt(center)

  const controls = new OrbitControls(camera, canvas)
  controls.target.copy(center)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = MIN_DISTANCE
  controls.maxDistance = MAX_DISTANCE
  controls.maxPolarAngle = Math.PI / 2.2

  return { camera, controls }
}

/**
 * Where a one-shot camera glide is heading.
 */
export type Focus = { target: THREE.Vector3; camera: THREE.Vector3 }

/**
 * Frame every agent as tightly as the viewport allows.
 */
export function framingAllAgents(
  rig: CameraRig,
  grid: CityGrid,
  views: Map<string, AgentView>,
): Focus | null {
  const pts = [...views.values()].map((v) => (v.travelling ? v.to : { x: v.x, y: v.y }))
  if (pts.length === 0) return null

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }

  const a = grid.worldPos(minX, minY)
  const b = grid.worldPos(maxX, maxY)
  const target = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2)

  // Buildings are taller than agents, so pad the extent rather than fitting exactly
  const radius = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) / 2 + TILE * 2
  const fov = THREE.MathUtils.degToRad(rig.camera.fov)
  const fitH = radius / Math.tan(fov / 2)
  const fitW = fitH / rig.camera.aspect
  const dist = THREE.MathUtils.clamp(Math.max(fitH, fitW) * 1.25, MIN_DISTANCE, MAX_DISTANCE)

  return { target, camera: target.clone().addScaledVector(ISO_DIR, dist) }
}

/**
 * Glide onto a tile, keeping the current viewing angle.
 */
export function framingTile(rig: CameraRig, grid: CityGrid, gx: number, gy: number, distance = 12): Focus {
  const p = grid.worldPos(gx, gy)
  const target = new THREE.Vector3(p.x, 1, p.z)
  const dir = rig.camera.position.clone().sub(rig.controls.target).normalize()
  if (dir.lengthSq() === 0) dir.copy(ISO_DIR)
  return { target, camera: target.clone().addScaledVector(dir, distance) }
}

/**
 * Jumps straight to a framing, with no animation.
 */
export function snapTo(rig: CameraRig, focus: Focus): void {
  rig.controls.target.copy(focus.target)
  rig.camera.position.copy(focus.camera)
  rig.camera.lookAt(focus.target)
}

/**
 * Step one frame toward a focus. Returns true once it has arrived.
 */
export function easeTo(rig: CameraRig, focus: Focus): boolean {
  rig.controls.target.lerp(focus.target, 0.08)
  rig.camera.position.lerp(focus.camera, 0.08)
  return rig.camera.position.distanceTo(focus.camera) < 0.25
}

/**
 * One step in or out, from the DOM zoom buttons.
 */
export function zoom(rig: CameraRig, dir: number): void {
  const dist = rig.camera.position.distanceTo(rig.controls.target)
  const next = THREE.MathUtils.clamp(dist * (dir > 0 ? 0.8 : 1.25), MIN_DISTANCE, MAX_DISTANCE)
  const away = rig.camera.position.clone().sub(rig.controls.target).normalize()
  rig.camera.position.copy(rig.controls.target).addScaledVector(away, next)
}
