/**
 * Building a city — blocks, venues, homes and water.
 *
 * Everything here is seeded, so the same seed gives the same town and a layout
 * bug can be reproduced. Streets are a *rule* rather than a tilemap: the grid
 * size and street period travel to the viewer, which rebuilds the same street
 * map from the same rule. Shipping a tilemap would give the engine and the
 * viewer two copies of one decision, and they would quietly diverge.
 */
import type { CityConfig, CityTemplate, WaterRegion } from './config.js'
import { DEFAULT_CITY } from './config.js'
import type { Location, LocationId, LocationKind, Tile } from './locations.js'
import { cityLayout, type Block, type CityLayout } from './layout.js'
import { makeRng } from './rng.js'

const VENUE_NAMES: Partial<Record<LocationKind, readonly string[]>> = {
  bar: ['The Anchor', 'La Tasca', 'Bar Nube', 'El Farol', 'Café Rojo'],
  office: ['Nortec', 'Delgado & Co', 'Ibersoft', 'Grupo Marea'],
  shop: ['La Esquina', 'Bazar Luz', 'Tienda Sol', 'El Roble', 'Papelería Vega', 'Flores Mar'],
  supermarket: ['MercaVall', 'SuperRibera', 'Alimentos Puerto'],
  clinic: ['Clínica Santa Rosa', 'Centro Médico Altos'],
  school: ['IES New Agentown', 'Colegio Ribera'],
  gym: ['Gimnasio Titán', 'BoxAltos'],
  park: ['Parque del Puerto', 'Jardines Ribera', 'Plaza Mayor', 'Parque Norte'],
  garage: ['Talleres Ruiz', 'AutoPuerto'],
  cinema: ['Cines New Agentown', 'Sala Estrella'],
  bowling: ['Bolera Strike', 'BowlVall'],
  cafe: ['Café Rincón', 'La Tertulia', 'Café Sol'],
}

/**
 * A laid-out city, plus the mutable home-plot pool `createAgent` draws from.
 */
export type GeneratedCity = {
  config: CityConfig
  layout: CityLayout
  locations: Location[]
  /**
   * Allocates a home plot on a residential block. Homes are created with their
   * resident rather than up front, so this has to keep handing out fresh ground
   * as agents join. Skips any tile already occupied.
   */
  allocateHome: () => { tile: Tile; district: string }
  /**
   * Tell the allocator which tiles are already taken (call after loading state).
   */
  markOccupied: (tiles: ReadonlySet<string>) => void
  /**
   * Workplace id -> remaining vacancies.
   */
  openings: Map<LocationId, number>
  /**
   * Water regions (river, sea, lake). Empty for procedural cities.
   */
  water: WaterRegion[]
}

/**
 * Districts are geographic, not random. An agent's home district decides which
 * bar and which park they habitually use, so it has to mean "the part of town
 * I live in" — drawn from a hat it means nothing and every venue is equally
 * far from everyone.
 */
function districtOf(block: Block, layout: CityLayout, names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? 'Centro'
  if (block.ring <= 1) return names[0] ?? 'Centro'
  const c = (layout.blocksPerSide - 1) / 2
  const quadrant = (block.by <= c ? 0 : 2) + (block.bx <= c ? 0 : 1)
  return names[1 + (quadrant % (names.length - 1))] ?? names[0] ?? 'Centro'
}

/**
 * Rotates a list so successive worlds from different seeds do not look alike.
 */
function rotated<T>(items: T[], rng: () => number): T[] {
  if (items.length === 0) return items
  const k = Math.floor(rng() * items.length)
  return [...items.slice(k), ...items.slice(0, k)]
}

/**
 * Builds a city from config + seed. Same seed, same city — worlds must be
 * reproducible or a soak run tells you nothing about your change.
 *
 * Venues are placed onto street-facing plots inside blocks rather than onto a
 * bare spiral of tiles: a shop belongs on a corner with a road in front of it,
 * and that single constraint is most of what makes the map look inhabited.
 */
