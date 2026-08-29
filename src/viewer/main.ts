import { EngineConnection } from './core/connection.js'
import { CityScene3D } from './scene/index.js'
import { initSidebar } from './ui/sidebar.js'
import { initAgentCard } from './ui/agent-card.js'
import { initVenueCard } from './ui/venue-card.js'
import { initGraph } from './ui/graph.js'

const engineUrl =
  new URLSearchParams(location.search).get('engine') ?? location.origin

console.log('[aw] booting viewer, engine:', engineUrl)
const conn = new EngineConnection(engineUrl)

async function boot(): Promise<void> {
  console.log('[aw] fetching world...')
  const world = await conn.fetchWorld()
  console.log('[aw] world loaded:', world.agents.length, 'agents,', world.locations.length, 'locations')

  const container = document.getElementById('game-container')!
  const loadingEl = document.getElementById('loading')
  const loadFill = document.getElementById('load-fill')
  const loadStatus = document.getElementById('load-status')

  const scene = new CityScene3D(container, conn, world)
  scene.loadProgress = (loaded, total, name) => {
    if (loadFill) loadFill.style.width = `${(loaded / total) * 100}%`
    if (loadStatus) loadStatus.textContent = name
  }

  await scene.build()
  if (loadingEl) loadingEl.classList.add('done')
  console.log('[aw] 3D scene ready')

  // Camera controls from DOM buttons
  container.querySelector('#controls')?.addEventListener('click', (ev) => {
    const btn = (ev.target as HTMLElement).closest('button')
    if (btn == null) return
    const zoom = btn.getAttribute('data-zoom')
    if (zoom != null) window.dispatchEvent(new CustomEvent('aw:zoom', { detail: { dir: Number(zoom) } }))
    else if (btn.hasAttribute('data-fit')) window.dispatchEvent(new CustomEvent('aw:fit'))
  })

  initSidebar(conn, world)
  initAgentCard(conn)
  initVenueCard(conn, world)
  initGraph()
  conn.connect()

  ;(window as unknown as { __aw: unknown }).__aw = { scene, conn, world }
}

boot().catch(console.error)
