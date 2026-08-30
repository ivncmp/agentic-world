/**
 * Ground plane: one flat tile per grid cell, plus the per-tile facts the
 * tooltip needs. Street tiles get no ground mesh — the road model covers them.
 */
import * as THREE from 'three'
import { CityGrid, TILE } from './grid.js'
import type { LocationInfo } from '../core/connection.js'

/**
 * What hovering a bare tile should report.
 */
export type TileInfo = {
  venue: LocationInfo | null
  home: boolean
  role: string | null
  district: string | null
  water: string | null
  bridge: boolean
}

/**
 * The per-tile facts the tooltip needs, plus the shared water material.
 */
export type Ground = {
  tileData: Map<string, TileInfo>
  /**
   * Shared by every water tile, so the wave animation can find them by material.
   */
  waterMat: THREE.MeshPhongMaterial
}

const WATER_Y = -0.12

/**
 * One flat tile per cell. Streets get none — the road model covers them.
 */
export function buildGround(scene: THREE.Scene, grid: CityGrid): Ground {
  const MAT = {
    grass: new THREE.MeshLambertMaterial({ color: 0x4a8a3a }),
    grassLight: new THREE.MeshLambertMaterial({ color: 0x5aaa4a }),
    dirt: new THREE.MeshLambertMaterial({ color: 0x8a7a60 }),
    sand: new THREE.MeshLambertMaterial({ color: 0xc8b888 }),
  }
  const waterMat = new THREE.MeshPhongMaterial({ color: 0x2e6ea4, shininess: 70 })

  const tileGeo = new THREE.PlaneGeometry(TILE, TILE)
  tileGeo.rotateX(-Math.PI / 2)
  // Water tiles overlap slightly so the wave bob never opens a seam
  const waterGeo = new THREE.PlaneGeometry(TILE + 0.04, TILE + 0.04)
  waterGeo.rotateX(-Math.PI / 2)

  const tileData = new Map<string, TileInfo>()

  for (let gy = 0; gy < grid.size; gy++) {
    for (let gx = 0; gx < grid.size; gx++) {
      const k = `${gx},${gy}`
      const bx = Math.floor(gx / grid.period)
      const by = Math.floor(gy / grid.period)
      const block = grid.blockAt(bx, by)

      const info: TileInfo = {
        venue: grid.venueAt.get(k) ?? null,
        home: false,
        role: block?.role ?? null,
        district: grid.districtOf(bx, by),
        water: null,
        bridge: false,
      }

      let mat: THREE.Material
      let yOff = 0

      if (grid.sea.has(k)) {
        mat = waterMat
        yOff = WATER_Y
        info.water = 'sea'
      } else if (grid.isBridge(gx, gy)) {
        mat = waterMat
        yOff = WATER_Y
        info.water = 'river'
        info.bridge = true
      } else if (grid.river.has(k)) {
        mat = waterMat
        yOff = WATER_Y
        info.water = 'river'
      } else if (grid.lake.has(k)) {
        mat = waterMat
        yOff = WATER_Y
        info.water = 'lake'
      } else if (grid.isStreet(gx, gy)) {
        // Roads carry their own surface; only the coastal strip needs sand under it
        if (!grid.adjSea(gx, gy)) {
          tileData.set(k, info)
          continue
        }
        mat = MAT.sand
      } else if (block) {
        if (block.role === 'plaza') mat = MAT.dirt
        else if (block.role === 'green') mat = MAT.grassLight
        else if (block.role === 'harbor') mat = MAT.sand
        else if (block.role === 'sea') {
          mat = waterMat
          yOff = WATER_Y
          info.water = 'sea'
        } else mat = MAT.grass
      } else {
        mat = MAT.grass
      }

      if (block?.role === 'residential' && !grid.isStreet(gx, gy) && !grid.isWater(gx, gy) && !info.venue) {
        info.home = true
      }

      const tile = new THREE.Mesh(info.water ? waterGeo : tileGeo, mat)
      tile.position.copy(grid.worldPos(gx, gy))
      tile.position.y = yOff
      tile.receiveShadow = true
      scene.add(tile)

      tileData.set(k, info)
    }
  }

  return { tileData, waterMat }
}

/**
 * Gentle bob so water reads as water. Called every frame from the render loop.
 */
export function animateWater(scene: THREE.Scene, waterMat: THREE.Material, t: number): void {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && mesh.material === waterMat) {
      obj.position.y = WATER_Y + Math.sin(t * 1.5 + obj.position.x * 0.3 + obj.position.z * 0.2) * 0.02
    }
  })
}