export function generateCity(
  config: CityConfig = DEFAULT_CITY,
  seed = 1,
  venueNameOverrides?: Partial<Record<LocationKind, readonly string[]>>,
): GeneratedCity {
  const rng = makeRng(seed)
  const layout = cityLayout(config.blocksPerSide)
  const locations: Location[] = []
  const openings = new Map<LocationId, number>()

  const civic = rotated(
    layout.blocks.filter((b) => b.role === 'civic'),
    rng,
  )
  const green = rotated(
    layout.blocks.filter((b) => b.role === 'green'),
    rng,
  )
  const residential = rotated(
    layout.blocks.filter((b) => b.role === 'residential'),
    rng,
  )

  // One venue per civic block before any block takes a second, so the centre
  // fills out evenly instead of stacking everything on the first corner.
  let civicSlot = 0
  const nextCivicPlot = (): { tile: Tile; block: Block } => {
    const block = civic[civicSlot % civic.length]!
    const round = Math.floor(civicSlot / civic.length)
    civicSlot++
    return { tile: block.plots[round % block.plots.length]!, block }
  }

  let greenSlot = 0
  const nextGreenBlock = (): Block => green[greenSlot++ % green.length]!

  const entries = Object.entries(config.venues) as [LocationKind, number][]
  for (const [kind, count] of entries) {
    const names = venueNameOverrides?.[kind] ?? VENUE_NAMES[kind] ?? []
    for (let i = 0; i < count; i++) {
      const id = `${kind}-${i + 1}`
      // A park is the whole block, so it sits at the block's middle rather than
      // on a street-facing plot like a building would.
      const { tile, block } =
        kind === 'park'
          ? (() => {
              const b = nextGreenBlock()
              return { tile: b.tiles[Math.floor(b.tiles.length / 2)]!, block: b }
            })()
          : nextCivicPlot()

      locations.push({
        id,
        kind,
        name: names[i] ?? `${kind} ${i + 1}`,
        district: districtOf(block, layout, config.districts),
        tile,
      })
      if (kind !== 'park') openings.set(id, config.openingsPerWorkplace)
    }
  }

  // Homes spread one per block before doubling up, so neighbours are actual
  // neighbours and the residential ring does not cluster into one corner.
  let homeSlot = 0
  const occupied = new Set<string>()
  const tileKey = (t: Tile): string => `${t.x},${t.y}`
  const totalPlots = residential.reduce((n, b) => n + b.plots.length, 0)

  const allocateHome = (): { tile: Tile; district: string } => {
    for (let attempt = 0; attempt < totalPlots; attempt++) {
      const block = residential[homeSlot % residential.length]!
      const round = Math.floor(homeSlot / residential.length)
      homeSlot++
      const tile = block.plots[round % block.plots.length]!
      const key = tileKey(tile)
      if (occupied.has(key)) continue
      occupied.add(key)
      return { tile, district: districtOf(block, layout, config.districts) }
    }
    // All plots exhausted — fall through to the raw counter (will overlap, but
    // better than crashing).
    const block = residential[homeSlot % residential.length]!
    const round = Math.floor(homeSlot / residential.length)
    homeSlot++
    const tile = block.plots[round % block.plots.length]!
    occupied.add(tileKey(tile))
    return { tile, district: districtOf(block, layout, config.districts) }
  }

  const markOccupied = (tiles: ReadonlySet<string>): void => {
    for (const t of tiles) occupied.add(t)
  }

  return { config, layout, locations, openings, allocateHome, markOccupied, water: [] }
}

/**
 * Every venue of one kind, for picking a bar or an office to send someone to.
 */
export const venuesOfKind = (city: GeneratedCity, kind: LocationKind): Location[] =>
  city.locations.filter((l) => l.kind === kind)

// ---- template I/O -----------------------------------------------------------

/**
 * Rebuilds a city from a baked template, so a world keeps its map across changes.
 */
