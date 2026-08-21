/** A whole city, not a neighbourhood. Kinds drive jobs, needs and vices. */
export const LOCATION_KINDS = [
  'home',
  'bar',
  'office',
  'shop',
  'supermarket',
  'clinic',
  'school',
  'gym',
  'park',
  'garage',
] as const

export type LocationKind = (typeof LOCATION_KINDS)[number]
export type LocationId = string

/**
 * Isometric grid coordinates, Habbo-style. Everything the viewer needs to draw
 * the world and animate movement comes from here — without positions there is
 * no map and no walking, only teleportation between ids.
 */
import { TICKS_PER_HOUR } from '../engine/clock.js'

export type Tile = { x: number; y: number }

export type Location = {
  id: LocationId
  kind: LocationKind
  name: string
  district: string
  /** One tile per venue for now; rooms with interiors come later. */
  tile: Tile
  /** Homes are private: exactly one resident. */
  residentId?: string
}

/** Grid is walked in 8 directions, so diagonals cost the same as orthogonals. */
export const tileDistance = (a: Tile, b: Tile): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/** Walking pace, in tiles per world hour. A tile is roughly a city block. */
export const TILES_PER_HOUR = 36

export const travelTicks = (from: Tile, to: Tile): number => {
  const tilesPerTick = TILES_PER_HOUR / TICKS_PER_HOUR
  return Math.max(1, Math.ceil(tileDistance(from, to) / tilesPerTick))
}

/** Position along a walk, for the viewer to interpolate between ticks. */
export const interpolate = (from: Tile, to: Tile, progress: number): Tile => {
  const t = Math.max(0, Math.min(1, progress))
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}
