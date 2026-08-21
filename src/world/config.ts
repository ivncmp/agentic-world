import type { LocationKind } from './locations.js'

/**
 * The city as data. Counts per kind, not hand-placed buildings — a city is
 * regenerated from a seed, so this stays small enough for a human to edit and
 * an open-source adopter can ship a different one without touching code.
 */
export type CityConfig = {
  name: string
  /**
   * City blocks along one edge. The tile grid is derived from this and the
   * street period, so streets and blocks can never disagree about the map.
   * Odd numbers give the plaza a true centre.
   */
  blocksPerSide: number
  /** First entry is the central district; the rest are outer quarters. */
  districts: readonly string[]
  /** How many of each public location kind to build. Homes are per-agent. */
  venues: Partial<Record<Exclude<LocationKind, 'home'>, number>>
  /** Vacancies per workplace, before any agent is hired. */
  openingsPerWorkplace: number
}

/**
 * v0 is one neighbourhood, per DESIGN.md. Density matters more than size at
 * this scale: with ~8 agents a 30-venue city spread them so thin they stopped
 * meeting. Scale this up as agent count grows — it is the dial for how often
 * lives intersect.
 */
export const DEFAULT_CITY: CityConfig = {
  name: 'Vallecar',
  blocksPerSide: 5,
  districts: ['Centro', 'Ribera', 'Altos', 'Puerto', 'Norte'],
  venues: {
    bar: 2,
    office: 2,
    shop: 1,
    supermarket: 1,
    clinic: 1,
    school: 1,
    gym: 1,
    park: 2,
    garage: 1,
  },
  openingsPerWorkplace: 3,
}