export function cityFromTemplate(t: CityTemplate): GeneratedCity {
  const blocksPerSide = Math.floor((t.grid.width - 1) / t.streetPeriod)
  const c = Math.floor(blocksPerSide / 2)
  const bs = t.streetPeriod - 1

  const layout: CityLayout = {
    grid: t.grid,
    streetPeriod: t.streetPeriod,
    blocksPerSide,
    blocks: t.blocks.map((b) => {
      const ox = b.bx * t.streetPeriod + 1
      const oy = b.by * t.streetPeriod + 1
      const ring = Math.max(Math.abs(b.bx - c), Math.abs(b.by - c))
      const tiles: Tile[] = []
      const frontage: Tile[] = []
      for (let ly = 0; ly < bs; ly++) {
        for (let lx = 0; lx < bs; lx++) {
          const tile = { x: ox + lx, y: oy + ly }
          tiles.push(tile)
          if (lx > 0 && lx < bs - 1 && ly > 0 && ly < bs - 1) continue
          frontage.push(tile)
        }
      }
      const plots = tiles.slice()
      return { bx: b.bx, by: b.by, role: b.role, ring, tiles, frontage, plots }
    }),
    centre: {
      x: c * t.streetPeriod + Math.floor(bs / 2) + 1,
      y: c * t.streetPeriod + Math.floor(bs / 2) + 1,
    },
  }

  const locations: Location[] = []
  const openings = new Map<LocationId, number>()
  const kindCount = new Map<string, number>()
  for (const v of t.venues) {
    const n = (kindCount.get(v.kind) ?? 0) + 1
    kindCount.set(v.kind, n)
    const id = `${v.kind}-${n}`
    locations.push({ id, kind: v.kind, name: v.name, district: v.district, tile: { x: v.x, y: v.y } })
    if (v.kind !== 'park') openings.set(id, t.openingsPerWorkplace)
  }

  let homeSlot = 0
  const occupied = new Set<string>()
  const tileKey = (x: number, y: number): string => `${x},${y}`

  const allocateHome = (): { tile: Tile; district: string } => {
    for (let attempt = 0; attempt < t.homePlots.length; attempt++) {
      const plot = t.homePlots[homeSlot % t.homePlots.length]!
      homeSlot++
      const key = tileKey(plot.x, plot.y)
      if (occupied.has(key)) continue
      occupied.add(key)
      return { tile: { x: plot.x, y: plot.y }, district: plot.district }
    }
    const plot = t.homePlots[homeSlot % t.homePlots.length]!
    homeSlot++
    occupied.add(tileKey(plot.x, plot.y))
    return { tile: { x: plot.x, y: plot.y }, district: plot.district }
  }

  const markOccupied = (tiles: ReadonlySet<string>): void => {
    for (const k of tiles) occupied.add(k)
  }

  const config: CityConfig = {
    name: t.name,
    blocksPerSide: layout.blocksPerSide,
    districts: [...t.districts],
    venues: Object.fromEntries([...kindCount]),
    openingsPerWorkplace: t.openingsPerWorkplace,
  }

  return { config, layout, locations, openings, allocateHome, markOccupied, water: t.water ?? [] }
}

/**
 * Freezes a generated city into a template. Used by `src/dev/bake-cities.ts`.
 */
export function exportTemplate(city: GeneratedCity, seed: number): CityTemplate {
  const residential = city.layout.blocks.filter((b) => b.role === 'residential')
  const rng = makeRng(seed)
  const rotK = Math.floor(rng() * residential.length)
  const ordered = [...residential.slice(rotK), ...residential.slice(0, rotK)]

  const homePlots: CityTemplate['homePlots'] = []
  for (const block of ordered) {
    for (const plot of block.plots) {
      const c = (city.layout.blocksPerSide - 1) / 2
      const names = city.config.districts
      let district: string
      if (block.ring <= 1) district = names[0] ?? 'Centro'
      else {
        const quadrant = (block.by <= c ? 0 : 2) + (block.bx <= c ? 0 : 1)
        district = names[1 + (quadrant % (names.length - 1))] ?? names[0] ?? 'Centro'
      }
      homePlots.push({ x: plot.x, y: plot.y, district })
    }
  }

  return {
    name: city.config.name,
    grid: city.layout.grid,
    streetPeriod: city.layout.streetPeriod,
    districts: [...city.config.districts],
    blocks: city.layout.blocks.map((b) => ({ bx: b.bx, by: b.by, role: b.role })),
    venues: city.locations.map((l) => ({
      kind: l.kind as Exclude<LocationKind, 'home'>,
      name: l.name,
      x: l.tile.x,
      y: l.tile.y,
      district: l.district,
    })),
    homePlots,
    openingsPerWorkplace: city.config.openingsPerWorkplace,
  }
}
