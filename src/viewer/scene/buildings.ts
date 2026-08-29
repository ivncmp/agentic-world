/**
 * Everything standing on a non-street tile: venues from the engine, then filler
 * buildings, props and street furniture.
 *
 * Only venues come from the world payload. Which model fills any other tile is
 * decided here from `hash(gx, gy, salt)`, so a 25x25 city stays out of the
 * network payload while every spectator sees the same town.
 */
import type * as THREE from 'three'
import { hash } from '../core/hash.js'
import type { CityGrid } from './grid.js'
import type { PlaceFn } from './assets.js'
import {
  COMMERCIAL_POOL,
  SKYSCRAPER_POOL,
  LOW_DETAIL_POOL,
  SUBURBAN_POOL,
  INDUSTRIAL_POOL,
  VENUE_MODELS,
} from './assets.js'
import type { LocationInfo } from '../core/connection.js'

const pickFrom = (pool: string[], gx: number, gy: number, salt: string): string =>
  pool[hash(gx, gy, salt) % pool.length]!

const quarterTurns = (gx: number, gy: number, salt: string): number =>
  (hash(gx, gy, salt) % 4) * (Math.PI / 2)

/** Places the engine's venues. Returns their meshes keyed by location id. */
export function placeVenues(grid: CityGrid, place: PlaceFn): Map<string, THREE.Object3D> {
  const meshes = new Map<string, THREE.Object3D>()
  for (const v of grid.locations) {
    const obj =
      v.kind === 'park'
        ? place(parkModel(v), v.x, v.y, 0, { venue: v, role: null })
        : place(
            pickFrom(VENUE_MODELS[v.kind] ?? COMMERCIAL_POOL, v.x, v.y, v.name),
            v.x,
            v.y,
            quarterTurns(v.x, v.y, 'rot'),
            { venue: v, role: null },
          )
    if (obj) meshes.set(v.id, obj)
  }
  return meshes
}

function parkModel(v: LocationInfo): string {
  const h = hash(v.x, v.y, 'park') % 4
  return h < 2 ? 'tree-lg' : h === 2 ? 'tree-sm' : 'planter'
}

/**
 * Fills every buildable tile the venues did not claim. Each block role has its
 * own mix of buildings and props, which is what makes districts read differently.
 */
export function placeFillers(grid: CityGrid, place: PlaceFn): void {
  for (let gy = 0; gy < grid.size; gy++) {
    for (let gx = 0; gx < grid.size; gx++) {
      if (grid.isStreet(gx, gy) || grid.isWater(gx, gy) || grid.isBridge(gx, gy)) continue
      if (grid.venueAt.has(`${gx},${gy}`)) continue
      if (grid.adjSea(gx, gy)) continue

      const bx = Math.floor(gx / grid.period)
      const by = Math.floor(gy / grid.period)
      const block = grid.blockAt(bx, by)
      if (!block || block.role === 'sea') continue

      // Position inside the block, so plazas and parks can keep their centre clear
      const lx = (gx % grid.period) - 1
      const ly = (gy % grid.period) - 1
      const middle = lx === 1 && ly === 1
      const rot = quarterTurns(gx, gy, 'rot')

      switch (block.role) {
        case 'civic':
          fillCivic(place, gx, gy, rot, middle)
          break
        case 'residential':
          fillResidential(place, gx, gy, rot, grid.districtOf(bx, by))
          break
        case 'green':
          fillGreen(place, gx, gy, rot, middle, lx, ly)
          break
        case 'plaza':
          fillPlaza(place, gx, gy, rot, middle, lx, ly)
          break
        case 'harbor':
          fillHarbor(place, gx, gy, rot)
          break
      }
    }
  }
}

function fillCivic(place: PlaceFn, gx: number, gy: number, rot: number, middle: boolean): void {
  const h = hash(gx, gy, 'fill') % 100
  if (middle) {
    place(h % 3 === 0 ? 'dumpster' : 'planter', gx, gy, rot)
  } else if (h < 75) {
    const pool = h < 15 ? SKYSCRAPER_POOL : h < 40 ? COMMERCIAL_POOL : LOW_DETAIL_POOL
    place(pickFrom(pool, gx, gy, 'idx'), gx, gy, rot, { role: 'civic' })
  } else {
    const ph = hash(gx, gy, 'prop') % 5
    if (ph === 0) place('planter', gx, gy)
    else if (ph === 1) place('dumpster', gx, gy, rot)
    else if (ph === 2) place('tree-sm', gx, gy)
    else if (ph === 3) place('fence-low', gx, gy, rot)
    else place('cone', gx, gy)
  }
}

