/**
 * Hover resolution and the tooltip that follows the cursor.
 *
 * Picking raycasts the full model volume, never the ground plane: a tile hit
 * test looks right until you point at the top of a tower, which projects
 * nowhere near its own tile. Bare ground is only consulted as a last resort,
 * for water and bridges.
 */
import * as THREE from 'three'
import { Highlighter, pickRoot } from './highlight.js'
import { occupantsOf } from './labels.js'
import { ROLE_LABEL } from './assets.js'
import { TILE, type CityGrid } from './grid.js'
import type { AgentView } from './agents.js'
import type { TileInfo } from './ground.js'
import type { LocationInfo } from '../core/connection.js'

export type BuildingPick = { tileKey: string; venue: LocationInfo | null; role: string | null }

export type PickTargets = {
  agents: THREE.Object3D[]
  buildings: THREE.Object3D[]
}

export class Picker {
  readonly highlighter = new Highlighter()
  /** Id of the agent under the cursor, or null. */
  hoveredAgent: string | null = null
  /** Tile key of the building under the cursor, or null. */
  hoveredBuilding: string | null = null

  private readonly raycaster = new THREE.Raycaster()
  private readonly mouse = new THREE.Vector2()
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  constructor(
    private readonly el: HTMLDivElement,
    private readonly grid: CityGrid,
    private readonly views: Map<string, AgentView>,
    private readonly targets: PickTargets,
    private readonly tileData: Map<string, TileInfo>,
  ) {}

  /** Remember where the cursor is, in normalised device coordinates. */
  track(e: MouseEvent, rect: DOMRect): void {
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
  }

  clear(): void {
    this.el.classList.remove('show')
    this.hoveredAgent = null
    this.hoveredBuilding = null
    this.highlighter.set(null)
  }

  /** Resolve what is under the cursor and redraw the tooltip. Returns the cursor style. */
  update(camera: THREE.Camera, cx: number, cy: number): 'pointer' | 'default' {
    this.raycaster.setFromCamera(this.mouse, camera)
    this.el.style.left = cx + 14 + 'px'
    this.el.style.top = cy + 14 + 'px'

    // Agents win: an agent standing in a doorway should still be clickable
    const agentHits = this.raycaster.intersectObjects(this.targets.agents, true)
    const agentHit = agentHits.find((h) => h.object.visible && pickRoot(h.object)?.visible === true)
    if (agentHit) {
      const root = pickRoot(agentHit.object)!
      const view = this.views.get(root.userData.pick.agentId as string)
      if (view) {
        this.hoveredAgent = view.id
        this.hoveredBuilding = null
        this.highlighter.set(root)
        this.show(`<div class="tt-name">${view.name}</div>
          <div class="tt-kind">${view.state}</div>
          <div class="tt-district">${this.grid.locById.get(view.at)?.name ?? ''}</div>`)
        return 'pointer'
      }
    }
    this.hoveredAgent = null

    const buildingHit = this.raycaster.intersectObjects(this.targets.buildings, true)[0]
    if (buildingHit) {
      const root = pickRoot(buildingHit.object)!
      const pick = root.userData.pick as BuildingPick
      this.hoveredBuilding = pick.tileKey
      this.highlighter.set(root)
      this.show(
        pick.venue
          ? this.venueHtml(pick.venue)
          : `<div class="tt-name">${ROLE_LABEL[pick.role ?? ''] ?? 'Building'}</div>
           <div class="tt-district">${this.tileData.get(pick.tileKey)?.district ?? ''}</div>`,
      )
      return 'pointer'
    }

    this.hoveredBuilding = null
    this.highlighter.set(null)

    const info = this.tileUnderCursor()
    if (info?.water) this.show(`<div class="tt-name">${info.water}</div>`)
    else if (info?.bridge) this.show('<div class="tt-name">Bridge</div>')
    else this.el.classList.remove('show')
    return 'default'
  }

  private tileUnderCursor(): TileInfo | undefined {
    const pt = new THREE.Vector3()
    if (this.raycaster.ray.intersectPlane(this.ground, pt) == null) return undefined
    const gx = Math.floor(pt.x / TILE)
    const gy = Math.floor(pt.z / TILE)
    return this.grid.inBounds(gx, gy) ? this.tileData.get(`${gx},${gy}`) : undefined
  }

  private show(html: string): void {
    this.el.innerHTML = html
    this.el.classList.add('show')
  }

  private venueHtml(venue: LocationInfo): string {
    const occupants = occupantsOf(this.views, venue.id)
    let html = `<div class="tt-name">${venue.name}</div>
      <div class="tt-kind">${venue.kind}</div>
      <div class="tt-district">${venue.district}</div>`
    if (occupants.length > 0) {
      html += `<div class="tt-occ">${occupants.map((v) => `<div class="tt-agent">${v.name}</div>`).join('')}</div>`
    }
    return html
  }
}
