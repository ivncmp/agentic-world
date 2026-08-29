/**
 * The city grid: tile geometry plus the spatial predicates every other scene
 * module asks about a tile (street? water? bridge? which block?).
 *
 * Built once from the engine's world payload and then read-only.
 */
import * as THREE from 'three'
import type { WorldInfo, LocationInfo, BlockInfo, WaterRegion } from '../core/connection.js'

/** World units per grid tile. Every model is scaled against this. */
export const TILE = 2.0

const NEIGHBOURS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]

/**
 * Water regions arrive as rectangles. Expand them to tiles, then reclassify any
 * river tile touching the sea as sea — otherwise the estuary grows a bridge.
 */
function expandWater(regions: WaterRegion[]): { river: Set<string>; sea: Set<string>; lake: Set<string> } {
  const river = new Set<string>()
  const sea = new Set<string>()
  const lake = new Set<string>()
  const target: Record<string, Set<string>> = { river, sea, lake }
  for (const r of regions) {
    const set = target[r.kind]
    if (set == null) continue
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++)
        set.add(`${x},${y}`)
  }
  const seaSnap = new Set(sea)
  for (const t of [...river]) {
    const [x, y] = t.split(',').map(Number) as [number, number]
    if (NEIGHBOURS.some(([dx, dy]) => seaSnap.has(`${x + dx},${y + dy}`))) {
      river.delete(t)
      sea.add(t)
    }
  }
  return { river, sea, lake }
}

export class CityGrid {
  readonly size: number
  readonly period: number
  readonly river: Set<string>
  readonly sea: Set<string>
  readonly lake: Set<string>
  readonly locations: LocationInfo[]
  readonly venueAt = new Map<string, LocationInfo>()
  readonly locById = new Map<string, LocationInfo>()

  private readonly blocks = new Map<string, BlockInfo>()
  private readonly districts: string[]

  constructor(world: WorldInfo) {
    this.size = world.city.grid.width
    this.period = world.city.streetPeriod
    this.districts = world.city.districts
    this.locations = world.locations

    for (const l of world.locations) {
      this.venueAt.set(`${l.x},${l.y}`, l)
      this.locById.set(l.id, l)
    }
    for (const b of world.city.blocks) this.blocks.set(`${b.bx},${b.by}`, b)

    const w = expandWater(world.city.water ?? [])
    this.river = w.river
    this.sea = w.sea
    this.lake = w.lake
  }

  /** Centre of a tile in world space, at ground level. */
  worldPos(gx: number, gy: number): THREE.Vector3 {
    return new THREE.Vector3(gx * TILE + TILE / 2, 0, gy * TILE + TILE / 2)
  }

  inBounds(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.size && gy < this.size
  }

  isStreet(x: number, y: number): boolean {
    return x % this.period === 0 || y % this.period === 0
  }

  isWater(x: number, y: number): boolean {
    const k = `${x},${y}`
    return this.river.has(k) || this.sea.has(k) || this.lake.has(k)
  }

  /** A street crossing the river — but never where the river has become sea. */
  isBridge(x: number, y: number): boolean {
    const k = `${x},${y}`
    if (!this.river.has(k) || !this.isStreet(x, y) || this.sea.has(k)) return false
    return !this.adjSea(x, y)
  }

  adjSea(x: number, y: number): boolean {
    return NEIGHBOURS.some(([dx, dy]) => this.sea.has(`${x + dx},${y + dy}`))
  }

  blockAt(bx: number, by: number): BlockInfo | undefined {
    return this.blocks.get(`${bx},${by}`)
  }

  blockOfTile(gx: number, gy: number): BlockInfo | undefined {
    return this.blockAt(Math.floor(gx / this.period), Math.floor(gy / this.period))
  }

  /** Blocks carry no district, so borrow one from a venue standing in them. */
  districtOf(bx: number, by: number): string | null {
    if (!this.blocks.has(`${bx},${by}`)) return null
    for (const v of this.locations) {
      if (Math.floor(v.x / this.period) === bx && Math.floor(v.y / this.period) === by) return v.district
    }
    return this.districts[0] ?? null
  }
}
