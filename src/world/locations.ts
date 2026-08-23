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
  'cinema',
  'bowling',
  'cafe',
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

/** Minimum time an agent stays at a location before choosing to leave. */
export const MIN_STAY_TICKS: Partial<Record<LocationKind, number>> = {
  bar: Math.round(0.5 * TICKS_PER_HOUR),
  cafe: Math.round(0.25 * TICKS_PER_HOUR),
  gym: TICKS_PER_HOUR,
  cinema: Math.round(1.5 * TICKS_PER_HOUR),
  supermarket: Math.round(0.25 * TICKS_PER_HOUR),
  shop: Math.round(0.25 * TICKS_PER_HOUR),
  park: Math.round(0.25 * TICKS_PER_HOUR),
  bowling: Math.round(0.75 * TICKS_PER_HOUR),
}

/** Grid is walked in 8 directions, so diagonals cost the same as orthogonals. */
export const tileDistance = (a: Tile, b: Tile): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

/** Walking pace, in tiles per world hour. A tile is roughly a city block. */
export const TILES_PER_HOUR = 12

export const travelTicks = (from: Tile, to: Tile): number => {
  const tilesPerTick = TILES_PER_HOUR / TICKS_PER_HOUR
  return Math.max(1, Math.ceil(tileDistance(from, to) / tilesPerTick))
}

/** Position along a walk, for the viewer to interpolate between ticks. */
export const interpolate = (from: Tile, to: Tile, progress: number): Tile => {
  const t = Math.max(0, Math.min(1, progress))
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}
