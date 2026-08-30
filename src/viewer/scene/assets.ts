/**
 * The Kenney GLB catalogue and the loader that normalises it.
 *
 * Every pack models at its own scale and origin, so each model is rescaled to
 * the tile and re-seated on the ground at load time. Road pieces are the one
 * exception: they all share `road-straight`'s scale so the strips line up.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { CHARACTER_IDS, CHARACTER_GLB } from '../core/characters-data.js'
import { TILE } from './grid.js'
import type { LocationInfo } from '../core/connection.js'

const GLB = (pack: string, name: string) => `/assets/city/${pack}/Models/GLB format/${name}.glb`

/**
 * Every GLB the scene needs, keyed by the short name the placers use.
 */
export const MODELS_TO_LOAD: Record<string, string> = {
  'com-a': GLB('commercial', 'building-a'),
  'com-c': GLB('commercial', 'building-c'),
  'com-e': GLB('commercial', 'building-e'),
  'com-g': GLB('commercial', 'building-g'),
  'com-h': GLB('commercial', 'building-h'),
  'com-j': GLB('commercial', 'building-j'),
  'com-l': GLB('commercial', 'building-l'),
  'com-n': GLB('commercial', 'building-n'),
  'sky-a': GLB('commercial', 'building-skyscraper-a'),
  'sky-c': GLB('commercial', 'building-skyscraper-c'),
  'sky-e': GLB('commercial', 'building-skyscraper-e'),
  'low-a': GLB('commercial', 'low-detail-building-a'),
  'low-d': GLB('commercial', 'low-detail-building-d'),
  'low-g': GLB('commercial', 'low-detail-building-g'),
  'low-j': GLB('commercial', 'low-detail-building-j'),
  parasol: GLB('commercial', 'detail-parasol-a'),
  'parasol-b': GLB('commercial', 'detail-parasol-b'),
  awning: GLB('commercial', 'detail-awning'),
  overhang: GLB('commercial', 'detail-overhang'),
  'sub-b': GLB('suburban', 'building-type-b'),
  'sub-d': GLB('suburban', 'building-type-d'),
  'sub-f': GLB('suburban', 'building-type-f'),
  'sub-h': GLB('suburban', 'building-type-h'),
  'sub-k': GLB('suburban', 'building-type-k'),
  'sub-n': GLB('suburban', 'building-type-n'),
  'sub-q': GLB('suburban', 'building-type-q'),
  'sub-t': GLB('suburban', 'building-type-t'),
  'ind-a': GLB('industrial', 'building-a'),
  'ind-d': GLB('industrial', 'building-d'),
  'ind-h': GLB('industrial', 'building-h'),
  'ind-l': GLB('industrial', 'building-l'),
  chimney: GLB('industrial', 'chimney-medium'),
  'chimney-sm': GLB('industrial', 'chimney-small'),
  tank: GLB('industrial', 'detail-tank'),
  'tree-lg': GLB('suburban', 'tree-large'),
  'tree-sm': GLB('suburban', 'tree-small'),
  fence: GLB('suburban', 'fence'),
  'fence-low': GLB('suburban', 'fence-low'),
  planter: GLB('suburban', 'planter'),
  'path-stones': GLB('suburban', 'path-stones-short'),
  driveway: GLB('suburban', 'driveway-short'),
  'rd-straight': GLB('roads', 'road-straight'),
  'rd-crossroad': GLB('roads', 'road-crossroad'),
  'rd-intersection': GLB('roads', 'road-intersection'),
  'rd-bend': GLB('roads', 'road-bend'),
  'rd-end': GLB('roads', 'road-end'),
  'rd-crossing': GLB('roads', 'road-crossing'),
  'light-curved': GLB('roads', 'light-curved'),
  'light-square': GLB('roads', 'light-square'),
  'traffic-light': GLB('roads', 'traffic-light'),
  dumpster: GLB('roads', 'dumpster'),
  cone: GLB('roads', 'construction-cone'),
  barrier: GLB('roads', 'construction-barrier'),
  'elec-pole': GLB('roads', 'electricity-pole-single'),
}

/**
 * Pools a filler tile draws from, chosen by hash so the town looks the same everywhere.
 */
export const COMMERCIAL_POOL = ['com-a', 'com-c', 'com-e', 'com-g', 'com-h', 'com-j', 'com-l', 'com-n']
/**
 * Towers, for offices and the civic core.
 */
export const SKYSCRAPER_POOL = ['sky-a', 'sky-c', 'sky-e']
/**
 * Cheap filler for the back of a civic block, where nobody looks closely.
 */
export const LOW_DETAIL_POOL = ['low-a', 'low-d', 'low-g', 'low-j']
/**
 * Houses, for residential blocks outside the Ironworks.
 */
export const SUBURBAN_POOL = ['sub-b', 'sub-d', 'sub-f', 'sub-h', 'sub-k', 'sub-n', 'sub-q', 'sub-t']
/**
 * Sheds and units, for the Ironworks and the harbour.
 */
export const INDUSTRIAL_POOL = ['ind-a', 'ind-d', 'ind-h', 'ind-l']

