/**
 * The Three.js city scene.
 *
 * This file only orchestrates: it owns the renderer, the camera and the render
 * loop, and delegates every kind of content to a sibling module. The viewer is
 * a spectator with no authority — everything it draws comes from `GET /world`
 * once plus the `/live` WebSocket each tick, and it never writes back.
 */
import * as THREE from 'three'
import { CityGrid, TILE } from './grid.js'
import { ModelLibrary, type PickInfo, type PlaceFn } from './assets.js'
import { buildGround, animateWater, type TileInfo } from './ground.js'
import { placeRoads } from './roads.js'
import { placeVenues, placeFillers, placeStreetFurniture } from './buildings.js'
import {
  createAgents, renderPortraits, updateAgentViews, syncAnimation, isIndoors, routePoint,
  type AgentView,
} from './agents.js'
import { createLighting, applySkyForHour, type SkyRig } from './lighting.js'
import { createVenueLabels, updateVenueLabels, updateAgentLabels } from './labels.js'
import { Picker, type BuildingPick } from './picking.js'
import {
  createCamera, framingAllAgents, framingTile, snapTo, easeTo, zoom,
  type CameraRig, type Focus,
} from './camera.js'
import type { EngineConnection, WorldInfo, StateMsg } from '../core/connection.js'

/** Real milliseconds between engine state messages, used to pace walk animation. */
const TICK_MS = 2000

export class CityScene3D {
  private readonly canvas: HTMLCanvasElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly timer = new THREE.Timer()
  private readonly grid: CityGrid
  private readonly models = new ModelLibrary()
  private readonly rig: CameraRig
  private readonly sky: SkyRig
  private readonly center: THREE.Vector3
  private readonly overlay: HTMLDivElement
  private readonly tooltipEl: HTMLDivElement

  private tileData = new Map<string, TileInfo>()
  private waterMat!: THREE.Material
  private views = new Map<string, AgentView>()
  private agentLabels = new Map<string, HTMLDivElement>()
  private venueLabels = new Map<string, HTMLDivElement>()
  private buildingPicks = new Map<string, BuildingPick>()
  private readonly targets = { agents: [] as THREE.Object3D[], buildings: [] as THREE.Object3D[] }
  private picker!: Picker

  private focus: Focus | null = null
  private followTarget: string | null = null
  private didInitialFit = false
  private onLoadProgress: ((loaded: number, total: number, name: string) => void) | null = null

  constructor(
    private readonly container: HTMLElement,
    private readonly conn: EngineConnection,
    private readonly world: WorldInfo,
  ) {
    this.grid = new CityGrid(world)
    this.center = new THREE.Vector3(this.grid.size * TILE / 2, 0, this.grid.size * TILE / 2)

    this.canvas = document.createElement('canvas')
    this.canvas.style.display = 'block'
    container.prepend(this.canvas)

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1

    this.scene.background = new THREE.Color(0x87ceeb)
    this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.008)

    this.rig = createCamera(this.canvas, this.center, container.clientWidth / container.clientHeight)
    this.sky = createLighting(this.scene, this.center)
    applySkyForHour(this.sky, this.scene, this.renderer, this.center, 12)

    this.overlay = document.createElement('div')
    this.overlay.className = 'overlay-3d'
    container.appendChild(this.overlay)

