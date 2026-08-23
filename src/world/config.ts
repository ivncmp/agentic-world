import { readFileSync } from 'node:fs'
import type { LocationKind } from './locations.js'
import { LOCATION_KINDS } from './locations.js'
import type { BlockRole } from './layout.js'

/**
 * The city as data. Counts per kind, not hand-placed buildings — a city is
 * regenerated from a seed, so this stays small enough for a human to edit and
 * an open-source adopter can ship a different one without touching code.
 */
export type CityConfig = {
  name: string
  blocksPerSide: number
  districts: readonly string[]
  venues: Partial<Record<Exclude<LocationKind, 'home'>, number>>
  openingsPerWorkplace: number
}

// ---- JSON city template -----------------------------------------------------

export type CityTemplate = {
  name: string
  grid: { width: number; height: number }
  streetPeriod: number
  districts: string[]
  blocks: { bx: number; by: number; role: BlockRole }[]
  venues: { kind: Exclude<LocationKind, 'home'>; name: string; x: number; y: number; district: string }[]
  homePlots: { x: number; y: number; district: string }[]
  openingsPerWorkplace: number
}

export function loadTemplate(path: string): CityTemplate {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  if (typeof raw.name !== 'string') throw new Error('template: missing name')
  if (!Array.isArray(raw.venues) || raw.venues.length === 0) throw new Error('template: venues must be a non-empty array')
  if (!Array.isArray(raw.blocks)) throw new Error('template: missing blocks')
  if (!Array.isArray(raw.homePlots)) throw new Error('template: missing homePlots')
  const validKinds = new Set<string>(LOCATION_KINDS.filter(k => k !== 'home'))
  for (const v of raw.venues as { kind: string }[]) {
    if (!validKinds.has(v.kind)) throw new Error(`template: unknown venue kind "${v.kind}"`)
  }
  return raw as unknown as CityTemplate
}

/**
 * v0 is one neighbourhood, per DESIGN.md. Density matters more than size at
 * this scale: with ~8 agents a 30-venue city spread them so thin they stopped
 * meeting. Scale this up as agent count grows — it is the dial for how often
 * lives intersect.
 */
export const DEFAULT_CITY: CityConfig = {
  name: 'New Agentown',
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
    cinema: 1,
    bowling: 1,
    cafe: 1,
  },
  openingsPerWorkplace: 3,
}
