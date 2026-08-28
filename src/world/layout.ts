/**
 * A city is streets first and buildings second.
 *
 * The layout lays a one-tile street along every `STREET_PERIOD`-th row and
 * column, which leaves square blocks of buildable ground between them. That is
 * the whole trick: venues placed on a bare grid read as objects scattered in a
 * field, and the same venues placed along streets read as a town.
 *
 * Streets are a pure function of (x, y). The viewer re-derives them from
 * `grid` + `streetPeriod` instead of the server shipping a tilemap, so the two
 * cannot drift apart — there is only one rule and both sides evaluate it.
 */
import type { Tile } from './locations.js'

/** Buildable tiles along one edge of a block. */
export const BLOCK_SIZE = 3
/** Block plus the street that follows it. */
export const STREET_PERIOD = BLOCK_SIZE + 1

export const isStreet = (x: number, y: number, period = STREET_PERIOD): boolean =>
  x % period === 0 || y % period === 0

/**
 * What a block is for. Roles come from the ring, so a city always has a centre
 * that is public, a commercial belt around it, and homes further out — the
 * shape that makes a commute, and therefore a rhythm to the day.
 */
export type BlockRole = 'plaza' | 'green' | 'civic' | 'residential' | 'harbor' | 'sea'

export type Block = {
  bx: number
  by: number
  role: BlockRole
  /** Chebyshev distance from the centre block. */
  ring: number
  /** Every buildable tile, row-major. */
  tiles: Tile[]
  /**
   * Tiles that touch a street. Buildings go here so they face the road; the
   * one interior tile stays an inner courtyard.
   */
  frontage: Tile[]
  /** Building plots in placement order — corners first, they read best. */
  plots: Tile[]
}

export type CityLayout = {
  grid: { width: number; height: number }
  streetPeriod: number
  blocksPerSide: number
  blocks: Block[]
  /** The middle of the map, where the plaza is. */
  centre: Tile
}

/** Local offsets within a block, corners first then edge midpoints. */
const PLOT_ORDER: readonly [number, number][] = [
  [0, 0], [2, 2], [2, 0], [0, 2], [1, 0], [0, 1], [2, 1], [1, 2],
]

/**
 * Green blocks sit at the four compass points two rings out, so every
 * residential corner has a park within a couple of streets.
 */
const isGreenBlock = (bx: number, by: number, c: number): boolean =>
  (bx === c && Math.abs(by - c) === 2) || (by === c && Math.abs(bx - c) === 2)

export function cityLayout(blocksPerSide = 5): CityLayout {
  const period = STREET_PERIOD
  const span = blocksPerSide * period + 1
  const c = Math.floor(blocksPerSide / 2)
  const blocks: Block[] = []

  for (let by = 0; by < blocksPerSide; by++) {
    for (let bx = 0; bx < blocksPerSide; bx++) {
      const ring = Math.max(Math.abs(bx - c), Math.abs(by - c))
      const role: BlockRole =
        ring === 0 ? 'plaza'
          : isGreenBlock(bx, by, c) ? 'green'
            : ring === 1 ? 'civic'
              : 'residential'

      const ox = bx * period + 1
      const oy = by * period + 1
      const tiles: Tile[] = []
      const frontage: Tile[] = []
      for (let ly = 0; ly < BLOCK_SIZE; ly++) {
        for (let lx = 0; lx < BLOCK_SIZE; lx++) {
          const t = { x: ox + lx, y: oy + ly }
          tiles.push(t)
          const interior = lx > 0 && lx < BLOCK_SIZE - 1 && ly > 0 && ly < BLOCK_SIZE - 1
          if (!interior) frontage.push(t)
        }
      }
      const plots = PLOT_ORDER.map(([lx, ly]) => ({ x: ox + lx, y: oy + ly }))

      blocks.push({ bx, by, role, ring, tiles, frontage, plots })
    }
  }

  return {
    grid: { width: span, height: span },
    streetPeriod: period,
    blocksPerSide,
    blocks,
    centre: { x: c * period + BLOCK_SIZE / 2 + 0.5, y: c * period + BLOCK_SIZE / 2 + 0.5 },
  }
}

/** Which block a tile falls in, or null when it is standing in the street. */
export function blockAt(layout: CityLayout, x: number, y: number): Block | null {
  if (isStreet(x, y, layout.streetPeriod)) return null
  const bx = Math.floor(x / layout.streetPeriod)
  const by = Math.floor(y / layout.streetPeriod)
  return layout.blocks.find((b) => b.bx === bx && b.by === by) ?? null
}

export const blocksOfRole = (layout: CityLayout, role: BlockRole): Block[] =>
  layout.blocks.filter((b) => b.role === role)