    this.tooltipEl = document.createElement('div')
    this.tooltipEl.className = 'tooltip-3d'
    container.appendChild(this.tooltipEl)
  }

  // ── Public API ──────────────────────────────────────────────────────

  set loadProgress(fn: (loaded: number, total: number, name: string) => void) {
    this.onLoadProgress = fn
  }

  async build(): Promise<void> {
    const ground = buildGround(this.scene, this.grid)
    this.tileData = ground.tileData
    this.waterMat = ground.waterMat

    await this.models.load((l, t, n) => this.onLoadProgress?.(l, t, n))

    const place = this.placer()
    placeRoads(this.scene, this.grid, place)
    placeVenues(this.grid, place)
    placeFillers(this.grid, place)
    placeStreetFurniture(this.grid, place)

    const actors = createAgents(this.scene, this.grid, this.world, this.models, this.overlay)
    this.views = actors.views
    this.agentLabels = actors.labels
    this.targets.agents = actors.pickable

    renderPortraits(this.models)
    this.venueLabels = createVenueLabels(this.grid, this.overlay)
    this.picker = new Picker(this.tooltipEl, this.grid, this.views, this.targets, this.tileData)

    this.fitToAgents()
    this.setupEvents()
    this.conn.onState(s => this.onState(s))
    this.animate()
  }

  dispose(): void {
    this.renderer.dispose()
  }

  // ── Placement ───────────────────────────────────────────────────────

  /** Clones a catalogue model onto a tile, registering it for picking if asked. */
  private placer(): PlaceFn {
    return (key: string, gx: number, gy: number, rotY = 0, pick?: PickInfo) => {
      const template = this.models.get(key)
      if (!template) return null
      const clone = template.clone()
      clone.position.add(this.grid.worldPos(gx, gy))
      clone.rotation.y = rotY
      this.scene.add(clone)
      if (pick) {
        const tileKey = `${gx},${gy}`
        const info: BuildingPick = { tileKey, venue: pick.venue ?? null, role: pick.role ?? null }
        clone.userData.pick = info
        this.targets.buildings.push(clone)
        this.buildingPicks.set(tileKey, info)
      }
      return clone
    }
  }

  // ── Camera ──────────────────────────────────────────────────────────

  private fitToAgents(animated = false): void {
    const framing = framingAllAgents(this.rig, this.grid, this.views)
    if (framing == null) return
    if (animated) this.focus = framing
    else snapTo(this.rig, framing)
  }

  private focusOnTile(tileKey: string): void {
    const [gx, gy] = tileKey.split(',').map(Number) as [number, number]
    this.followTarget = null
    this.focus = framingTile(this.rig, this.grid, gx, gy)
  }

  // ── Engine connection ───────────────────────────────────────────────

  private onState(s: StateMsg): void {
    applySkyForHour(this.sky, this.scene, this.renderer, this.center, s.hour + s.minute / 60)
    updateAgentViews(this.views, s.agents)
    if (!this.didInitialFit) {
      this.didInitialFit = true
      this.fitToAgents()
    }
  }

  // ── Events ──────────────────────────────────────────────────────────

  private setupEvents(): void {
    const canvas = this.canvas

    new ResizeObserver(() => {
      const w = this.container.clientWidth
      const h = this.container.clientHeight
      this.rig.camera.aspect = w / h
      this.rig.camera.updateProjectionMatrix()
      this.renderer.setSize(w, h)
    }).observe(this.container)

    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') {
        this.rig.camera.position.set(this.center.x + 35, 30, this.center.z + 35)
        this.rig.controls.target.copy(this.center)
      }
    })

    window.addEventListener('aw:zoom', (e) => {
      this.focus = null
      zoom(this.rig, (e as CustomEvent<{ dir: number }>).detail.dir)
    })

    window.addEventListener('aw:venue-focus', (e) => {
      const loc = this.grid.locById.get((e as CustomEvent<{ id: string }>).detail.id)
      if (loc) this.focusOnTile(`${loc.x},${loc.y}`)
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
      const pos = this.grid.worldPos(v.x, v.y)
      this.rig.controls.target.set(pos.x, 0, pos.z)
      if (this.rig.camera.position.distanceTo(this.rig.controls.target) > 30) {
        const dir = this.rig.camera.position.clone().sub(this.rig.controls.target).normalize()
        this.rig.camera.position.copy(this.rig.controls.target).addScaledVector(dir, 20)
      }
    })

    canvas.addEventListener('mousemove', (e) => {
      this.picker.track(e, canvas.getBoundingClientRect())
      canvas.style.cursor = this.picker.update(this.rig.camera, e.clientX, e.clientY)
    })

    canvas.addEventListener('mouseleave', () => this.picker.clear())

    // A drag is an orbit, not a click — only a near-stationary press selects
    let pressedAt: { x: number; y: number } | null = null
    canvas.addEventListener('pointerdown', (e) => {
      pressedAt = { x: e.clientX, y: e.clientY }
      this.focus = null
    })

    canvas.addEventListener('pointerup', (e) => {
      if (!pressedAt) return
      const moved = Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y)
      pressedAt = null
      if (moved <= 6) this.select()
    })
  }

  /** Act on whatever the picker already resolved for the current cursor position. */
  private select(): void {
    if (this.picker.hoveredAgent) {
      window.dispatchEvent(new CustomEvent('aw:agent-click', { detail: { id: this.picker.hoveredAgent } }))
      return
    }
    const tileKey = this.picker.hoveredBuilding
    if (tileKey == null) return

    const pick = this.buildingPicks.get(tileKey)
    this.focusOnTile(tileKey)
    if (pick?.venue) {
      window.dispatchEvent(new CustomEvent('aw:venue-click', { detail: { id: pick.venue.id } }))
    } else if (pick?.role) {
      window.dispatchEvent(new CustomEvent('aw:venue-click', { detail: { id: null, role: pick.role } }))
    }
  }

  // ── Render loop ─────────────────────────────────────────────────────

  private animate = (): void => {
    requestAnimationFrame(this.animate)
    this.rig.controls.update()

    this.timer.update()
    const delta = this.timer.getDelta() * 1000
    const posEase = 1 - Math.exp(-delta / 400)

    for (const v of this.views.values()) {
      if (v.travelling) {
        // Chase the engine's progress, staying a hair ahead so walks look continuous
        const step = (delta / TICK_MS) * (v.targetP - v.p + 0.01)
        v.p = Math.min(v.p + Math.abs(step), v.targetP)
      }

      const wantIndoors = isIndoors(this.grid, v)
      const doorTarget = wantIndoors ? 0 : 1
      const doorEase = 1 - Math.exp(-delta / 800)
      v.doorScale += (doorTarget - v.doorScale) * doorEase
      if (v.doorScale < 0.01) { v.doorScale = 0; v.mesh.visible = false }
      else { v.mesh.visible = true; v.mesh.scale.setScalar(v.baseScale * v.doorScale) }

      const goal = v.travelling ? routePoint(v, v.p, this.grid.period) : { x: v.to.x, y: v.to.y }
      goal.x += v.spread.x
      goal.y += v.spread.y

      const dx = goal.x - v.x
      const dy = goal.y - v.y
      const moved = Math.hypot(dx, dy)
      v.x += dx * posEase
      v.y += dy * posEase

      const pos = this.grid.worldPos(v.x, v.y)
      v.mesh.position.set(pos.x, 0, pos.z)
      if (moved > 0.01) v.mesh.rotation.y = Math.atan2(dx, dy)

      syncAnimation(v, v.travelling && moved > 0.01, delta / 1000)
    }

    const rect = this.renderer.domElement.getBoundingClientRect()
    updateVenueLabels(
      this.venueLabels, this.grid, this.views, this.rig.camera, rect,
      this.picker.hoveredBuilding != null,
    )
    updateAgentLabels(this.agentLabels, this.views, this.rig.camera, rect)

    if (this.followTarget) {
      const fv = this.views.get(this.followTarget)
      if (fv) {
        const fp = this.grid.worldPos(fv.x, fv.y)
        this.rig.controls.target.lerp(new THREE.Vector3(fp.x, 0, fp.z), 0.05)
      }
    }

    if (this.focus && easeTo(this.rig, this.focus)) this.focus = null

    animateWater(this.scene, this.waterMat, this.timer.getElapsed())
    this.renderer.render(this.scene, this.rig.camera)
  }
}
