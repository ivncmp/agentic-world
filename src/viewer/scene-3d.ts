/**
 * Three.js 3D city scene — replaces the Phaser 2D isometric renderer.
 *
 * Uses Kenney city GLB models (commercial, suburban, industrial, roads packs).
 * Reads city data from the engine connection; renders agents as coloured capsules.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { hash } from './hash.js'
import { CHARACTER_IDS, CHARACTER_GLB, characterIdFor } from './characters-data.js'
import { registerPortrait } from './avatar.js'
import type {
  EngineConnection, WorldInfo, LocationInfo, BlockInfo,
  AgentSnapshot, StateMsg, FeedItem, WaterRegion,
} from './connection.js'

// ═══════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════

const TILE = 2.0

const GLB = (pack: string, name: string) =>
  `/assets/city/${pack}/Models/GLB format/${name}.glb`

const MODELS_TO_LOAD: Record<string, string> = {
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
  'parasol': GLB('commercial', 'detail-parasol-a'),
  'parasol-b': GLB('commercial', 'detail-parasol-b'),
  'awning': GLB('commercial', 'detail-awning'),
  'overhang': GLB('commercial', 'detail-overhang'),
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
  'chimney': GLB('industrial', 'chimney-medium'),
  'chimney-sm': GLB('industrial', 'chimney-small'),
  'tank': GLB('industrial', 'detail-tank'),
  'tree-lg': GLB('suburban', 'tree-large'),
  'tree-sm': GLB('suburban', 'tree-small'),
  'fence': GLB('suburban', 'fence'),
  'fence-low': GLB('suburban', 'fence-low'),
  'planter': GLB('suburban', 'planter'),
  'path-stones': GLB('suburban', 'path-stones-short'),
  'driveway': GLB('suburban', 'driveway-short'),
  'rd-straight': GLB('roads', 'road-straight'),
  'rd-crossroad': GLB('roads', 'road-crossroad'),
  'rd-intersection': GLB('roads', 'road-intersection'),
  'rd-bend': GLB('roads', 'road-bend'),
  'rd-end': GLB('roads', 'road-end'),
  'rd-crossing': GLB('roads', 'road-crossing'),
  'light-curved': GLB('roads', 'light-curved'),
  'light-square': GLB('roads', 'light-square'),
  'traffic-light': GLB('roads', 'traffic-light'),
  'dumpster': GLB('roads', 'dumpster'),
  'cone': GLB('roads', 'construction-cone'),
  'barrier': GLB('roads', 'construction-barrier'),
  'elec-pole': GLB('roads', 'electricity-pole-single'),
}

const COMMERCIAL_POOL = ['com-a', 'com-c', 'com-e', 'com-g', 'com-h', 'com-j', 'com-l', 'com-n']
const SKYSCRAPER_POOL = ['sky-a', 'sky-c', 'sky-e']
const LOW_DETAIL_POOL = ['low-a', 'low-d', 'low-g', 'low-j']
const SUBURBAN_POOL = ['sub-b', 'sub-d', 'sub-f', 'sub-h', 'sub-k', 'sub-n', 'sub-q', 'sub-t']
const INDUSTRIAL_POOL = ['ind-a', 'ind-d', 'ind-h', 'ind-l']

const VENUE_MODELS: Record<string, string[]> = {
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

const INDOOR_KINDS = new Set([
  'home', 'bar', 'office', 'shop', 'supermarket', 'clinic', 'school',
  'gym', 'garage', 'cinema', 'bowling', 'cafe', 'restaurant',
])

const ROLE_LABEL: Record<string, string> = {
  civic: 'Office block',
  home: 'Residence',
  industrial: 'Ironworks unit',
  harbor: 'Harbour building',
}

// ═══════════════════════════════════════════════════════════════════════
//  Water helpers
// ═══════════════════════════════════════════════════════════════════════

function expandWater(regions: WaterRegion[]): { river: Set<string>; sea: Set<string>; lake: Set<string> } {
  const river = new Set<string>()
  const sea = new Set<string>()
  const lake = new Set<string>()
  const target: Record<string, Set<string>> = { river, sea, lake }
  for (const r of regions) {
    const set = target[r.kind]
    if (set == null) continue
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++)
        set.add(`${x},${y}`)
  }
  const seaSnap = new Set(sea)
  for (const t of [...river]) {
    const [x, y] = t.split(',').map(Number) as [number, number]
    if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => seaSnap.has(`${x + dx!},${y + dy!}`))) {
      river.delete(t)
      sea.add(t)
    }
  }
  return { river, sea, lake }
}

// ═══════════════════════════════════════════════════════════════════════
//  Agent view
// ═══════════════════════════════════════════════════════════════════════

type AgentView = {
  id: string
  name: string
  mesh: THREE.Group
  mixer: THREE.AnimationMixer | null
  clips: Map<string, THREE.AnimationClip>
  currentAnim: string
  x: number
  y: number
  from: { x: number; y: number }
  to: { x: number; y: number }
  targetP: number
  p: number
  travelling: boolean
  spread: { x: number; y: number }
  state: string
  partner: string | null
  at: string
  color: number
}

function animForState(state: string): string {
  switch (state) {
    case 'travel': return 'walk'
    case 'scene': return 'idle'
    case 'work': case 'relax': case 'eat': case 'browse': case 'sleep': return 'sit'
    default: return 'idle'
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Tile info (for raycasting / tooltips)
// ═══════════════════════════════════════════════════════════════════════

type TileInfo = {
  venue: LocationInfo | null
  home: boolean
  role: string | null
  district: string | null
  water: string | null
  bridge: boolean
}

// ═══════════════════════════════════════════════════════════════════════
//  Scene class
// ═══════════════════════════════════════════════════════════════════════

export class CityScene3D {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private clock = new THREE.Clock()

  private grid = 0
  private period = 0
  private center = new THREE.Vector3()

  private modelCache = new Map<string, THREE.Object3D>()
  private charClips = new Map<string, THREE.AnimationClip[]>()
  private roadBaseScale: number | null = null

  private tileData = new Map<string, TileInfo>()
  private venueAt = new Map<string, LocationInfo>()
  private blockAt = new Map<string, BlockInfo>()
  private locById = new Map<string, LocationInfo>()

  /** 3D objects placed at venue tiles, for raycasting. */
  private venueMeshes = new Map<string, THREE.Object3D>()
  /** All placed building objects keyed by tile, for raycasting. */
  private buildingMeshes = new Map<string, { obj: THREE.Object3D; venue: LocationInfo | null; role: string | null }>()
  private hoveredBuilding: string | null = null

  private pickBuildings: THREE.Object3D[] = []
  private pickAgents: THREE.Object3D[] = []
  private highlightCache = new Map<THREE.Material, THREE.Material>()
  private highlighted: { mesh: THREE.Mesh; mat: THREE.Material | THREE.Material[] }[] = []
  private highlightRoot: THREE.Object3D | null = null

  private river = new Set<string>()
  private sea = new Set<string>()
  private lake = new Set<string>()

  private views = new Map<string, AgentView>()
  private waterMat!: THREE.MeshPhongMaterial

  private ambient!: THREE.AmbientLight
  private sun!: THREE.DirectionalLight
  private fill!: THREE.DirectionalLight
  private didInitialFit = false

  private raycaster = new THREE.Raycaster()
  private mouse = new THREE.Vector2()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private tooltipEl: HTMLDivElement
  private hoveredAgent: string | null = null
  private followTarget: string | null = null
  private focus: { target: THREE.Vector3; camera: THREE.Vector3 } | null = null

  /** Persistent overlays above venues showing name + occupants. */
  private venueLabels = new Map<string, HTMLDivElement>()
  /** Floating name labels above visible agents. */
  private agentLabels = new Map<string, HTMLDivElement>()
  private overlayContainer!: HTMLDivElement

  private onLoadProgress: ((loaded: number, total: number, name: string) => void) | null = null

  constructor(
    private readonly container: HTMLElement,
    private readonly conn: EngineConnection,
    private readonly world: WorldInfo,
  ) {
    this.grid = world.city.grid.width
    this.period = world.city.streetPeriod

    for (const l of world.locations) {
      this.venueAt.set(`${l.x},${l.y}`, l)
      this.locById.set(l.id, l)
    }
    for (const b of world.city.blocks) this.blockAt.set(`${b.bx},${b.by}`, b)
    const w = expandWater(world.city.water ?? [])
    this.river = w.river
    this.sea = w.sea
    this.lake = w.lake

    // Renderer
    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    container.prepend(canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1

    // Scene
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87ceeb)
    this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.008)

    // Camera
    this.center.set(this.grid * TILE / 2, 0, this.grid * TILE / 2)
    this.camera = new THREE.PerspectiveCamera(
      35, container.clientWidth / container.clientHeight, 0.5, 200,
    )
    this.camera.position.set(this.center.x + 35, 30, this.center.z + 35)
    this.camera.lookAt(this.center)

    // Controls
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.copy(this.center)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 8
    this.controls.maxDistance = 100
    this.controls.maxPolarAngle = Math.PI / 2.2

    // Lighting — driven by the in-game hour, see applySkyForHour()
    this.ambient = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(this.ambient)

    this.sun = new THREE.DirectionalLight(0xfff5e0, 1.2)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.left = -60
    this.sun.shadow.camera.right = 60
    this.sun.shadow.camera.top = 60
    this.sun.shadow.camera.bottom = -60
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 160
    this.sun.shadow.bias = -0.001
    this.sun.target.position.copy(this.center)
    this.scene.add(this.sun)
    this.scene.add(this.sun.target)

    this.fill = new THREE.DirectionalLight(0xb0c4de, 0.3)
    this.fill.position.set(-20, 15, -10)
    this.scene.add(this.fill)
    this.applySkyForHour(12)

    // Overlay container for venue labels (positioned over 3D scene)
    this.overlayContainer = document.createElement('div')
    this.overlayContainer.className = 'overlay-3d'
    container.appendChild(this.overlayContainer)

    // Tooltip
    this.tooltipEl = document.createElement('div')
    this.tooltipEl.className = 'tooltip-3d'
    container.appendChild(this.tooltipEl)

    // Events
    this.setupEvents(canvas)
  }

  // ── Public API ──────────────────────────────────────────────────────

  set loadProgress(fn: (loaded: number, total: number, name: string) => void) {
    this.onLoadProgress = fn
  }

  async build(): Promise<void> {
    this.buildGround()
    await this.loadModels()
    this.placeRoads()
    this.placeBuildings()
    this.placeStreetFurniture()
    this.createAgents()
    this.renderPortraits()
    this.createVenueLabels()
    this.fitToAgents()
    this.listenToEngine()
    this.animate()
  }

  dispose(): void {
    this.renderer.dispose()
  }

  // ── Grid helpers ───────────────────────────────────────────────────

  private isStreet(x: number, y: number): boolean {
    return x % this.period === 0 || y % this.period === 0
  }

  private isWater(x: number, y: number): boolean {
    const k = `${x},${y}`
    return this.river.has(k) || this.sea.has(k) || this.lake.has(k)
  }

  private isBridge(x: number, y: number): boolean {
    const k = `${x},${y}`
    if (!this.river.has(k) || !this.isStreet(x, y) || this.sea.has(k)) return false
    return ![[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) =>
      this.sea.has(`${x + dx!},${y + dy!}`))
  }

  private adjSea(x: number, y: number): boolean {
    return [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) =>
      this.sea.has(`${x + dx!},${y + dy!}`))
  }

  private districtOf(bx: number, by: number): string | null {
    const block = this.blockAt.get(`${bx},${by}`)
    if (!block) return null
    // Districts come from the template — find the nearest venue's district
    for (const v of this.world.locations) {
      const vbx = Math.floor(v.x / this.period)
      const vby = Math.floor(v.y / this.period)
      if (vbx === bx && vby === by) return v.district
    }
    // Fall back to any district from a nearby block
    return this.world.city.districts[0] ?? null
  }

  private worldPos(gx: number, gy: number): THREE.Vector3 {
    return new THREE.Vector3(gx * TILE + TILE / 2, 0, gy * TILE + TILE / 2)
  }

  // ── Ground ─────────────────────────────────────────────────────────

  private buildGround(): void {
    const MAT = {
      grass: new THREE.MeshLambertMaterial({ color: 0x4a8a3a }),
      grassLight: new THREE.MeshLambertMaterial({ color: 0x5aaa4a }),
      dirt: new THREE.MeshLambertMaterial({ color: 0x8a7a60 }),
      sand: new THREE.MeshLambertMaterial({ color: 0xc8b888 }),
    }
    this.waterMat = new THREE.MeshPhongMaterial({ color: 0x2e6ea4, shininess: 70 })

    const tileGeo = new THREE.PlaneGeometry(TILE, TILE)
    tileGeo.rotateX(-Math.PI / 2)
    const waterGeo = new THREE.PlaneGeometry(TILE + 0.04, TILE + 0.04)
    waterGeo.rotateX(-Math.PI / 2)

    for (let gy = 0; gy < this.grid; gy++) {
      for (let gx = 0; gx < this.grid; gx++) {
        const k = `${gx},${gy}`
        const pos = this.worldPos(gx, gy)
        let mat: THREE.Material
        let yOff = 0

        const info: TileInfo = {
          venue: this.venueAt.get(k) ?? null,
          home: false,
          role: null,
          district: null,
          water: null,
          bridge: false,
        }
        const bx = Math.floor(gx / this.period)
        const by = Math.floor(gy / this.period)
        const block = this.blockAt.get(`${bx},${by}`)
        info.role = block?.role ?? null
        info.district = this.districtOf(bx, by)

        if (this.sea.has(k)) {
          mat = this.waterMat; yOff = -0.12; info.water = 'sea'
        } else if (this.isBridge(gx, gy)) {
          mat = this.waterMat; yOff = -0.12; info.water = 'river'; info.bridge = true
        } else if (this.river.has(k)) {
          mat = this.waterMat; yOff = -0.12; info.water = 'river'
        } else if (this.lake.has(k)) {
          mat = this.waterMat; yOff = -0.12; info.water = 'lake'
        } else if (this.isStreet(gx, gy)) {
          const isCoastRoad = this.adjSea(gx, gy)
          if (isCoastRoad) {
            mat = MAT.sand
          } else {
            this.tileData.set(k, info)
            continue
          }
        } else if (block) {
          if (block.role === 'plaza') mat = MAT.dirt
          else if (block.role === 'green') mat = MAT.grassLight
          else if (block.role === 'harbor') mat = MAT.sand
          else if (block.role === 'sea') { mat = this.waterMat; yOff = -0.12; info.water = 'sea' }
          else mat = MAT.grass
        } else {
          mat = MAT.grass
        }

        if (block?.role === 'residential' && !this.isStreet(gx, gy) && !this.isWater(gx, gy) && !info.venue) {
          info.home = true
        }

        const geo = info.water ? waterGeo : tileGeo
        const tile = new THREE.Mesh(geo, mat)
        tile.position.copy(pos)
        tile.position.y = yOff
        tile.receiveShadow = true
        this.scene.add(tile)

        this.tileData.set(k, info)
      }
    }
  }

  // ── Model loading ──────────────────────────────────────────────────

  private async loadModels(): Promise<void> {
    const loader = new GLTFLoader()

    // Add character models to the load list
    const charEntries: [string, string][] = CHARACTER_IDS.map(id => [`char-${id}`, CHARACTER_GLB(id)])
    const entries = Object.entries(MODELS_TO_LOAD).concat(charEntries)
    entries.sort(([a], [b]) => (a === 'rd-straight' ? -1 : b === 'rd-straight' ? 1 : 0))
    const total = entries.length
    let loaded = 0

    for (const [key, url] of entries) {
      this.onLoadProgress?.(loaded, total, key)
      try {
        const gltf = await loader.loadAsync(url)
        const model = gltf.scene
        const box = new THREE.Box3().setFromObject(model)
        const size = new THREE.Vector3()
        box.getSize(size)
        const maxDim = Math.max(size.x, size.z)
        const isCharacter = key.startsWith('char-')
        const isNature = key.startsWith('tree') || key === 'parasol' || key === 'fence' || key === 'planter'
        const isRoadPack = key.startsWith('rd-') || key.startsWith('light') || key.startsWith('traffic') || key === 'dumpster'
        let scale: number
        if (isCharacter) {
          scale = 0.9 / size.y
        } else if (isRoadPack) {
          if (key === 'rd-straight') {
            this.roadBaseScale = TILE / maxDim
          }
          scale = this.roadBaseScale ?? (TILE / maxDim)
        } else if (isNature) {
          scale = (TILE * 0.4) / maxDim
          if (size.y * scale > TILE * 1.2) scale = (TILE * 1.2) / size.y
        } else if (key.startsWith('sub-')) {
          scale = (TILE * 0.7) / maxDim
        } else {
          scale = (TILE * 0.58) / maxDim
        }
        model.scale.setScalar(scale)

        box.setFromObject(model)
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

        this.modelCache.set(key, model)
        if (isCharacter && gltf.animations.length > 0) {
          this.charClips.set(key, gltf.animations)
        }
      } catch (e) {
        console.warn(`[scene-3d] Failed to load ${key}:`, e)
      }
      loaded++
    }
    this.onLoadProgress?.(total, total, 'done')
  }

  private placeModel(
    key: string,
    gx: number,
    gy: number,
    rotY = 0,
    pick?: { venue?: LocationInfo | null; role?: string | null },
  ): THREE.Object3D | null {
    const template = this.modelCache.get(key)
    if (!template) return null
    const clone = template.clone()
    const pos = this.worldPos(gx, gy)
    clone.position.add(pos)
    clone.rotation.y = rotY
    this.scene.add(clone)
    if (pick) {
      const tileKey = `${gx},${gy}`
      clone.userData.pick = { tileKey, venue: pick.venue ?? null, role: pick.role ?? null }
      this.pickBuildings.push(clone)
      this.buildingMeshes.set(tileKey, { obj: clone, venue: pick.venue ?? null, role: pick.role ?? null })
    }
    return clone
  }

  // ── Hover highlight ────────────────────────────────────────────────

  /** Materials are shared across cloned instances, so the tinted variants cache. */
  private highlightMat(m: THREE.Material): THREE.Material {
    let h = this.highlightCache.get(m)
    if (!h) {
      h = m.clone()
      const std = h as THREE.MeshStandardMaterial
      if (std.color) std.color = std.color.clone().lerp(new THREE.Color(0xffffff), 0.35)
      if (std.emissive) {
        std.emissive = new THREE.Color(0x4fa8ff)
        std.emissiveIntensity = 0.55
      }
      this.highlightCache.set(m, h)
    }
    return h
  }

  private setHighlight(root: THREE.Object3D | null): void {
    if (this.highlightRoot === root) return
    for (const e of this.highlighted) e.mesh.material = e.mat
    this.highlighted = []
    this.highlightRoot = root
    if (root == null) return
    root.traverse((c) => {
      const mesh = c as THREE.Mesh
      if (!mesh.isMesh || mesh.material == null) return
      this.highlighted.push({ mesh, mat: mesh.material })
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((x) => this.highlightMat(x))
        : this.highlightMat(mesh.material)
    })
  }

  /** Frame every agent as tightly as the viewport allows. */
  private fitToAgents(animated = false): void {
    const pts = [...this.views.values()].map(v => v.travelling ? v.to : { x: v.x, y: v.y })
    if (pts.length === 0) return

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }

    const a = this.worldPos(minX, minY)
    const b = this.worldPos(maxX, maxY)
    const target = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2)

    // Buildings are taller than agents, so pad the vertical extent a little
    const radius = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z)) / 2 + TILE * 2
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const fitH = radius / Math.tan(fov / 2)
    const fitW = fitH / this.camera.aspect
    const dist = THREE.MathUtils.clamp(
      Math.max(fitH, fitW) * 1.25,
      this.controls.minDistance,
      this.controls.maxDistance,
    )

    const dir = new THREE.Vector3(0.62, 0.55, 0.62).normalize()
    const camPos = target.clone().addScaledVector(dir, dist)
    if (animated) {
      this.focus = { target, camera: camPos }
    } else {
      this.controls.target.copy(target)
      this.camera.position.copy(camPos)
      this.camera.lookAt(target)
    }
  }

  /** Glide the camera onto a tile, keeping the current viewing angle. */
  private focusOnTile(tileKey: string, distance = 12): void {
    const [gx, gy] = tileKey.split(',').map(Number) as [number, number]
    const p = this.worldPos(gx, gy)
    const target = new THREE.Vector3(p.x, 1, p.z)
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    if (dir.lengthSq() === 0) dir.set(0.6, 0.6, 0.6).normalize()
    this.focus = { target, camera: target.clone().addScaledVector(dir, distance) }
  }

  private pickRoot(obj: THREE.Object3D): THREE.Object3D | null {
    let cur: THREE.Object3D | null = obj
    while (cur) {
      if (cur.userData.pick != null) return cur
      cur = cur.parent
    }
    return null
  }

  // ── Roads ──────────────────────────────────────────────────────────

  private isRoadConnected(gx: number, gy: number): boolean {
    if (gx < 0 || gy < 0 || gx >= this.grid || gy >= this.grid) return false
    if (this.isWater(gx, gy) && !this.isBridge(gx, gy)) return false
    return this.isStreet(gx, gy)
  }

  private classifyRoad(gx: number, gy: number): { model: string; rot: number } {
    const n = this.isRoadConnected(gx, gy - 1)
    const e = this.isRoadConnected(gx + 1, gy)
    const s = this.isRoadConnected(gx, gy + 1)
    const w = this.isRoadConnected(gx - 1, gy)
    const count = [n, e, s, w].filter(Boolean).length
    const H = Math.PI / 2

    if (count === 4) return { model: 'rd-crossroad', rot: 0 }

    if (count === 3) {
      if (!n) return { model: 'rd-intersection', rot: 0 }
      if (!w) return { model: 'rd-intersection', rot: H }
      if (!s) return { model: 'rd-intersection', rot: Math.PI }
      if (!e) return { model: 'rd-intersection', rot: -H }
    }

    if (count === 2) {
      if (e && w) return { model: 'rd-straight', rot: 0 }
      if (n && s) return { model: 'rd-straight', rot: H }
      if (e && s) return { model: 'rd-bend', rot: H }
      if (n && e) return { model: 'rd-bend', rot: Math.PI }
      if (w && n) return { model: 'rd-bend', rot: -H }
      if (s && w) return { model: 'rd-bend', rot: 0 }
    }

    if (count === 1) {
      if (s) return { model: 'rd-end', rot: 0 }
      if (e) return { model: 'rd-end', rot: H }
      if (n) return { model: 'rd-end', rot: Math.PI }
      if (w) return { model: 'rd-end', rot: Math.PI }
    }

    return { model: 'rd-straight', rot: 0 }
  }

  private placeRoads(): void {
    const BRIDGE_MAT = new THREE.MeshLambertMaterial({ color: 0x8a7040 })
    const PLANK_MAT = new THREE.MeshLambertMaterial({ color: 0xa08850 })

    for (let gy = 0; gy < this.grid; gy++) {
      for (let gx = 0; gx < this.grid; gx++) {
        if (!this.isStreet(gx, gy)) continue
        if (this.isWater(gx, gy) && !this.isBridge(gx, gy)) continue
        if (this.sea.has(`${gx},${gy}`)) continue

        if (this.isBridge(gx, gy)) {
          const pos = this.worldPos(gx, gy)
          const plank = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.06, TILE), PLANK_MAT)
          plank.position.set(pos.x, 0.08, pos.z)
          plank.castShadow = true
          this.scene.add(plank)
          // Railings — orientation depends on river direction
          const isVertRiver = this.river.has(`${gx},${gy - 1}`) || this.river.has(`${gx},${gy + 1}`)
          if (isVertRiver) {
            const rGeo = new THREE.BoxGeometry(TILE, 0.25, TILE * 0.06)
            for (const dz of [-0.44, 0.44]) {
              const r = new THREE.Mesh(rGeo, BRIDGE_MAT)
              r.position.set(pos.x, 0.2, pos.z + TILE * dz)
              this.scene.add(r)
            }
          } else {
            const rGeo = new THREE.BoxGeometry(TILE * 0.06, 0.25, TILE)
            for (const dx of [-0.44, 0.44]) {
              const r = new THREE.Mesh(rGeo, BRIDGE_MAT)
              r.position.set(pos.x + TILE * dx, 0.2, pos.z)
              this.scene.add(r)
            }
          }
          continue
        }

        const { model, rot } = this.classifyRoad(gx, gy)
        this.placeModel(model, gx, gy, rot)
      }
    }
  }

  // ── Buildings ──────────────────────────────────────────────────────

  private placeBuildings(): void {
    // Venues first
    for (const v of this.world.locations) {
      const pick = { venue: v, role: null }
      let obj: THREE.Object3D | null
      if (v.kind === 'park') {
        const ph = hash(v.x, v.y, 'park') % 4
        const key = ph < 2 ? 'tree-lg' : (ph === 2 ? 'tree-sm' : 'planter')
        obj = this.placeModel(key, v.x, v.y, 0, pick)
      } else {
        const pool = VENUE_MODELS[v.kind] ?? COMMERCIAL_POOL
        const idx = hash(v.x, v.y, v.name) % pool.length
        const rot = (hash(v.x, v.y, 'rot') % 4) * (Math.PI / 2)
        obj = this.placeModel(pool[idx]!, v.x, v.y, rot, pick)
      }
      if (obj) this.venueMeshes.set(v.id, obj)
    }

    // Filler buildings + homes
    for (let gy = 0; gy < this.grid; gy++) {
      for (let gx = 0; gx < this.grid; gx++) {
        if (this.isStreet(gx, gy) || this.isWater(gx, gy) || this.isBridge(gx, gy)) continue
        if (this.venueAt.has(`${gx},${gy}`)) continue
        if (this.adjSea(gx, gy)) continue

        const bx = Math.floor(gx / this.period)
        const by = Math.floor(gy / this.period)
        const block = this.blockAt.get(`${bx},${by}`)
        if (!block || block.role === 'sea') continue

        const lx = (gx % this.period) - 1
        const ly = (gy % this.period) - 1
        const middle = lx === 1 && ly === 1
        const district = this.districtOf(bx, by)
        const rot = (hash(gx, gy, 'rot') % 4) * (Math.PI / 2)

        if (block.role === 'civic') {
          const h = hash(gx, gy, 'fill') % 100
          if (middle) {
            this.placeModel(h % 3 === 0 ? 'dumpster' : 'planter', gx, gy, rot)
          } else if (h < 75) {
            const pool = h < 15 ? SKYSCRAPER_POOL : (h < 40 ? COMMERCIAL_POOL : LOW_DETAIL_POOL)
            this.placeModel(pool[hash(gx, gy, 'idx') % pool.length]!, gx, gy, rot, { role: 'civic' })
          } else {
            const ph = hash(gx, gy, 'prop') % 5
            if (ph === 0) this.placeModel('planter', gx, gy)
            else if (ph === 1) this.placeModel('dumpster', gx, gy, rot)
            else if (ph === 2) this.placeModel('tree-sm', gx, gy)
            else if (ph === 3) this.placeModel('fence-low', gx, gy, rot)
            else this.placeModel('cone', gx, gy)
          }
        } else if (block.role === 'residential') {
          const isIronworks = district === 'Ironworks'
          const pool = isIronworks ? INDUSTRIAL_POOL : SUBURBAN_POOL
          const h = hash(gx, gy, 'home') % 100
          if (h < 78) {
            this.placeModel(pool[hash(gx, gy, 'hidx') % pool.length]!, gx, gy, rot, {
              role: isIronworks ? 'industrial' : 'home',
            })
          } else {
            const ph = hash(gx, gy, 'yard') % 6
            if (ph < 2) this.placeModel('tree-sm', gx, gy)
            else if (ph === 2) this.placeModel('fence-low', gx, gy, rot)
            else if (ph === 3) this.placeModel('planter', gx, gy)
            else if (ph === 4) this.placeModel('parasol', gx, gy, rot)
            else this.placeModel('tree-lg', gx, gy)
          }
        } else if (block.role === 'green') {
          if (middle) {
            this.placeModel('planter', gx, gy)
          } else {
            const onPath = lx === 1 || ly === 1
            if (onPath) {
              if (hash(gx, gy, 'pstone') % 3 === 0) this.placeModel('path-stones', gx, gy, rot)
            } else {
              const treeKey = hash(gx, gy, 'tree') % 3 === 0 ? 'tree-sm' : 'tree-lg'
              this.placeModel(treeKey, gx, gy)
            }
          }
        } else if (block.role === 'plaza') {
          if (!middle) {
            const corner = (lx === 0 || lx === 2) && (ly === 0 || ly === 2)
            if (corner) this.placeModel('tree-lg', gx, gy)
            else {
              const ph = hash(gx, gy, 'parasol') % 6
              if (ph < 2) this.placeModel(ph === 0 ? 'parasol' : 'parasol-b', gx, gy, rot)
              else if (ph === 2) this.placeModel('planter', gx, gy)
            }
          } else {
            this.placeModel('parasol', gx, gy)
          }
        } else if (block.role === 'harbor') {
          const h = hash(gx, gy, 'hbr') % 100
          if (h < 40) {
            const hpool = [...COMMERCIAL_POOL, ...INDUSTRIAL_POOL]
            this.placeModel(hpool[hash(gx, gy, 'hidx') % hpool.length]!, gx, gy, rot, { role: 'harbor' })
          } else {
            const ph = hash(gx, gy, 'hprop') % 7
            if (ph === 0) this.placeModel('tank', gx, gy, rot)
            else if (ph === 1) this.placeModel('chimney-sm', gx, gy)
            else if (ph === 2) this.placeModel('barrier', gx, gy, rot)
            else if (ph === 3) this.placeModel('cone', gx, gy)
            else if (ph === 4) this.placeModel('dumpster', gx, gy, rot)
            else if (ph === 5) this.placeModel('fence-low', gx, gy, rot)
            else this.placeModel('planter', gx, gy)
          }
        }
      }
    }
  }

  // ── Street furniture ───────────────────────────────────────────────

  private placeStreetFurniture(): void {
    for (let gy = 0; gy < this.grid; gy++) {
      for (let gx = 0; gx < this.grid; gx++) {
        if (!this.isStreet(gx, gy) || this.isWater(gx, gy) || this.isBridge(gx, gy)) continue
        if (this.sea.has(`${gx},${gy}`)) continue
        const isIntersection = (gx % this.period === 0) && (gy % this.period === 0)
        if (!isIntersection) continue

        const h = hash(gx, gy, 'furn')
        const rot4 = (h % 4) * (Math.PI / 2)
        const lampKey = h % 4 < 2 ? 'light-curved' : 'light-square'
        this.placeModel(lampKey, gx, gy, rot4)

        if (h % 4 === 0) {
          const bx = Math.floor(gx / this.period)
          const by = Math.floor(gy / this.period)
          const block = this.blockAt.get(`${bx},${by}`)
          if (block && (block.role === 'civic' || block.role === 'plaza' || block.role === 'harbor')) {
            this.placeModel('traffic-light', gx, gy, ((h >> 3) % 4) * (Math.PI / 2))
          }
        }
      }
    }
  }

  // ── Agents ─────────────────────────────────────────────────────────

  private createAgents(): void {
    for (const a of this.world.agents) {
      const charKey = `char-${characterIdFor(a.id)}`
      const template = this.modelCache.get(charKey)

      let group: THREE.Group
      let mixer: THREE.AnimationMixer | null = null
      const clips = new Map<string, THREE.AnimationClip>()

      if (template) {
        group = SkeletonUtils.clone(template) as THREE.Group
        const rawClips = this.charClips.get(charKey)
        if (rawClips) {
          mixer = new THREE.AnimationMixer(group)
          for (const clip of rawClips) clips.set(clip.name, clip)
          const idle = clips.get('idle')
          if (idle) mixer.clipAction(idle).play()
        }
      } else {
        const bodyGeo = new THREE.CapsuleGeometry(0.15, 0.5, 4, 8)
        const headGeo = new THREE.SphereGeometry(0.14, 8, 6)
        const bodyMat = new THREE.MeshLambertMaterial({ color: 0x3498db })
        const headMat = new THREE.MeshLambertMaterial({ color: 0xf0d0b0 })
        const body = new THREE.Mesh(bodyGeo, bodyMat)
        body.position.y = 0.4
        body.castShadow = true
        const head = new THREE.Mesh(headGeo, headMat)
        head.position.y = 0.8
        head.castShadow = true
        group = new THREE.Group()
        group.add(body)
        group.add(head)
      }
      group.userData = { agentId: a.id, agentName: a.name, pick: { agentId: a.id } }
      this.pickAgents.push(group)

      const home = this.world.locations.find(l => l.id === `home-${a.id}`)
      const start = { x: home?.x ?? this.grid / 2, y: home?.y ?? this.grid / 2 }
      const pos = this.worldPos(start.x, start.y)
      group.position.copy(pos)
      this.scene.add(group)

      // Floating name label
      const label = document.createElement('div')
      label.className = 'agent-label'
      label.textContent = a.name
      label.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id: a.id } }))
      })
      this.overlayContainer.appendChild(label)
      this.agentLabels.set(a.id, label)

      this.views.set(a.id, {
        id: a.id,
        name: a.name,
        mesh: group,
        mixer,
        clips,
        currentAnim: 'idle',
        x: start.x,
        y: start.y,
        from: start,
        to: start,
        targetP: 1,
        p: 1,
        travelling: false,
        spread: { x: 0, y: 0 },
        state: 'idle',
        partner: null,
        at: home?.id ?? '',
        color: 0xffffff,
      })
    }
  }

  /**
   * Head-and-shoulders portraits rendered off-screen from the character GLBs,
   * so DOM avatars are literally the same model as the body in the street.
   */
  private renderPortraits(): void {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    r.setClearColor(0x000000, 0)
    r.outputColorSpace = THREE.SRGBColorSpace

    const stage = new THREE.Scene()
    stage.add(new THREE.AmbientLight(0xffffff, 2.0))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(1, 2, 3)
    stage.add(key)
    const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 50)

    for (const id of CHARACTER_IDS) {
      const template = this.modelCache.get(`char-${id}`)
      if (!template) continue
      const model = SkeletonUtils.clone(template)
      stage.add(model)

      const box = new THREE.Box3().setFromObject(model)
      const h = box.max.y - box.min.y
      const target = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y + h * 0.86, 0)
      cam.position.set(target.x, target.y + h * 0.02, target.z + h * 0.62)
      cam.lookAt(target)
      r.render(stage, cam)
      registerPortrait(id, canvas.toDataURL('image/png'))

      stage.remove(model)
    }
    r.dispose()
  }

  // ── Day/night cycle ────────────────────────────────────────────────

  /**
   * Sun arc, colour and sky are keyed to the in-game hour: the sun rises at 6,
   * peaks at 13 and sets at 20, so shadows sweep across the city as the day runs.
   */
  private applySkyForHour(hour: number): void {
    const DAWN = 6, DUSK = 20
    const dayT = (hour - DAWN) / (DUSK - DAWN)   // 0 at sunrise, 1 at sunset
    const above = dayT > 0 && dayT < 1
    const elevation = above ? Math.sin(dayT * Math.PI) : 0

    // Sun sweeps east→west; below the horizon it becomes the moon, opposite side
    const azimuth = (above ? dayT : dayT + 1) * Math.PI
    const radius = 70
    this.sun.position.set(
      this.center.x + Math.cos(azimuth) * radius,
      Math.max(elevation, 0.08) * 55 + 6,
      this.center.z + Math.sin(azimuth * 0.6) * radius * 0.5 - 20,
    )
    this.sun.target.position.copy(this.center)

    const warmth = above ? Math.pow(1 - elevation, 2) : 1  // reddens near horizon
    const sunColour = new THREE.Color(0xfff3d6).lerp(new THREE.Color(0xff7a3c), warmth * 0.85)
    const moonColour = new THREE.Color(0x7f9cd8)

    // Night stays a readable moonlit blue — this is a spectator view, so the
    // city must never go darker than "you can still see who is out there".
    if (above) {
      this.sun.color.copy(sunColour)
      this.sun.intensity = 0.55 + elevation * 1.05
      this.ambient.color.set(0xffffff)
      this.ambient.intensity = 0.55 + elevation * 0.3
      this.fill.intensity = 0.25 + elevation * 0.15
    } else {
      this.sun.color.copy(moonColour)
      this.sun.intensity = 0.55
      this.ambient.color.set(0xc2d2f0)
      this.ambient.intensity = 0.7
      this.fill.intensity = 0.3
    }

    const NIGHT = new THREE.Color(0x33507f)
    const DAY = new THREE.Color(0x87ceeb)
    const GOLDEN = new THREE.Color(0xf19a5a)
    const sky = above
      ? NIGHT.clone().lerp(DAY, Math.min(1, elevation * 2.2)).lerp(GOLDEN, warmth * 0.55)
      : NIGHT.clone()

    ;(this.scene.background as THREE.Color).copy(sky)
    ;(this.scene.fog as THREE.FogExp2).color.copy(sky)
    this.renderer.toneMappingExposure = above ? 1.05 + elevation * 0.2 : 1.0
  }

  private isIndoors(v: AgentView): boolean {
    if (v.travelling) return false
    const loc = this.locById.get(v.at)
    return loc != null && INDOOR_KINDS.has(loc.kind)
  }

  private routePoint(v: AgentView, p: number): { x: number; y: number } {
    const period = this.period
    const toStreet = (n: number): number => Math.round(n / period) * period
    const { from, to } = v
    const roadY = toStreet(from.y)
    const roadX = toStreet(to.x)

    const legs: [{ x: number; y: number }, { x: number; y: number }][] = [
      [from, { x: from.x, y: roadY }],
      [{ x: from.x, y: roadY }, { x: roadX, y: roadY }],
      [{ x: roadX, y: roadY }, { x: roadX, y: to.y }],
      [{ x: roadX, y: to.y }, to],
    ]
    const lengths = legs.map(([a, b]) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y))
    const total = lengths.reduce((s, l) => s + l, 0)
    if (total < 1e-6) return { ...to }

    let want = p * total
    for (let i = 0; i < legs.length; i++) {
      const len = lengths[i]!
      if (want <= len || i === legs.length - 1) {
        const t = len < 1e-6 ? 1 : Math.min(1, want / len)
        const [a, b] = legs[i]!
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
      }
      want -= len
    }
    return { ...to }
  }

  private spreadOffset(a: AgentSnapshot, here: string[]): { x: number; y: number } {
    if (here.length < 2) return { x: 0, y: 0 }
    if (a.partner != null && here.includes(a.partner)) {
      const first = a.id < a.partner
      return { x: first ? -0.3 : 0.3, y: first ? 0.3 : -0.3 }
    }
    const i = here.indexOf(a.id)
    const angle = (i / here.length) * Math.PI * 2 + ((hash(a.id) % 100) / 100)
    const r = 0.34
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r }
  }

  // ── Venue labels (always-visible CSS overlays) ──────────────────────

  private createVenueLabels(): void {
    for (const loc of this.world.locations) {
      const label = document.createElement('div')
      label.className = 'venue-label'
      label.dataset.venueId = loc.id
      label.style.display = 'none'
      label.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('aw:venue-click', { detail: { id: loc.id } }))
      })
      this.overlayContainer.appendChild(label)
      this.venueLabels.set(loc.id, label)
    }
  }

  private getOccupants(locationId: string): AgentView[] {
    const result: AgentView[] = []
    for (const v of this.views.values()) {
      if (v.at === locationId && !v.travelling) result.push(v)
    }
    return result
  }

  private updateVenueLabels(): void {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const halfW = rect.width / 2
    const halfH = rect.height / 2
    const hoveringBuilding = this.hoveredBuilding != null

    for (const loc of this.world.locations) {
      const label = this.venueLabels.get(loc.id)
      if (!label) continue

      const occupants = this.getOccupants(loc.id)

      // Rule 1: no occupants → hide
      // Rule 3: hovering a building → hide all venue labels
      if (occupants.length === 0 || hoveringBuilding) {
        label.style.display = 'none'
        continue
      }

      // Project 3D position to screen
      const pos = this.worldPos(loc.x, loc.y)
      pos.y = 1.8
      const screenPos = pos.clone().project(this.camera)
      const sx = screenPos.x * halfW + halfW
      const sy = -screenPos.y * halfH + halfH

      if (screenPos.z > 1 || sx < -50 || sx > rect.width + 50 || sy < -50 || sy > rect.height + 50) {
        label.style.display = 'none'
        continue
      }

      // Rule 2: has occupants → show with venue name + occupant list
      const occHtml = occupants.map(v => `<span class="vl-agent">${v.name}</span>`).join('')
      label.innerHTML = `<span class="vl-name">${loc.name}</span><div class="vl-occ">${occHtml}</div><div class="vl-arrow"></div>`
      label.style.display = ''
      label.style.left = sx + 'px'
      label.style.top = sy + 'px'
    }
  }

  private updateAgentLabels(): void {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const halfW = rect.width / 2
    const halfH = rect.height / 2

    for (const v of this.views.values()) {
      const label = this.agentLabels.get(v.id)
      if (!label) continue

      // Rule 4: agents that are visible (not indoors) always show name
      if (!v.mesh.visible) {
        label.style.display = 'none'
        continue
      }

      const pos = v.mesh.position.clone()
      pos.y = 1.1
      const screenPos = pos.clone().project(this.camera)
      const sx = screenPos.x * halfW + halfW
      const sy = -screenPos.y * halfH + halfH

      if (screenPos.z > 1 || sx < -50 || sx > rect.width + 50 || sy < -50 || sy > rect.height + 50) {
        label.style.display = 'none'
        continue
      }

      label.style.display = ''
      label.style.left = sx + 'px'
      label.style.top = sy + 'px'
    }
  }

  // ── Engine connection ──────────────────────────────────────────────

  private listenToEngine(): void {
    this.conn.onState((s: StateMsg) => {
      this.applySkyForHour(s.hour + s.minute / 60)
      this.updateAgents(s.agents)
      if (!this.didInitialFit) {
        this.didInitialFit = true
        this.fitToAgents()
      }
    })
  }

  private updateAgents(agents: AgentSnapshot[]): void {
    const crowd = new Map<string, string[]>()
    for (const a of agents) {
      const key = `${Math.round(a.x)},${Math.round(a.y)}`
      const list = crowd.get(key) ?? []
      list.push(a.id)
      crowd.set(key, list)
    }

    for (const a of agents) {
      const v = this.views.get(a.id)
      if (v == null) continue
      v.state = a.state
      v.partner = a.partner
      v.at = a.at
      v.travelling = a.state === 'travel' && a.progress < 1
      v.from = a.from
      v.to = a.to
      v.targetP = a.progress
      if (!v.travelling) v.p = 1
      else if (v.p > a.progress) v.p = a.progress
      v.spread = this.spreadOffset(a, crowd.get(`${Math.round(a.x)},${Math.round(a.y)}`) ?? [a.id])
    }
  }

  // ── Events ─────────────────────────────────────────────────────────

  private setupEvents(canvas: HTMLCanvasElement): void {
    // Resize
    const resize = () => {
      const w = this.container.clientWidth
      const h = this.container.clientHeight
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(w, h)
    }
    new ResizeObserver(resize).observe(this.container)

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        this.camera.position.set(this.center.x + 35, 30, this.center.z + 35)
        this.controls.target.copy(this.center)
      }
    })

    // Zoom/fit from DOM controls
    window.addEventListener('aw:zoom', (e) => {
      this.focus = null
      const d = (e as CustomEvent<{ dir: number }>).detail.dir
      const dist = this.camera.position.distanceTo(this.controls.target)
      const newDist = THREE.MathUtils.clamp(dist * (d > 0 ? 0.8 : 1.25), 8, 100)
      const dir = this.camera.position.clone().sub(this.controls.target).normalize()
      this.camera.position.copy(this.controls.target).addScaledVector(dir, newDist)
    })

    window.addEventListener('aw:venue-focus', (e) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id
      const loc = this.locById.get(id)
      if (loc == null) return
      this.followTarget = null
      this.focusOnTile(`${loc.x},${loc.y}`)
    })

    window.addEventListener('aw:fit', () => {
      this.followTarget = null
      this.focus = null
      this.fitToAgents(true)
    })

    window.addEventListener('aw:follow', (e) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id
      this.followTarget = id
      const v = this.views.get(id)
      if (v == null) return
      const pos = this.worldPos(v.x, v.y)
      this.controls.target.set(pos.x, 0, pos.z)
      const dist = this.camera.position.distanceTo(this.controls.target)
      if (dist > 30) {
        const dir = this.camera.position.clone().sub(this.controls.target).normalize()
        this.camera.position.copy(this.controls.target).addScaledVector(dir, 20)
      }
    })


    // Mouse hover / click
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect()
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      this.updateTooltip(e.clientX, e.clientY)
    })

    canvas.addEventListener('mouseleave', () => {
      this.tooltipEl.classList.remove('show')
      this.hoveredAgent = null
      this.hoveredBuilding = null
      this.setHighlight(null)
    })

    let pointerDownPos: { x: number; y: number } | null = null
    canvas.addEventListener('pointerdown', (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY }
      this.focus = null
    })

    canvas.addEventListener('pointerup', (e) => {
      if (!pointerDownPos) return
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y)
      pointerDownPos = null
      if (dist > 6) return

      // Hover state is already resolved by the same raycast the tooltip uses
      if (this.hoveredAgent) {
        window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id: this.hoveredAgent } }))
        return
      }

      if (this.hoveredBuilding) {
        const b = this.buildingMeshes.get(this.hoveredBuilding)
        this.followTarget = null
        this.focusOnTile(this.hoveredBuilding)
        if (b?.venue) {
          window.dispatchEvent(new CustomEvent('aw:venue-click', { detail: { id: b.venue.id } }))
        } else if (b?.role) {
          window.dispatchEvent(new CustomEvent('aw:venue-click', { detail: { id: null, role: b.role } }))
        }
      }
    })
  }

  private updateTooltip(cx: number, cy: number): void {
    this.raycaster.setFromCamera(this.mouse, this.camera)
    this.tooltipEl.style.left = (cx + 14) + 'px'
    this.tooltipEl.style.top = (cy + 14) + 'px'

    // 1 — agents win: raycast the whole character mesh, not just its base
    const agentHits = this.raycaster.intersectObjects(this.pickAgents, true)
    const agentHit = agentHits.find(h => h.object.visible && this.pickRoot(h.object)?.visible === true)
    if (agentHit) {
      const root = this.pickRoot(agentHit.object)!
      const view = this.views.get(root.userData.pick.agentId as string)
      if (view) {
        this.hoveredAgent = view.id
        this.hoveredBuilding = null
        this.setHighlight(root)
        this.tooltipEl.innerHTML = `<div class="tt-name">${view.name}</div>
          <div class="tt-kind">${view.state}</div>
          <div class="tt-district">${this.locById.get(view.at)?.name ?? ''}</div>`
        this.tooltipEl.classList.add('show')
        this.renderer.domElement.style.cursor = 'pointer'
        return
      }
    }
    this.hoveredAgent = null

    // 2 — buildings: raycast the full model volume so towers highlight from any angle
    const buildingHit = this.raycaster.intersectObjects(this.pickBuildings, true)[0]
    if (buildingHit) {
      const root = this.pickRoot(buildingHit.object)!
      const pick = root.userData.pick as { tileKey: string; venue: LocationInfo | null; role: string | null }
      this.hoveredBuilding = pick.tileKey
      this.setHighlight(root)
      this.tooltipEl.innerHTML = pick.venue
        ? this.venueTooltipHtml(pick.venue)
        : `<div class="tt-name">${ROLE_LABEL[pick.role ?? ''] ?? 'Building'}</div>
           <div class="tt-district">${this.tileData.get(pick.tileKey)?.district ?? ''}</div>`
      this.tooltipEl.classList.add('show')
      this.renderer.domElement.style.cursor = 'pointer'
      return
    }

    this.hoveredBuilding = null
    this.setHighlight(null)

    // 3 — bare ground: water and bridges are informational only
    const pt = new THREE.Vector3()
    const onPlane = this.raycaster.ray.intersectPlane(this.groundPlane, pt)
    const gx = onPlane ? Math.floor(pt.x / TILE) : -1
    const gy = onPlane ? Math.floor(pt.z / TILE) : -1
    const info = (gx >= 0 && gy >= 0 && gx < this.grid && gy < this.grid)
      ? this.tileData.get(`${gx},${gy}`)
      : undefined

    this.renderer.domElement.style.cursor = 'default'
    if (info?.water) {
      this.tooltipEl.innerHTML = `<div class="tt-name">${info.water}</div>`
      this.tooltipEl.classList.add('show')
    } else if (info?.bridge) {
      this.tooltipEl.innerHTML = `<div class="tt-name">Bridge</div>`
      this.tooltipEl.classList.add('show')
    } else {
      this.tooltipEl.classList.remove('show')
    }
  }

  private venueTooltipHtml(venue: LocationInfo): string {
    const occupants = this.getOccupants(venue.id)
    let html = `<div class="tt-name">${venue.name}</div>
      <div class="tt-kind">${venue.kind}</div>
      <div class="tt-district">${venue.district}</div>`
    if (occupants.length > 0) {
      html += `<div class="tt-occ">${occupants.map(v => `<div class="tt-agent">${v.name}</div>`).join('')}</div>`
    }
    return html
  }

  // ── Animation loop ─────────────────────────────────────────────────

  private animate = (): void => {
    requestAnimationFrame(this.animate)
    this.controls.update()

    const delta = this.clock.getDelta() * 1000
    const t = this.clock.elapsedTime
    const posEase = 1 - Math.exp(-delta / 400)
    const TICK_MS = 2000

    // Update agent positions and animations
    const dtSec = delta / 1000
    for (const v of this.views.values()) {
      if (v.travelling) {
        const step = (delta / TICK_MS) * (v.targetP - v.p + 0.01)
        v.p = Math.min(v.p + Math.abs(step), v.targetP)
      }

      const indoor = this.isIndoors(v)
      v.mesh.visible = !indoor

      const goal = v.travelling ? this.routePoint(v, v.p) : { x: v.to.x, y: v.to.y }
      goal.x += v.spread.x
      goal.y += v.spread.y

      const dx = goal.x - v.x
      const dy = goal.y - v.y
      const moved = Math.hypot(dx, dy)
      v.x += dx * posEase
      v.y += dy * posEase

      const pos = this.worldPos(v.x, v.y)
      v.mesh.position.set(pos.x, 0, pos.z)

      if (moved > 0.01) {
        v.mesh.rotation.y = Math.atan2(dx, dy)
      }

      // Switch animation
      const walking = v.travelling && moved > 0.01
      const wantAnim = walking ? 'walk' : animForState(v.state)
      if (v.mixer && wantAnim !== v.currentAnim) {
        const nextClip = v.clips.get(wantAnim) ?? v.clips.get('idle')
        const prevClip = v.clips.get(v.currentAnim)
        if (nextClip) {
          const next = v.mixer.clipAction(nextClip)
          if (prevClip) {
            const prev = v.mixer.clipAction(prevClip)
            next.reset().play()
            prev.crossFadeTo(next, 0.25, true)
          } else {
            next.reset().play()
          }
        }
        v.currentAnim = wantAnim
      }

      v.mixer?.update(dtSec)
    }

    // Update overlay labels (project 3D → screen)
    this.updateVenueLabels()
    this.updateAgentLabels()

    // Follow target: camera tracks the agent smoothly
    if (this.followTarget) {
      const fv = this.views.get(this.followTarget)
      if (fv) {
        const fp = this.worldPos(fv.x, fv.y)
        this.controls.target.lerp(new THREE.Vector3(fp.x, 0, fp.z), 0.05)
      }
    }

    // One-shot camera glide onto a clicked building
    if (this.focus) {
      this.controls.target.lerp(this.focus.target, 0.08)
      this.camera.position.lerp(this.focus.camera, 0.08)
      if (this.camera.position.distanceTo(this.focus.camera) < 0.25) this.focus = null
    }

    // Water wave animation
    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh && (obj as THREE.Mesh).material === this.waterMat) {
        obj.position.y = -0.12 + Math.sin(t * 1.5 + obj.position.x * 0.3 + obj.position.z * 0.2) * 0.02
      }
    })

    this.renderer.render(this.scene, this.camera)
  }
}
