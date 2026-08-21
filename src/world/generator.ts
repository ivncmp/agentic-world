import type { CityConfig } from './config.js'
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
  school: ['IES Vallecar', 'Colegio Ribera'],
  gym: ['Gimnasio Titán', 'BoxAltos'],
  park: ['Parque del Puerto', 'Jardines Ribera', 'Plaza Mayor', 'Parque Norte'],
  garage: ['Talleres Ruiz', 'AutoPuerto'],
}

export type GeneratedCity = {
  config: CityConfig
  layout: CityLayout
  locations: Location[]
  /**
   * Allocates a home plot on a residential block. Homes are created with their
   * resident rather than up front, so this has to keep handing out fresh ground
   * as agents join.
   */
  allocateHome: () => { tile: Tile; district: string }
  /** Workplace id -> remaining vacancies. */
  openings: Map<LocationId, number>
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

/** Rotates a list so successive worlds from different seeds do not look alike. */
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
export function generateCity(config: CityConfig = DEFAULT_CITY, seed = 1): GeneratedCity {
  const rng = makeRng(seed)
  const layout = cityLayout(config.blocksPerSide)
  const locations: Location[] = []
  const openings = new Map<LocationId, number>()

  const civic = rotated(layout.blocks.filter((b) => b.role === 'civic'), rng)
  const green = rotated(layout.blocks.filter((b) => b.role === 'green'), rng)
  const residential = rotated(layout.blocks.filter((b) => b.role === 'residential'), rng)

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
    const names = VENUE_NAMES[kind] ?? []
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
  const allocateHome = (): { tile: Tile; district: string } => {
    const block = residential[homeSlot % residential.length]!
    const round = Math.floor(homeSlot / residential.length)
    homeSlot++
    return {
      tile: block.plots[round % block.plots.length]!,
      district: districtOf(block, layout, config.districts),
    }
  }

  return { config, layout, locations, openings, allocateHome }
}

export const venuesOfKind = (city: GeneratedCity, kind: LocationKind): Location[] =>
  city.locations.filter((l) => l.kind === kind)
