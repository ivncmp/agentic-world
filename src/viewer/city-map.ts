/**
 * Turns what the engine knows (a grid size, a street period, block roles and a
 * list of venues) into what a picture needs: for every tile, a slab, whatever
 * is built on it, and whatever stands around it.
 *
 * Built once at boot and then only read. The one thing left to the renderer is
 * which street sprite a tile uses, because that depends on the camera.
 */
import { DIR } from './iso.js'
import { composeBuilding, hash, type GroundKey, type Prop } from './atlas.js'
import type { WorldInfo, LocationInfo, BlockInfo } from './connection.js'

export type Cell = {
  x: number
  y: number
  /** Resolved slab, except for streets which pick their sprite at draw time. */
  ground: GroundKey | 'street'
  /** Street connections in world space; rotated with the camera when drawn. */
  mask: number
  /** The place the simulation knows about, if this tile is one. */
  venue: LocationInfo | null
  /** Sprite numbers bottom-to-top, for a venue or for pure scenery. */
  building: number[] | null
  props: Prop[]
}

export type CityMap = {
  size: number
  cells: Cell[]
  venues: Cell[]
}

const TREES = ['treeTall', 'treeShort', 'treeAltTall', 'treeAltShort']
const CONIFERS = ['coniferTall', 'coniferShort', 'coniferAltTall', 'coniferAltShort']

/**
 * Extra storeys by block role. The civic ring is where the offices are and the
 * outskirts are houses, so the skyline reads as a centre with suburbs around it
 * rather than as one uniform height everywhere.
 */
const STOREY_BIAS: Record<BlockInfo['role'], number> = {
  plaza: 0, civic: 1, residential: -1, green: 0,
}

export function buildCityMap(world: WorldInfo): CityMap {
  const size = world.city.grid.width
  const period = world.city.streetPeriod
  const isStreet = (x: number, y: number): boolean => x % period === 0 || y % period === 0
  const inGrid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < size && y < size

  const roleAt = new Map<string, BlockInfo['role']>()
  for (const b of world.city.blocks) roleAt.set(`${b.bx},${b.by}`, b.role)

  const venueAt = new Map<string, LocationInfo>()
  for (const l of world.locations) venueAt.set(`${l.x},${l.y}`, l)

  const cells: Cell[] = []
  const venues: Cell[] = []

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isStreet(x, y)) {
        let mask = 0
        for (const d of Object.values(DIR)) {
          if (inGrid(x + d.dx, y + d.dy) && isStreet(x + d.dx, y + d.dy)) mask |= d.bit
        }
        const cell: Cell = { x, y, ground: 'street', mask, venue: null, building: null, props: [] }
        // A lamp on every fourth corner: enough to line the streets at night,
        // sparse enough not to turn the map into a forest of poles.
        const junction = x % period === 0 && y % period === 0
        if (junction && hash(x, y, 'lamp') % 100 < 55) {
          cell.props.push({ key: hash(x, y, 'l2') % 3 === 0 ? 'lamp-double' : 'lamp-single' })
        }
        cells.push(cell)
        continue
      }

      const bx = Math.floor(x / period)
      const by = Math.floor(y / period)
      const role = roleAt.get(`${bx},${by}`) ?? 'residential'
      const venue = venueAt.get(`${x},${y}`) ?? null
      // Position inside the block, 0..2 — the middle row and column are the
      // spine that plazas and parks are laid out around.
      const lx = (x % period) - 1
      const ly = (y % period) - 1
      const middle = lx === 1 && ly === 1

      const cell: Cell = {
        x, y,
        ground: 'grass',
        mask: 0,
        venue,
        building: null,
        props: [],
      }

      if (role === 'plaza') {
        decoratePlaza(cell, lx, ly, middle)
      } else if (role === 'green') {
        decoratePark(cell, x, y, lx, ly, middle)
      } else if (venue != null && venue.kind !== 'park') {
        cell.building = composeBuilding(venue.kind, venue.id, STOREY_BIAS[role])
      } else {
        // Scenery fills the plots a venue did not take, so a block is a row of
        // buildings rather than one shop alone in a field.
        const onPlot = !middle && (lx !== 1 || ly !== 1)
        if (onPlot && lx !== 1 && ly !== 1 && hash(x, y, 'fill') % 100 < 58) {
          cell.building = composeBuilding(
            role === 'civic' ? 'fillerTall' : 'filler',
            `f${x}-${y}`,
            STOREY_BIAS[role],
          )
        } else if (hash(x, y, 'gtree') % 100 < 30) {
          cell.props.push({ key: TREES[hash(x, y, 'g') % TREES.length]! })
        }
      }

      cells.push(cell)
      if (venue != null) venues.push(cell)
    }
  }

  return { size, cells, venues }
}

/**
 * The main square: paving, a fountain in the middle, and trees on the corners
 * in a deliberate pattern. Scattering the trees randomly here is what made it
 * read as waste ground rather than as the centre of the town.
 */
function decoratePlaza(cell: Cell, lx: number, ly: number, middle: boolean): void {
  cell.ground = 'dirt'
  if (middle) {
    cell.ground = 'water' // the fountain basin
    return
  }
  const corner = (lx === 0 || lx === 2) && (ly === 0 || ly === 2)
  const edge = (lx === 1) !== (ly === 1)
  if (corner) {
    cell.props.push({ key: 'coniferTall' })
    cell.props.push({ key: 'lamp-short', ox: 0.34, oy: 0.34 })
  } else if (edge) {
    cell.props.push({ key: 'bench', ox: -0.2, oy: 0.2 })
  }
}

/**
 * A park is a planted block with a path through it, not a lawn with four trees
 * dropped on it. The cross of paths is what makes it look walked-through.
 */
function decoratePark(cell: Cell, x: number, y: number, lx: number, ly: number, middle: boolean): void {
  const onPath = lx === 1 || ly === 1
  if (middle) {
    cell.ground = 'water' // a pond where the paths meet
    return
  }
  if (onPath) {
    cell.ground = 'dirt'
    if (hash(x, y, 'plamp') % 100 < 45) {
      cell.props.push({ key: 'lamp-short', ox: 0.3, oy: -0.3 })
    }
    return
  }
  // Off the path it is dense planting — two trees where there is room.
  const pool = hash(x, y, 'conif') % 100 < 40 ? CONIFERS : TREES
  cell.props.push({ key: pool[hash(x, y, 'k') % pool.length]!, ox: -0.18, oy: -0.12 })
  if (hash(x, y, 'second') % 100 < 55) {
    cell.props.push({ key: TREES[hash(x, y, 'k2') % TREES.length]!, ox: 0.22, oy: 0.2 })
  }
}
