/**
 * Isometric projection, sized to the Kenney tile family the viewer draws with.
 *
 * Two anchors matter and they are not the same. A ground tile is a slab whose
 * *top face* is the ground plane; anything standing on that ground — a
 * building, a tree, a lamp post — is a block whose *base* must land on it. Mix
 * them up and the city sinks into the earth or floats above it.
 */

/** Top-face diamond of one tile. 2:1, so the whole family lines up. */
export const TILE_W = 100
export const TILE_H = 50

/** Screen rise of one stacked storey, measured off the sprites themselves. */
export const STOREY = 34

/** A ground tile's top-face centre, below the top edge of its sprite. */
export const GROUND_ANCHOR_Y = 25

/** Any block sprite's base-diamond centre, above the bottom edge of its sprite. */
export const BASE_ANCHOR_Y = 25

/** Camera orientation, in 90° steps. */
export type Rot = 0 | 1 | 2 | 3

/**
 * Rotates a tile coordinate inside a square grid. Works on fractions, because
 * agents sit between tiles while they walk.
 */
export function rotateTile(x: number, y: number, rot: Rot, n: number): { x: number; y: number } {
  const m = n - 1
  switch (rot) {
    case 1: return { x: y, y: m - x }
    case 2: return { x: m - x, y: m - y }
    case 3: return { x: m - y, y: x }
    default: return { x, y }
  }
}

export function toScreen(x: number, y: number): { px: number; py: number } {
  return { px: (x - y) * (TILE_W / 2), py: (x + y) * (TILE_H / 2) }
}

/**
 * Painter's order. Tiles further back draw first; `layer` separates things
 * sharing a tile — ground, then whatever stands on it, then people, then the
 * bubble above their heads.
 */
export const LAYER = {
  ground: 0,
  decal: 1,
  building: 2,
  prop: 3,
  agent: 4,
  label: 5,
  bubble: 6,
} as const

export const depthAt = (x: number, y: number, layer: number): number =>
  (x + y) * 16 + layer

/**
 * Kenney names a tile's connections on the world compass, and the four names
 * are the four edges of the diamond. Measured against the sprites: a `roadNS`
 * laid repeatedly along +x forms one continuous street, so N/S are the ±x
 * neighbours and E/W the ∓y ones.
 */
export const DIR = {
  N: { dx: -1, dy: 0, bit: 1 },
  E: { dx: 0, dy: -1, bit: 2 },
  S: { dx: 1, dy: 0, bit: 4 },
  W: { dx: 0, dy: 1, bit: 8 },
} as const

/**
 * Turning the camera turns which world edge points which way on screen, so a
 * connection mask has to turn with it. One step anticlockwise sends N→W, W→S,
 * S→E, E→N — that is each bit moving three places round a four-place ring.
 */
export function rotateMask(mask: number, rot: Rot): number {
  let out = 0
  for (let i = 0; i < 4; i++) {
    if ((mask & (1 << i)) !== 0) out |= 1 << ((i + 3 * rot) % 4)
  }
  return out
}
