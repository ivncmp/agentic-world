/**
 * Which Kenney sprite stands for what.
 *
 * Two packs, one scale: the roads pack draws the ground (its files are named
 * for the connections they make, so a street is a lookup rather than a guess),
 * and the buildings pack draws what stands on it. Their tiles are 100px and
 * 99px wide respectively — the same family, which is why they can share a grid.
 *
 * Everything here is CC0. Regenerating the city must never need an artist.
 */

const KENNEY = 'assets/kenney'
export const ROADS_DIR = `${KENNEY}/isometric-roads/png`
export const BUILDINGS_DIR = `${KENNEY}/isometric-buildings/PNG`
export const DETAILS_DIR = `${KENNEY}/isometric-city/Details`

/** Ground slabs. Anchored by their top face — that face *is* the ground. */
export const GROUND_KEYS = [
  'grass', 'road', 'dirt', 'dirtDouble', 'water',
  'roadNS', 'roadEW', 'roadNE', 'roadNW', 'roadES', 'roadSW',
  'crossroad', 'crossroadNES', 'crossroadNEW', 'crossroadNSW', 'crossroadESW',
  'endN', 'endE', 'endS', 'endW',
] as const

/**
 * Things that stand on the ground. Unlike a slab or a building these have no
 * base diamond — the bottom of the sprite is where it touches — so they anchor
 * at the tile's centre rather than at its front corner.
 */
export const PROP_KEYS = [
  'treeTall', 'treeShort', 'treeAltTall', 'treeAltShort',
  'coniferTall', 'coniferShort', 'coniferAltTall', 'coniferAltShort',
] as const

/**
 * Street furniture, borrowed from the 132px pack. Nothing else there is usable
 * at this scale, but a lamp post is thin and vertical, so shrinking it to the
 * 100px grid costs nothing and a lit street at night is worth the seam.
 */
export const DETAIL_SPRITES: Record<string, string> = {
  'lamp-single': 'cityDetails_005',
  'lamp-double': 'cityDetails_006',
  'lamp-short': 'cityDetails_007',
  bench: 'cityDetails_001',
  planter: 'cityDetails_004',
}
export const DETAIL_SCALE = 100 / 132

export type GroundKey = (typeof GROUND_KEYS)[number]
export type PropKey = (typeof PROP_KEYS)[number] | keyof typeof DETAIL_SPRITES

/** One thing standing on a tile, optionally nudged off its centre. */
export type Prop = { key: string; ox?: number; oy?: number }

/**
 * Street sprite by connection mask, in *screen* space — the mask is rotated
 * with the camera before it gets here, so the four names always mean the four
 * edges you can actually see.
 */
export const ROAD_BY_MASK: Record<number, GroundKey> = {
  0b1111: 'crossroad',
  0b0111: 'crossroadNES',
  0b1011: 'crossroadNEW',
  0b1101: 'crossroadNSW',
  0b1110: 'crossroadESW',
  0b0101: 'roadNS',
  0b1010: 'roadEW',
  0b0011: 'roadNE',
  0b1001: 'roadNW',
  0b0110: 'roadES',
  0b1100: 'roadSW',
  0b0001: 'endN',
  0b0010: 'endE',
  0b0100: 'endS',
  0b1000: 'endW',
  0b0000: 'road',
}

// ---- buildings -------------------------------------------------------------

/**
 * A building is stacked, not picked: a ground floor, some storeys, a roof. That
 * is what lets ten venue kinds and a hundred filler houses come out of eighty
 * sprites and still look like a skyline rather than a repeating pattern.
 */
export type Recipe = {
  /** Ground floor — the one with a shopfront or a door. */
  ground: readonly number[]
  /** Storeys stacked above it. */
  mid: readonly number[]
  /** Inclusive range of extra storeys. */
  floors: readonly [number, number]
  roof: readonly number[]
}

const FLAT_ROOF = [5, 6, 13, 118, 119, 120, 121, 126, 127, 128]
const GABLE_ROOF = [62, 65, 66, 69, 70, 74, 75, 76, 77, 80, 82, 83, 84, 88, 90, 91, 96, 98, 104, 112]

/**
 * Height is zoning. The civic ring gets offices tall enough to read as a centre
 * and the residential ring stays low, so the skyline says where you are.
 */
