/**
 * City configuration and baked templates.
 *
 * A city is either generated from a seed or loaded from a template file. The
 * template is validated in full before it is cast, because it is read once at
 * boot and a missing field would otherwise surface halfway through generation
 * with a stack trace pointing at the wrong place.
 */
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

/**
 * A rectangle of river, sea or lake. Expanded to tiles by the viewer.
 */
export type WaterRegion = {
  kind: 'river' | 'sea' | 'lake'
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * A baked city: the same shape the generator produces, saved to disk.
 */
export type CityTemplate = {
  name: string
  grid: { width: number; height: number }
  streetPeriod: number
  districts: string[]
  blocks: { bx: number; by: number; role: BlockRole }[]
  venues: { kind: Exclude<LocationKind, 'home'>; name: string; x: number; y: number; district: string }[]
  homePlots: { x: number; y: number; district: string }[]
  openingsPerWorkplace: number
  water?: WaterRegion[]
}

/**
 * Every required field is checked before the cast, because a template is read
 * once at boot and a missing field would otherwise surface as `undefined`
 * halfway through city generation — with a stack trace pointing at the
 * generator rather than at the file that is actually wrong.
 */
export function loadTemplate(path: string): CityTemplate {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>

  const bad = (why: string): never => {
    throw new Error(`template ${path}: ${why}`)
  }

  if (typeof raw.name !== 'string' || raw.name === '') bad('missing name')

  const grid = raw.grid as { width?: unknown; height?: unknown } | undefined
  if (typeof grid?.width !== 'number' || typeof grid.height !== 'number')
    bad('grid must be { width, height }')

  if (typeof raw.streetPeriod !== 'number' || raw.streetPeriod < 2) bad('streetPeriod must be a number >= 2')

  if (!Array.isArray(raw.districts) || raw.districts.length === 0) bad('districts must be a non-empty array')

  if (typeof raw.openingsPerWorkplace !== 'number' || raw.openingsPerWorkplace < 1)
    bad('openingsPerWorkplace must be a number >= 1')

  if (!Array.isArray(raw.venues) || raw.venues.length === 0) bad('venues must be a non-empty array')
  if (!Array.isArray(raw.blocks)) bad('missing blocks')
  if (!Array.isArray(raw.homePlots) || raw.homePlots.length === 0) bad('homePlots must be a non-empty array')

  const validKinds = new Set<string>(LOCATION_KINDS.filter((k) => k !== 'home'))
  const districts = new Set(raw.districts as string[])
  for (const v of raw.venues as { kind: string; district: string; name: string }[]) {
    if (!validKinds.has(v.kind)) bad(`unknown venue kind "${v.kind}"`)
    // A venue in a district nobody declared reaches the viewer as a building
    // with no district, and the tooltip goes blank rather than erroring.
    if (!districts.has(v.district)) bad(`venue "${v.name}" is in undeclared district "${v.district}"`)
  }

  // Validated above.
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
