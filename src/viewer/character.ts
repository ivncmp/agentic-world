/**
 * People, from sprite sheets baked out of Kenney's rigged Mini Characters.
 *
 * The models are 3D with real skeletal animation; `tools/render-characters`
 * renders them once into 8-direction sheets so the runtime stays 2D. Frame
 * geometry here must match that tool's constants — it is the one coupling
 * between the two, and it is why they are stated as named constants on both
 * sides rather than sprinkled as numbers.
 */
import Phaser from 'phaser'
import { hash } from './atlas.js'

export const CHARACTER_IDS = [
  'female-a', 'female-b', 'female-c', 'female-d', 'female-e', 'female-f',
  'male-a', 'male-b', 'male-c', 'male-d', 'male-e', 'male-f',
] as const

export const SHEET_DIR = 'assets/characters'
export const FRAME_SIZE = 80
const COLS = 8
const DIRS = 8

/** Measured by the baker: where the feet sit inside a frame, as a fraction. */
const FOOT_ORIGIN_Y = 0.7514

/** Drawn height ends up near 32px — a little under one storey, as it should. */
const SCALE = 0.7

/** Row order in the sheet. Must match the baker's ANIMS. */
const ANIMS = {
  idle: { row: 0, frames: 4, fps: 6 },
  walk: { row: 1, frames: 8, fps: 13 },
  sit: { row: 2, frames: 2, fps: 2 },
  talk: { row: 3, frames: 4, fps: 5 },
} as const

export type AnimName = keyof typeof ANIMS

/**
 * What an agent's current activity looks like from outside. `sit` covers the
 * indoor, stationary half of a life — there is no lying-down clip, and a
 * sleeping agent is behind a wall anyway.
 */
export function animForState(state: string): AnimName {
  switch (state) {
    case 'travel': return 'walk'
    case 'scene': return 'talk'
    case 'work': case 'relax': case 'eat': case 'browse': case 'sleep': return 'sit'
    default: return 'idle'
  }
}

export const sheetKeyFor = (seed: string): string => {
  const id = CHARACTER_IDS[hash(seed, 'who') % CHARACTER_IDS.length]!
  return `char-${id}`
}

/**
 * Screen heading to sheet direction.
 *
 * Direction 1 in the sheet is the model turned to face the camera — straight
 * down the screen — and successive directions turn anticlockwise from there.
 */
const FACING_CAMERA_DIR = 1

export function dirFor(dx: number, dy: number, fallback = FACING_CAMERA_DIR): number {
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) return fallback
  // Into screen space first: +x runs down-right and +y down-left, so a tile
  // delta is not a screen delta and the angle would be wrong without this.
  const sx = dx - dy
  const sy = (dx + dy) * 0.5
  const deg = (Math.atan2(sy, sx) * 180) / Math.PI
  const steps = Math.round((90 - deg) / (360 / DIRS))
  return (((steps + FACING_CAMERA_DIR) % DIRS) + DIRS) % DIRS
}

const frameIndex = (anim: AnimName, dir: number, f: number): number =>
  (ANIMS[anim].row * DIRS + dir) * COLS + f

export class Character {
  readonly container: Phaser.GameObjects.Container
  private readonly sprite: Phaser.GameObjects.Sprite
  private readonly shadow: Phaser.GameObjects.Ellipse
  private anim: AnimName = 'idle'
  private dir = FACING_CAMERA_DIR
  private clock = 0

  constructor(scene: Phaser.Scene, seed: string) {
    this.shadow = scene.add.ellipse(0, -1, 22 * SCALE, 9 * SCALE, 0x000000, 0.3)
    this.sprite = scene.add
      .sprite(0, 0, sheetKeyFor(seed), frameIndex('idle', FACING_CAMERA_DIR, 0))
      .setOrigin(0.5, FOOT_ORIGIN_Y)
      .setScale(SCALE)
    this.container = scene.add.container(0, 0, [this.shadow, this.sprite])
  }

  update(dt: number, anim: AnimName, dir: number): void {
    if (anim !== this.anim) {
      this.anim = anim
      this.clock = 0
    }
    this.dir = dir
    const spec = ANIMS[anim]
    this.clock += dt
    const f = Math.floor((this.clock / 1000) * spec.fps) % spec.frames
    this.sprite.setFrame(frameIndex(anim, dir, f))
  }

  destroy(): void {
    this.container.destroy()
  }
}

/** Every sheet the viewer needs, for preload. */
export const characterSheets = (): { key: string; path: string }[] =>
  CHARACTER_IDS.map((id) => ({
    key: `char-${id}`,
    path: `${SHEET_DIR}/character-${id}.png`,
  }))