export const RECIPES: Record<string, Recipe> = {
  home:        { ground: [39, 44, 48, 51, 32], mid: [39, 48],         floors: [0, 1], roof: GABLE_ROOF },
  bar:         { ground: [16, 23],             mid: [45, 49, 52],     floors: [0, 1], roof: FLAT_ROOF },
  office:      { ground: [0, 8],               mid: [50, 55, 56],     floors: [2, 3], roof: FLAT_ROOF },
  shop:        { ground: [7, 24],              mid: [48],             floors: [0, 0], roof: FLAT_ROOF },
  supermarket: { ground: [33, 35],             mid: [],               floors: [0, 0], roof: FLAT_ROOF },
  clinic:      { ground: [8],                  mid: [53, 55, 56],     floors: [1, 2], roof: FLAT_ROOF },
  school:      { ground: [31],                 mid: [44, 51],         floors: [1, 2], roof: FLAT_ROOF },
  gym:         { ground: [0],                  mid: [43, 47],         floors: [1, 1], roof: FLAT_ROOF },
  garage:      { ground: [7],                  mid: [38],             floors: [0, 0], roof: FLAT_ROOF },
  cinema:      { ground: [36, 40],             mid: [49, 52],         floors: [0, 1], roof: FLAT_ROOF },
  bowling:     { ground: [33, 41],             mid: [],               floors: [0, 0], roof: FLAT_ROOF },
  cafe:        { ground: [42, 37],             mid: [53],             floors: [0, 0], roof: GABLE_ROOF },
  /** Scenery. Nobody lives here; it exists so the blocks are not half empty. */
  filler:      { ground: [0, 7, 8, 24, 39, 44, 48, 32], mid: [39, 48, 50, 55], floors: [0, 1], roof: [...GABLE_ROOF, ...FLAT_ROOF] },
  /** Taller scenery for the middle of town. */
  fillerTall:  { ground: [0, 8, 15, 24],       mid: [50, 55, 56, 45], floors: [1, 3], roof: FLAT_ROOF },
}

/** Every building tile any recipe can ask for, so preload can be exact. */
export const BUILDING_TILES: readonly number[] = [
  ...new Set(
    Object.values(RECIPES).flatMap((r) => [...r.ground, ...r.mid, ...r.roof]),
  ),
].sort((a, b) => a - b)

export const buildingKey = (n: number): string => `bld-${n}`
export const buildingPath = (n: number): string =>
  `${BUILDINGS_DIR}/buildingTiles_${String(n).padStart(3, '0')}.png`

/** Stable per-id hash: the same venue draws the same building every reload. */
export function hash(...parts: (string | number)[]): number {
  let h = 2166136261
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

const pickFrom = <T>(xs: readonly T[], seed: number): T => xs[seed % xs.length]!

/**
 * Bottom-to-top list of sprite numbers for one building.
 *
 * `storeyBias` is zoning: the same shop is a taller building downtown than it
 * is three streets out. Without it every block has the same skyline and the
 * map stops telling you where the centre of town is.
 */
export function composeBuilding(recipeName: string, key: string, storeyBias = 0): number[] {
  const r = RECIPES[recipeName] ?? RECIPES.filler!
  const [lo, hi] = r.floors
  const extra = Math.max(0, lo + (hash(key, 'n') % (hi - lo + 1)) + storeyBias)
  const layers = [pickFrom(r.ground, hash(key, 'g'))]
  const pool = r.mid.length > 0 ? r.mid : r.ground
  for (let i = 0; i < extra; i++) layers.push(pickFrom(pool, hash(key, 'm', i)))
  layers.push(pickFrom(r.roof, hash(key, 'r')))
  return layers
}

/** A dot colour per venue kind, so a label says what a place is at a glance. */
export const KIND_COLOR: Record<string, number> = {
  home: 0x94a3b8, bar: 0xc084fc, office: 0x60a5fa, shop: 0xfbbf24,
  supermarket: 0x34d399, clinic: 0xf87171, school: 0x38bdf8,
  gym: 0xfb923c, park: 0x4ade80, garage: 0xa8a29e,
  cinema: 0xe879f9, bowling: 0xf472b6, cafe: 0xfcd34d,
}