function fillResidential(place: PlaceFn, gx: number, gy: number, rot: number, district: string | null): void {
  const isIronworks = district === 'Ironworks'
  const pool = isIronworks ? INDUSTRIAL_POOL : SUBURBAN_POOL
  if (hash(gx, gy, 'home') % 100 < 78) {
    place(pickFrom(pool, gx, gy, 'hidx'), gx, gy, rot, { role: isIronworks ? 'industrial' : 'home' })
    return
  }
  const ph = hash(gx, gy, 'yard') % 6
  if (ph < 2) place('tree-sm', gx, gy)
  else if (ph === 2) place('fence-low', gx, gy, rot)
  else if (ph === 3) place('planter', gx, gy)
  else if (ph === 4) place('parasol', gx, gy, rot)
  else place('tree-lg', gx, gy)
}

function fillGreen(
  place: PlaceFn,
  gx: number,
  gy: number,
  rot: number,
  middle: boolean,
  lx: number,
  ly: number,
): void {
  if (middle) {
    place('planter', gx, gy)
  } else if (lx === 1 || ly === 1) {
    // The cross through the middle of the block reads as a path
    if (hash(gx, gy, 'pstone') % 3 === 0) place('path-stones', gx, gy, rot)
  } else {
    place(hash(gx, gy, 'tree') % 3 === 0 ? 'tree-sm' : 'tree-lg', gx, gy)
  }
}

function fillPlaza(
  place: PlaceFn,
  gx: number,
  gy: number,
  rot: number,
  middle: boolean,
  lx: number,
  ly: number,
): void {
  if (middle) {
    place('parasol', gx, gy)
    return
  }
  if ((lx === 0 || lx === 2) && (ly === 0 || ly === 2)) {
    place('tree-lg', gx, gy)
    return
  }
  const ph = hash(gx, gy, 'parasol') % 6
  if (ph < 2) place(ph === 0 ? 'parasol' : 'parasol-b', gx, gy, rot)
  else if (ph === 2) place('planter', gx, gy)
}

function fillHarbor(place: PlaceFn, gx: number, gy: number, rot: number): void {
  if (hash(gx, gy, 'hbr') % 100 < 40) {
    place(pickFrom([...COMMERCIAL_POOL, ...INDUSTRIAL_POOL], gx, gy, 'hidx'), gx, gy, rot, { role: 'harbor' })
    return
  }
  const ph = hash(gx, gy, 'hprop') % 7
  if (ph === 0) place('tank', gx, gy, rot)
  else if (ph === 1) place('chimney-sm', gx, gy)
  else if (ph === 2) place('barrier', gx, gy, rot)
  else if (ph === 3) place('cone', gx, gy)
  else if (ph === 4) place('dumpster', gx, gy, rot)
  else if (ph === 5) place('fence-low', gx, gy, rot)
  else place('planter', gx, gy)
}

/** Lamps on every intersection, traffic lights on the busier block roles. */
export function placeStreetFurniture(grid: CityGrid, place: PlaceFn): void {
  for (let gy = 0; gy < grid.size; gy += grid.period) {
    for (let gx = 0; gx < grid.size; gx += grid.period) {
      if (grid.isWater(gx, gy) && !grid.isBridge(gx, gy)) continue
      if (grid.isBridge(gx, gy) || grid.sea.has(`${gx},${gy}`)) continue

      const h = hash(gx, gy, 'furn')
      place(h % 4 < 2 ? 'light-curved' : 'light-square', gx, gy, (h % 4) * (Math.PI / 2))

      if (h % 4 !== 0) continue
      const role = grid.blockOfTile(gx, gy)?.role
      if (role === 'civic' || role === 'plaza' || role === 'harbor') {
        place('traffic-light', gx, gy, ((h >> 3) % 4) * (Math.PI / 2))
      }
    }
  }
}
