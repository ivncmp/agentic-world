/**
 * Day/night cycle, driven by the engine's in-game hour rather than wall time.
 *
 * Night stays a readable moonlit blue on purpose: this is a spectator view, and
 * a realistic night is one where you cannot see the drama.
 */
import * as THREE from 'three'

/**
 * The three lights the day/night cycle drives.
 */
export type SkyRig = {
  ambient: THREE.AmbientLight
  sun: THREE.DirectionalLight
  fill: THREE.DirectionalLight
}

const DAWN = 6
const DUSK = 20

const NIGHT_SKY = new THREE.Color(0x33507f)
const DAY_SKY = new THREE.Color(0x87ceeb)
const GOLDEN_SKY = new THREE.Color(0xf19a5a)
const SUN_COLOUR = new THREE.Color(0xfff3d6)
const HORIZON_COLOUR = new THREE.Color(0xff7a3c)
const MOON_COLOUR = new THREE.Color(0x7f9cd8)

/**
 * Ambient, sun with shadows, and a cool fill. Shadow camera covers the city.
 */
export function createLighting(scene: THREE.Scene, center: THREE.Vector3): SkyRig {
  const ambient = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(0xfff5e0, 1.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -60
  sun.shadow.camera.right = 60
  sun.shadow.camera.top = 60
  sun.shadow.camera.bottom = -60
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 160
  sun.shadow.bias = -0.001
  sun.target.position.copy(center)
  scene.add(sun, sun.target)

  const fill = new THREE.DirectionalLight(0xb0c4de, 0.3)
  fill.position.set(-20, 15, -10)
  scene.add(fill)

  return { ambient, sun, fill }
}

/**
 * The sun rises at 6, peaks at 13 and sets at 20, so shadows sweep across the
 * city as the day runs. Below the horizon the same light becomes the moon.
 */
export function applySkyForHour(
  rig: SkyRig,
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  center: THREE.Vector3,
  hour: number,
): void {
  const dayT = (hour - DAWN) / (DUSK - DAWN)
  const above = dayT > 0 && dayT < 1
  const elevation = above ? Math.sin(dayT * Math.PI) : 0

  const azimuth = (above ? dayT : dayT + 1) * Math.PI
  const radius = 70
  rig.sun.position.set(
    center.x + Math.cos(azimuth) * radius,
    Math.max(elevation, 0.08) * 55 + 6,
    center.z + Math.sin(azimuth * 0.6) * radius * 0.5 - 20,
  )
  rig.sun.target.position.copy(center)

  const warmth = above ? Math.pow(1 - elevation, 2) : 1

  if (above) {
    rig.sun.color.copy(SUN_COLOUR).lerp(HORIZON_COLOUR, warmth * 0.85)
    rig.sun.intensity = 0.55 + elevation * 1.05
    rig.ambient.color.set(0xffffff)
    rig.ambient.intensity = 0.55 + elevation * 0.3
    rig.fill.intensity = 0.25 + elevation * 0.15
  } else {
    rig.sun.color.copy(MOON_COLOUR)
    rig.sun.intensity = 0.55
    rig.ambient.color.set(0xc2d2f0)
    rig.ambient.intensity = 0.7
    rig.fill.intensity = 0.3
  }

  const sky = above
    ? NIGHT_SKY.clone()
        .lerp(DAY_SKY, Math.min(1, elevation * 2.2))
        .lerp(GOLDEN_SKY, warmth * 0.55)
    : NIGHT_SKY.clone()

  ;(scene.background as THREE.Color).copy(sky)
  ;(scene.fog as THREE.FogExp2).color.copy(sky)
  renderer.toneMappingExposure = above ? 1.05 + elevation * 0.2 : 1.0
}
