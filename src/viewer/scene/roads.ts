/**
 * Roads and bridges.
 *
 * Which road piece a tile gets is derived from its four neighbours, so the
 * street network stitches itself together without any authored tile map.
 */
import * as THREE from 'three'
import { CityGrid, TILE } from './grid.js'
import type { PlaceFn } from './assets.js'

const H = Math.PI / 2

function isRoadConnected(grid: CityGrid, gx: number, gy: number): boolean {
  if (!grid.inBounds(gx, gy)) return false
  if (grid.isWater(gx, gy) && !grid.isBridge(gx, gy)) return false
  return grid.isStreet(gx, gy)
}

/** Pick the road model and rotation that match a tile's connected neighbours. */
export function classifyRoad(grid: CityGrid, gx: number, gy: number): { model: string; rot: number } {
  const n = isRoadConnected(grid, gx, gy - 1)
  const e = isRoadConnected(grid, gx + 1, gy)
  const s = isRoadConnected(grid, gx, gy + 1)
  const w = isRoadConnected(grid, gx - 1, gy)
  const count = [n, e, s, w].filter(Boolean).length

  if (count === 4) return { model: 'rd-crossroad', rot: 0 }

  if (count === 3) {
    if (!n) return { model: 'rd-intersection', rot: 0 }
    if (!w) return { model: 'rd-intersection', rot: H }
    if (!s) return { model: 'rd-intersection', rot: Math.PI }
    if (!e) return { model: 'rd-intersection', rot: -H }
  }

  if (count === 2) {
    if (e && w) return { model: 'rd-straight', rot: 0 }
    if (n && s) return { model: 'rd-straight', rot: H }
    if (e && s) return { model: 'rd-bend', rot: H }
    if (n && e) return { model: 'rd-bend', rot: Math.PI }
    if (w && n) return { model: 'rd-bend', rot: -H }
    if (s && w) return { model: 'rd-bend', rot: 0 }
  }

  if (count === 1) {
    if (s) return { model: 'rd-end', rot: 0 }
    if (e) return { model: 'rd-end', rot: H }
    if (n) return { model: 'rd-end', rot: Math.PI }
    if (w) return { model: 'rd-end', rot: Math.PI }
  }

  return { model: 'rd-straight', rot: 0 }
}

const DECK_MAT = new THREE.MeshLambertMaterial({ color: 0xa08850 })
const RAIL_MAT = new THREE.MeshLambertMaterial({ color: 0x8a7040 })
const DECK_GEO = new THREE.BoxGeometry(TILE, 0.06, TILE)
const RAIL_GEO_X = new THREE.BoxGeometry(TILE, 0.25, TILE * 0.06)
const RAIL_GEO_Z = new THREE.BoxGeometry(TILE * 0.06, 0.25, TILE)

/** Plank deck plus railings, oriented across the river the bridge spans. */
function placeBridge(scene: THREE.Scene, grid: CityGrid, gx: number, gy: number): void {
  const pos = grid.worldPos(gx, gy)

  const plank = new THREE.Mesh(DECK_GEO, DECK_MAT)
  plank.position.set(pos.x, 0.08, pos.z)
  plank.castShadow = true
  scene.add(plank)

  const acrossZ = grid.river.has(`${gx},${gy - 1}`) || grid.river.has(`${gx},${gy + 1}`)
  const geo = acrossZ ? RAIL_GEO_X : RAIL_GEO_Z
  for (const d of [-0.44, 0.44]) {
    const rail = new THREE.Mesh(geo, RAIL_MAT)
    if (acrossZ) rail.position.set(pos.x, 0.2, pos.z + TILE * d)
    else rail.position.set(pos.x + TILE * d, 0.2, pos.z)
    scene.add(rail)
  }
}

export function placeRoads(scene: THREE.Scene, grid: CityGrid, place: PlaceFn): void {
  for (let gy = 0; gy < grid.size; gy++) {
    for (let gx = 0; gx < grid.size; gx++) {
      if (!grid.isStreet(gx, gy)) continue
      if (grid.isWater(gx, gy) && !grid.isBridge(gx, gy)) continue
      if (grid.sea.has(`${gx},${gy}`)) continue

      if (grid.isBridge(gx, gy)) {
        placeBridge(scene, grid, gx, gy)
        continue
      }

      const { model, rot } = classifyRoad(grid, gx, gy)
      place(model, gx, gy, rot)
    }
  }
}
