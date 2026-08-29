/**
 * DOM overlays projected onto the 3D scene, following four rules:
 *
 * 1. A venue with nobody inside shows no label.
 * 2. A venue with occupants shows its name and who is inside.
 * 3. Hovering any building hides every venue label — one thing labelled at a time.
 * 4. An agent visible in the street always carries their name.
 */
import type * as THREE from 'three'
import type { CityGrid } from './grid.js'
import type { AgentView } from './agents.js'

/** How far off-screen a label may drift before it is hidden. */
const MARGIN = 50

export function createVenueLabels(grid: CityGrid, overlay: HTMLElement): Map<string, HTMLDivElement> {
  const labels = new Map<string, HTMLDivElement>()
  for (const loc of grid.locations) {
    const label = document.createElement('div')
    label.className = 'venue-label'
    label.dataset.venueId = loc.id
    label.style.display = 'none'
    label.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('aw:venue-click', { detail: { id: loc.id } }))
    })
    overlay.appendChild(label)
    labels.set(loc.id, label)
  }
  return labels
}

export function occupantsOf(views: Map<string, AgentView>, locationId: string): AgentView[] {
  const result: AgentView[] = []
  for (const v of views.values()) {
    if (v.at === locationId && !v.travelling) result.push(v)
  }
  return result
}

/** Project a world point to canvas pixels, or null when it is off-screen. */
function toScreen(
  pos: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  rect: DOMRect,
): { x: number; y: number } | null {
  const p = pos.clone().project(camera)
  const x = p.x * (rect.width / 2) + rect.width / 2
  const y = -p.y * (rect.height / 2) + rect.height / 2
  if (p.z > 1 || x < -MARGIN || x > rect.width + MARGIN || y < -MARGIN || y > rect.height + MARGIN) return null
  return { x, y }
}

function position(label: HTMLDivElement, at: { x: number; y: number } | null): boolean {
  if (at == null) {
    label.style.display = 'none'
    return false
  }
  label.style.display = ''
  label.style.left = at.x + 'px'
  label.style.top = at.y + 'px'
  return true
}

export function updateVenueLabels(
  labels: Map<string, HTMLDivElement>,
  grid: CityGrid,
  views: Map<string, AgentView>,
  camera: THREE.PerspectiveCamera,
  rect: DOMRect,
  hoveringBuilding: boolean,
): void {
  for (const loc of grid.locations) {
    const label = labels.get(loc.id)
    if (!label) continue

    const occupants = occupantsOf(views, loc.id)
    if (occupants.length === 0 || hoveringBuilding) {
      label.style.display = 'none'
      continue
    }

    const pos = grid.worldPos(loc.x, loc.y)
    pos.y = 1.8
    if (!position(label, toScreen(pos, camera, rect))) continue

    const occHtml = occupants.map(v => `<span class="vl-agent">${v.name}</span>`).join('')
    label.innerHTML =
      `<span class="vl-name">${loc.name}</span><div class="vl-occ">${occHtml}</div><div class="vl-arrow"></div>`
  }
}

export function updateAgentLabels(
  labels: Map<string, HTMLDivElement>,
  views: Map<string, AgentView>,
  camera: THREE.PerspectiveCamera,
  rect: DOMRect,
): void {
  for (const v of views.values()) {
    const label = labels.get(v.id)
    if (!label) continue
    if (!v.mesh.visible || v.doorScale < 0.5) {
      label.style.display = 'none'
      continue
    }
    const pos = v.mesh.position.clone()
    pos.y = 1.1
    if (position(label, toScreen(pos, camera, rect)) && v.doorScale < 1) {
      label.style.opacity = String(v.doorScale)
    } else {
      label.style.opacity = ''
    }
  }
}
