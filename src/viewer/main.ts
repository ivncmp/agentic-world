import Phaser from 'phaser'
import { EngineConnection } from './connection.js'
import { WorldScene } from './world-scene.js'
import { initSidebar } from './sidebar.js'
import { initAgentCard } from './agent-card.js'
import { initVenueCard } from './venue-card.js'

const engineUrl =
  new URLSearchParams(location.search).get('engine') ?? location.origin

console.log('[aw] booting viewer, engine:', engineUrl)
const conn = new EngineConnection(engineUrl)

async function boot(): Promise<void> {
  console.log('[aw] fetching world...')
  const world = await conn.fetchWorld()
  console.log('[aw] world loaded:', world.agents.length, 'agents,', world.locations.length, 'locations')
  const container = document.getElementById('game-container')!

  // The scene is registered after boot rather than via `scene:` so it starts
  // with the world payload — an auto-started scene would run create() with no data.
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: container.clientWidth,
    height: container.clientHeight,
    backgroundColor: '#0f172a',
    scale: { mode: Phaser.Scale.RESIZE },
    input: { mouse: { preventDefaultWheel: true } },
    render: { antialias: true },
    // Chrome stops calling requestAnimationFrame in a hidden tab, which stalls
    // Phaser's loader partway through preload and leaves a black canvas.
    // Screenshot tooling always runs hidden, so `?bg` swaps in a timer-driven
    // loop. Off by default: rAF is the right clock for a tab you can see.
    fps: { forceSetTimeOut: new URLSearchParams(location.search).has('bg') },
  })

  game.scene.add('WorldScene', WorldScene, true, { connection: conn, world })
  console.log('[aw] scene started')

  // A canvas shows you nothing when it goes wrong, so keep a handle to poke at
  // from the console. A debugging aid, not an API — nothing may depend on it.
  ;(window as unknown as { __aw: unknown }).__aw = { game, conn, world }

  // Camera controls live in the DOM and reach the scene by event, so the
  // toolbar never needs a handle on Phaser internals.
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
  conn.connect()
}

boot().catch(console.error)