/**
 * Which models suit which venue kind, so a bar never looks like a factory.
 */
export const VENUE_MODELS: Record<string, string[]> = {
  bar: COMMERCIAL_POOL,
  restaurant: COMMERCIAL_POOL,
  cafe: ['com-a', 'com-c'],
  office: SKYSCRAPER_POOL,
  shop: COMMERCIAL_POOL.slice(4),
  supermarket: ['com-j', 'com-l'],
  clinic: ['com-e'],
  school: ['com-g'],
  gym: ['com-n'],
  garage: ['ind-a'],
  cinema: ['sky-c'],
  bowling: ['com-h'],
}

/**
 * Venue kinds an agent disappears into — mesh and label hide together. Venue
 * kinds an agent disappears into — mesh and label hide together.
 */
export const INDOOR_KINDS = new Set([
  'home',
  'bar',
  'office',
  'shop',
  'supermarket',
  'clinic',
  'school',
  'gym',
  'garage',
  'cinema',
  'bowling',
  'cafe',
  'restaurant',
])

/**
 * Tooltip name for a filler building, which has a block role but no venue.
 * Tooltip name for a filler building, which has a block role but no venue.
 */
export const ROLE_LABEL: Record<string, string> = {
  civic: 'Office block',
  home: 'Residence',
  industrial: 'Ironworks unit',
  harbor: 'Harbour building',
}

/**
 * What a raycast hit should report about the object it landed on.
 */
export type PickInfo = { venue?: LocationInfo | null; role?: string | null }

/**
 * Places a model instance on a tile. Passing `pick` registers the instance for
 * hover and click raycasting.
 */
export type PlaceFn = (
  key: string,
  gx: number,
  gy: number,
  rotY?: number,
  pick?: PickInfo,
) => THREE.Object3D | null

/**
 * Drives the loading bar; every model reports before and after itself.
 */
export type LoadProgress = (loaded: number, total: number, name: string) => void

/**
 * Fit a loaded model to the tile grid and seat it on the ground.
 */
function normalise(model: THREE.Object3D, scale: number): void {
  model.scale.setScalar(scale)
  const box = new THREE.Box3().setFromObject(model)
  const center = new THREE.Vector3()
  box.getCenter(center)
  model.position.sub(center)
  box.setFromObject(model)
  model.position.y -= box.min.y
  model.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
}

/**
 * Loads every GLB once and hands out clones.
 *
 * Each Kenney pack models at its own scale and origin, so each model is
 * rescaled to the tile and re-seated on the ground at load time. Road pieces
 * are the exception: they all inherit `road-straight`'s scale so the strips
 * line up.
 */
export class ModelLibrary {
  private readonly cache = new Map<string, THREE.Object3D>()
  private readonly clips = new Map<string, THREE.AnimationClip[]>()
  private roadBaseScale: number | null = null

  get(key: string): THREE.Object3D | undefined {
    return this.cache.get(key)
  }

  clipsFor(key: string): THREE.AnimationClip[] | undefined {
    return this.clips.get(key)
  }

  async load(onProgress?: LoadProgress): Promise<void> {
    const loader = new GLTFLoader()
    const charEntries: [string, string][] = CHARACTER_IDS.map((id) => [`char-${id}`, CHARACTER_GLB(id)])
    const entries = Object.entries(MODELS_TO_LOAD).concat(charEntries)
    // road-straight defines the scale every other road piece inherits
    entries.sort(([a], [b]) => (a === 'rd-straight' ? -1 : b === 'rd-straight' ? 1 : 0))

    const total = entries.length
    let loaded = 0
    for (const [key, url] of entries) {
      onProgress?.(loaded, total, key)
      try {
        const gltf = await loader.loadAsync(url)
        const model = gltf.scene
        normalise(model, this.scaleFor(key, model))
        this.cache.set(key, model)
        if (key.startsWith('char-') && gltf.animations.length > 0) {
          this.clips.set(key, gltf.animations)
        }
      } catch (e) {
        console.warn(`[scene-assets] Failed to load ${key}:`, e)
      }
      loaded++
    }
    onProgress?.(total, total, 'done')
  }

  private scaleFor(key: string, model: THREE.Object3D): number {
    const size = new THREE.Vector3()
    new THREE.Box3().setFromObject(model).getSize(size)
    const maxDim = Math.max(size.x, size.z)

    if (key.startsWith('char-')) return 0.9 / size.y

    const isRoadPack =
      key.startsWith('rd-') || key.startsWith('light') || key.startsWith('traffic') || key === 'dumpster'
    if (isRoadPack) {
      if (key === 'rd-straight') this.roadBaseScale = TILE / maxDim
      return this.roadBaseScale ?? TILE / maxDim
    }

    const isNature = key.startsWith('tree') || key === 'parasol' || key === 'fence' || key === 'planter'
    if (isNature) {
      const s = (TILE * 0.4) / maxDim
      return size.y * s > TILE * 1.2 ? (TILE * 1.2) / size.y : s
    }

    if (key.startsWith('sub-')) return (TILE * 0.7) / maxDim
    return (TILE * 0.58) / maxDim
  }
}
